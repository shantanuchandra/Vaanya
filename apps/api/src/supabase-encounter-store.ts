import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  EncounterSchema,
  type Encounter,
  type PatientSummary
} from "@vaanaya/contracts";
import type { EncounterStore } from "./encounter-store";

type EncounterRow = {
  id: number;
  patient_reference: string;
  procedure_name: string;
  preferred_language: string;
  state: Encounter["state"];
  assigned_clinician_id: string | null;
};

export function normalizeDatabaseTimestamp(value: string): string {
  return new Date(value).toISOString();
}

export class SupabaseEncounterStore implements EncounterStore {
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
        "id,patient_reference,procedure_name,preferred_language,state,assigned_clinician_id"
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
    const encounter = await this.encounterRow(id);
    if (!encounter) return null;

    const [transcriptResult, proposalsResult, consentResult, auditResult] =
      await Promise.all([
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
          .order("occurred_at")
      ]);

    for (const [label, result] of [
      ["transcript", transcriptResult],
      ["proposals", proposalsResult],
      ["consent", consentResult],
      ["audit", auditResult]
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

    return EncounterSchema.parse({
      id: id === "demo" ? "demo" : String(encounter.id),
      patientReference: encounter.patient_reference,
      procedure: encounter.procedure_name,
      preferredLanguage: encounter.preferred_language,
      state: encounter.state,
      consentRecorded: Boolean(consentResult.data?.length),
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
    });
  }

  async save(encounter: Encounter): Promise<Encounter> {
    const row = await this.encounterRow(encounter.id);
    if (!row) throw new Error("Cannot persist an encounter that does not exist.");
    if (!row.assigned_clinician_id)
      throw new Error("A clinician must be assigned before persistence.");

    const { data: persistedProposals, error: proposalReadError } =
      await this.client
        .from("pac_field_proposals")
        .select("id,field_key,field_state,proposed_value")
        .eq("encounter_id", row.id);
    if (proposalReadError)
      throw new Error(`Supabase proposal read failed: ${proposalReadError.message}`);

    for (const proposal of encounter.proposals) {
      const persisted = persistedProposals.find(
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

    if (row.state !== encounter.state) {
      const { error } = await this.client
        .from("encounters")
        .update({
          state: encounter.state,
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
}
