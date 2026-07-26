import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ChecklistContextSchema,
  ChecklistLibraryVersionSchema,
  EncounterSchema,
  withEvaluatedChecklist,
  type Encounter,
  type PatientSummary
} from "@vaanaya/contracts";
import {
  MemoryEncounterStore,
  type EncounterStore
} from "./encounter-store";
import { createDemoEncounters } from "./demo-cohort";

type EncounterRow = {
  id: number;
  organization_id: string;
  patient_reference: string;
  procedure_name: string;
  preferred_language: string;
  state: Encounter["state"];
  assigned_clinician_id: string | null;
  checklist_template_id: string;
  checklist_version: string;
  checklist_context_flags: unknown;
  checklist_library_procedure: string | null;
  checklist_library_version: number | null;
  checklist_library_source: "clinician_reviewed_synthetic" | null;
};

export function checklistContextFromRow(input: {
  checklist_template_id: string;
  checklist_version: string;
  checklist_context_flags: unknown;
}) {
  return ChecklistContextSchema.parse({
    templateId: input.checklist_template_id,
    version: input.checklist_version,
    contextFlags: input.checklist_context_flags
  });
}

export function normalizeDatabaseTimestamp(value: string): string {
  return new Date(value).toISOString();
}

type PersistedChecklistSuggestion = {
  id: string;
  category_id: string;
  question: string;
  rationale: string;
  approval_state: string;
};

type PersistedChecklistLibraryRow = {
  organization_id: string;
  normalized_procedure: string;
  version: number;
  source: string;
  content: { items: unknown };
  published_by: string;
};

export function checklistExtensionsFromPersistence(input: {
  library: PersistedChecklistLibraryRow | null;
  suggestions: PersistedChecklistSuggestion[];
}) {
  if (input.library) {
    return ChecklistLibraryVersionSchema.parse({
      organizationId: input.library.organization_id,
      normalizedProcedure: input.library.normalized_procedure,
      version: input.library.version,
      source: input.library.source,
      publishedBy: input.library.published_by,
      items: input.library.content.items
    }).items;
  }
  return input.suggestions
    .filter(suggestion => suggestion.approval_state === "approved")
    .map(suggestion => ({
      id: suggestion.id,
      categoryId: suggestion.category_id,
      label: suggestion.question,
      question: suggestion.question,
      rationale: suggestion.rationale,
      required: false as const,
      authority: "evidence_or_clinician" as const,
      severity: "standard" as const,
      deferrable: true as const,
      applicability: { kind: "always" as const }
    }));
}

export function transcriptRowsToInsert(
  encounterId: number,
  transcript: Encounter["transcript"],
  persistedSequences: ReadonlySet<number>
) {
  return transcript.flatMap((turn, index) => {
    const sequenceNumber = index + 1;
    if (persistedSequences.has(sequenceNumber)) {
      return [];
    }
    return [
      {
        encounter_id: encounterId,
        sequence_number: sequenceNumber,
        speaker_role: turn.speaker,
        source_language: turn.language,
        original_text: turn.original,
        translated_text: turn.translation,
        confidence: turn.confidence,
        offset_seconds: turn.offsetSeconds
      }
    ];
  });
}

export function proposalRowsToInsert(
  encounterId: number,
  clinicianId: string,
  proposals: Encounter["proposals"],
  persistedFieldKeys: ReadonlySet<string>
) {
  return proposals
    .filter(proposal => !persistedFieldKeys.has(proposal.id))
    .map(proposal => ({
      encounter_id: encounterId,
      field_key: proposal.id,
      field_label: proposal.label,
      field_state: proposal.state,
      proposed_value: proposal.value,
      required: proposal.required,
      model_name: "openai",
      updated_by: clinicianId
    }));
}

export function sourceRowsToInsert(
  proposals: Encounter["proposals"],
  proposalIdByFieldKey: ReadonlyMap<string, number>,
  transcriptIdByTurnId: ReadonlyMap<string, number>
) {
  return proposals.flatMap(proposal => {
    const proposalId = proposalIdByFieldKey.get(proposal.id);
    if (!proposalId) return [];
    return proposal.sourceTurnIds.flatMap(turnId => {
      const transcriptSegmentId = transcriptIdByTurnId.get(turnId);
      return transcriptSegmentId
        ? [
            {
              proposal_id: proposalId,
              transcript_segment_id: transcriptSegmentId
            }
          ]
        : [];
    });
  });
}

export class SupabaseEncounterStore implements EncounterStore {
  readonly #demoStore = new MemoryEncounterStore(createDemoEncounters());

  constructor(private readonly client: SupabaseClient) {}

  static fromEnvironment(): SupabaseEncounterStore | null {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) return null;
    return new SupabaseEncounterStore(
      createClient(url, secret, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      })
    );
  }

  private async encounterRow(id: string): Promise<EncounterRow | null> {
    let query = this.client
      .from("encounters")
      .select(
        "id,organization_id,patient_reference,procedure_name,preferred_language,state,assigned_clinician_id,checklist_template_id,checklist_version,checklist_context_flags,checklist_library_procedure,checklist_library_version,checklist_library_source"
      );
    query =
      id === "demo"
        ? query.eq("patient_reference", "SYN-PAC-042")
        : query.eq("id", id);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`Supabase encounter read failed: ${error.message}`);
    return data as EncounterRow | null;
  }

  async get(id: string): Promise<Encounter | null> {
    if (id.startsWith("synthetic-")) {
      return this.#demoStore.get(id);
    }
    const encounter = await this.encounterRow(id);
    if (!encounter) return null;

    const [
      transcriptResult,
      proposalsResult,
      consentResult,
      auditResult,
      suggestionsResult,
      libraryResult
    ] = await Promise.all([
        this.client
          .from("transcript_segments")
          .select(
            "id,sequence_number,speaker_role,source_language,original_text,translated_text,confidence,offset_seconds"
          )
          .eq("encounter_id", encounter.id)
          .order("sequence_number"),
        this.client
          .from("pac_field_proposals")
          .select(
            "id,field_key,field_label,field_state,proposed_value,required,pac_field_sources(transcript_segment_id)"
          )
          .eq("encounter_id", encounter.id)
          .order("id"),
        this.client
          .from("consent_events")
          .select("granted")
          .eq("encounter_id", encounter.id)
          .eq("consent_type", "transcription")
          .eq("granted", true)
          .limit(1),
        this.client
          .from("audit_events")
          .select("id,action,actor_id,detail,occurred_at")
          .eq("encounter_id", encounter.id)
          .order("occurred_at"),
        this.client
          .from("pac_checklist_suggestions")
          .select(
            "id,model_run_id,procedure_name,category_id,question,rationale,approval_state,decided_by,decided_at"
          )
          .eq("encounter_id", encounter.id)
          .order("created_at"),
        encounter.checklist_library_procedure &&
        encounter.checklist_library_version
          ? this.client
              .from("pac_checklist_library_versions")
              .select(
                "organization_id,normalized_procedure,version,source,content,published_by"
              )
              .eq("organization_id", encounter.organization_id)
              .eq(
                "normalized_procedure",
                encounter.checklist_library_procedure
              )
              .eq("version", encounter.checklist_library_version)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null })
      ]);

    for (const [label, result] of [
      ["transcript", transcriptResult],
      ["proposals", proposalsResult],
      ["consent", consentResult],
      ["audit", auditResult],
      ["suggestions", suggestionsResult],
      ["checklist library", libraryResult]
    ] as const) {
      if (result.error)
        throw new Error(`Supabase ${label} read failed: ${result.error.message}`);
    }

    const turns = (transcriptResult.data ?? []).map(segment => ({
      id: `t${segment.sequence_number}`,
      databaseId: segment.id,
      speaker: segment.speaker_role,
      language: segment.source_language,
      original: segment.original_text,
      translation: segment.translated_text ?? segment.original_text,
      confidence: Number(segment.confidence),
      offsetSeconds: Number(segment.offset_seconds)
    }));
    const turnIdByDatabaseId = new Map(
      turns.map(turn => [turn.databaseId, turn.id])
    );
    const customerSummary = (auditResult.data ?? [])
      .map(event => event.detail)
      .filter(
        (detail): detail is { customerSummary: string } =>
          Boolean(
            detail &&
              typeof detail === "object" &&
              "customerSummary" in detail &&
              typeof (detail as { customerSummary?: unknown }).customerSummary ===
                "string"
          )
      )
      .at(-1)?.customerSummary;

    return withEvaluatedChecklist(EncounterSchema.parse({
      id: id === "demo" ? "demo" : String(encounter.id),
      patientReference: encounter.patient_reference,
      procedure: encounter.procedure_name,
      preferredLanguage: encounter.preferred_language,
      state: encounter.state,
      consentRecorded: Boolean(consentResult.data?.length),
      checklistContext: checklistContextFromRow(encounter),
      ...(encounter.checklist_library_procedure &&
      encounter.checklist_library_version &&
      encounter.checklist_library_source
        ? {
            checklistLibrary: {
              normalizedProcedure: encounter.checklist_library_procedure,
              version: encounter.checklist_library_version,
              source: encounter.checklist_library_source
            }
          }
        : {}),
      checklistSuggestions: (suggestionsResult.data ?? []).map(suggestion => ({
        id: suggestion.id,
        procedure: suggestion.procedure_name,
        modelRunId: suggestion.model_run_id,
        categoryId: suggestion.category_id,
        question: suggestion.question,
        rationale: suggestion.rationale,
        required: false,
        severity: "standard",
        authority: "evidence_or_clinician",
        deferrable: true,
        approvalState: suggestion.approval_state,
        ...(suggestion.decided_by
          ? { decidedBy: suggestion.decided_by }
          : {}),
        ...(suggestion.decided_at
          ? { decidedAt: normalizeDatabaseTimestamp(suggestion.decided_at) }
          : {})
      })),
      checklistExtensions: checklistExtensionsFromPersistence({
        library: libraryResult.data,
        suggestions: suggestionsResult.data ?? []
      }),
      customerSummary,
      requiredFieldIds: (proposalsResult.data ?? [])
        .filter(proposal => proposal.required)
        .map(proposal => proposal.field_key),
      proposals: (proposalsResult.data ?? []).map(proposal => ({
        id: proposal.field_key,
        label: proposal.field_label,
        state: proposal.field_state,
        value: proposal.proposed_value ?? "",
        sourceTurnIds: proposal.pac_field_sources
          .map(source => turnIdByDatabaseId.get(source.transcript_segment_id))
          .filter((turnId): turnId is string => Boolean(turnId)),
        required: proposal.required
      })),
      transcript: turns.map(({ databaseId: _databaseId, ...turn }) => turn),
      audit: (auditResult.data ?? []).map(event => ({
        id: String(event.id),
        action: event.action,
        actorId: event.actor_id ?? "system",
        occurredAt: normalizeDatabaseTimestamp(event.occurred_at),
        detail: event.detail
      }))
    }));
  }

  async save(encounter: Encounter): Promise<Encounter> {
    if (encounter.id.startsWith("synthetic-")) {
      return this.#demoStore.save(encounter);
    }
    const row = await this.encounterRow(encounter.id);
    if (!row) throw new Error("Cannot persist an encounter that does not exist.");
    if (!row.assigned_clinician_id)
      throw new Error("A clinician must be assigned before persistence.");

    const [proposalResult, transcriptResult] = await Promise.all([
      this.client
        .from("pac_field_proposals")
        .select("id,field_key,field_state,proposed_value")
        .eq("encounter_id", row.id),
      this.client
        .from("transcript_segments")
        .select("sequence_number")
        .eq("encounter_id", row.id)
    ]);
    const { data: persistedProposals, error: proposalReadError } = proposalResult;
    if (proposalReadError)
      throw new Error(`Supabase proposal read failed: ${proposalReadError.message}`);
    if (transcriptResult.error)
      throw new Error(
        `Supabase transcript read failed: ${transcriptResult.error.message}`
      );

    const transcriptRows = transcriptRowsToInsert(
      row.id,
      encounter.transcript,
      new Set(
        (transcriptResult.data ?? []).map(segment => segment.sequence_number)
      )
    );
    if (transcriptRows.length) {
      const { error } = await this.client
        .from("transcript_segments")
        .insert(transcriptRows);
      if (error)
        throw new Error(`Supabase transcript write failed: ${error.message}`);
    }

    const newProposalRows = proposalRowsToInsert(
      row.id,
      row.assigned_clinician_id,
      encounter.proposals,
      new Set((persistedProposals ?? []).map(item => item.field_key))
    );
    if (newProposalRows.length) {
      const { error } = await this.client
        .from("pac_field_proposals")
        .insert(newProposalRows);
      if (error)
        throw new Error(`Supabase proposal insert failed: ${error.message}`);
    }

    for (const proposal of encounter.proposals) {
      const persisted = (persistedProposals ?? []).find(
        item => item.field_key === proposal.id
      );
      if (!persisted) continue;
      if (
        persisted.field_state === proposal.state &&
        (persisted.proposed_value ?? "") === proposal.value
      )
        continue;
      const { error } = await this.client
        .from("pac_field_proposals")
        .update({
          field_state: proposal.state,
          proposed_value: proposal.value,
          updated_by: row.assigned_clinician_id,
          updated_at: new Date().toISOString()
        })
        .eq("id", persisted.id);
      if (error)
        throw new Error(`Supabase proposal update failed: ${error.message}`);
      const { error: editError } = await this.client
        .from("clinician_edits")
        .insert({
          encounter_id: row.id,
          proposal_id: persisted.id,
          before_value: persisted.proposed_value,
          after_value: proposal.value,
          reason: "Clinician verification",
          edited_by: row.assigned_clinician_id
        });
      if (editError)
        throw new Error(`Supabase clinician edit failed: ${editError.message}`);
    }

    const [persistedTranscriptResult, persistedProposalResult] =
      await Promise.all([
        this.client
          .from("transcript_segments")
          .select("id,sequence_number")
          .eq("encounter_id", row.id),
        this.client
          .from("pac_field_proposals")
          .select("id,field_key")
          .eq("encounter_id", row.id)
      ]);
    if (persistedTranscriptResult.error)
      throw new Error(
        `Supabase transcript source read failed: ${persistedTranscriptResult.error.message}`
      );
    if (persistedProposalResult.error)
      throw new Error(
        `Supabase proposal source read failed: ${persistedProposalResult.error.message}`
      );

    const proposalIdByFieldKey = new Map(
      (persistedProposalResult.data ?? []).map(proposal => [
        proposal.field_key,
        proposal.id
      ])
    );
    const transcriptIdByTurnId = new Map(
      (persistedTranscriptResult.data ?? []).map(segment => [
        `t${segment.sequence_number}`,
        segment.id
      ])
    );
    const proposalIds = encounter.proposals
      .map(proposal => proposalIdByFieldKey.get(proposal.id))
      .filter((id): id is number => typeof id === "number");
    if (proposalIds.length) {
      const { error } = await this.client
        .from("pac_field_sources")
        .delete()
        .in("proposal_id", proposalIds);
      if (error)
        throw new Error(`Supabase proposal source reset failed: ${error.message}`);
    }
    const sourceRows = sourceRowsToInsert(
      encounter.proposals,
      proposalIdByFieldKey,
      transcriptIdByTurnId
    );
    if (sourceRows.length) {
      const { error } = await this.client
        .from("pac_field_sources")
        .insert(sourceRows);
      if (error)
        throw new Error(`Supabase proposal source write failed: ${error.message}`);
    }

    if (encounter.checklistSuggestions.length) {
      const { error } = await this.client
        .from("pac_checklist_suggestions")
        .upsert(
          encounter.checklistSuggestions.map(suggestion => ({
            id: suggestion.id,
            encounter_id: row.id,
            model_run_id: suggestion.modelRunId,
            procedure_name: suggestion.procedure,
            category_id: suggestion.categoryId,
            question: suggestion.question,
            rationale: suggestion.rationale,
            approval_state: suggestion.approvalState,
            decided_by: suggestion.decidedBy ?? null,
            decided_at: suggestion.decidedAt ?? null
          })),
          { onConflict: "id" }
        );
      if (error)
        throw new Error(`Supabase checklist suggestion write failed: ${error.message}`);
    }

    const checklistContextChanged =
      row.checklist_template_id !== encounter.checklistContext.templateId ||
      row.checklist_version !== encounter.checklistContext.version ||
      JSON.stringify(row.checklist_context_flags) !==
        JSON.stringify(encounter.checklistContext.contextFlags) ||
      row.checklist_library_procedure !==
        (encounter.checklistLibrary?.normalizedProcedure ?? null) ||
      row.checklist_library_version !==
        (encounter.checklistLibrary?.version ?? null) ||
      row.checklist_library_source !==
        (encounter.checklistLibrary?.source ?? null);
    if (row.state !== encounter.state || checklistContextChanged) {
      const { error } = await this.client
        .from("encounters")
        .update({
          state: encounter.state,
          checklist_template_id: encounter.checklistContext.templateId,
          checklist_version: encounter.checklistContext.version,
          checklist_context_flags: encounter.checklistContext.contextFlags,
          checklist_library_procedure:
            encounter.checklistLibrary?.normalizedProcedure ?? null,
          checklist_library_version:
            encounter.checklistLibrary?.version ?? null,
          checklist_library_source:
            encounter.checklistLibrary?.source ?? null,
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);
      if (error)
        throw new Error(`Supabase encounter update failed: ${error.message}`);
    }

    const latestAudit = encounter.audit.at(-1);
    if (latestAudit && latestAudit.action !== "synthetic_demo_seeded") {
      const { error } = await this.client.from("audit_events").insert({
        organization_id: (
          await this.client
            .from("encounters")
            .select("organization_id")
            .eq("id", row.id)
            .single()
        ).data?.organization_id,
        encounter_id: row.id,
        actor_id: row.assigned_clinician_id,
        action: latestAudit.action,
        detail: latestAudit.detail
      });
      if (error) throw new Error(`Supabase audit append failed: ${error.message}`);
    }

    if (encounter.state === "signed" && row.state !== "signed") {
      const { error } = await this.client.from("pac_note_versions").insert({
        encounter_id: row.id,
        version_number: 1,
        content: encounter,
        status: "signed",
        signed_by: row.assigned_clinician_id,
        signed_at: new Date().toISOString()
      });
      if (error)
        throw new Error(`Supabase signed note write failed: ${error.message}`);
    }

    return (await this.get(encounter.id)) ?? encounter;
  }

  async searchPatients(): Promise<PatientSummary[]> {
    throw new Error("Supabase patient search requires the longitudinal PAC migration.");
  }

  async createPatient(): Promise<PatientSummary> {
    throw new Error("Supabase patient creation requires the longitudinal PAC migration.");
  }

  async createEncounter(): Promise<Encounter> {
    throw new Error("Supabase encounter creation requires the longitudinal PAC migration.");
  }

  async listRecordings(_input: { organizationId: string }) {
    return this.#demoStore.listRecordings(_input);
  }

  async findChecklistLibraryVersion(input: {
    organizationId: string;
    normalizedProcedure: string;
  }) {
    if (input.organizationId === "org-1")
      return this.#demoStore.findChecklistLibraryVersion(input);
    const { data, error } = await this.client
      .from("pac_checklist_library_versions")
      .select(
        "organization_id,normalized_procedure,version,source,content,published_by"
      )
      .eq("organization_id", input.organizationId)
      .eq("normalized_procedure", input.normalizedProcedure)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error)
      throw new Error(`Supabase checklist library read failed: ${error.message}`);
    if (!data) return null;
    return ChecklistLibraryVersionSchema.parse({
      organizationId: data.organization_id,
      normalizedProcedure: data.normalized_procedure,
      version: data.version,
      source: data.source,
      publishedBy: data.published_by,
      items: data.content.items
    });
  }

  async publishChecklistLibraryVersion(
    version: Parameters<
      MemoryEncounterStore["publishChecklistLibraryVersion"]
    >[0]
  ) {
    if (version.organizationId === "org-1")
      return this.#demoStore.publishChecklistLibraryVersion(version);
    const { error } = await this.client
      .from("pac_checklist_library_versions")
      .insert({
        organization_id: version.organizationId,
        normalized_procedure: version.normalizedProcedure,
        version: version.version,
        source: version.source,
        content: { items: version.items },
        published_by: version.publishedBy
      });
    if (error)
      throw new Error(`Supabase checklist library write failed: ${error.message}`);
    return version;
  }
}
