import { describe, expect, it } from "vitest";
import {
  checklistContextFromRow,
  normalizeDatabaseTimestamp,
  proposalRowsToInsert,
  sourceRowsToInsert,
  SupabaseEncounterStore,
  transcriptRowsToInsert
} from "./supabase-encounter-store";

describe("Supabase encounter mapping", () => {
  it("maps persisted checklist context into the versioned contract", () => {
    expect(
      checklistContextFromRow({
        checklist_template_id: "synthetic-pac",
        checklist_version: "synthetic-pac-v1",
        checklist_context_flags: ["pregnancy_question_applicable"]
      })
    ).toEqual({
      templateId: "synthetic-pac",
      version: "synthetic-pac-v1",
      contextFlags: ["pregnancy_question_applicable"]
    });
  });

  it("normalizes Postgres offset timestamps to contract ISO datetimes", () => {
    expect(normalizeDatabaseTimestamp("2026-07-26T06:15:00+00:00")).toBe(
      "2026-07-26T06:15:00.000Z"
    );
  });

  it("persists only transcript turns not already stored for the encounter", () => {
    expect(
      transcriptRowsToInsert(
        42,
        [
          {
            id: "turn-1",
            speaker: "clinician",
            language: "en-IN",
            original: "Do you take regular medicines?",
            translation: "Do you take regular medicines?",
            confidence: 0.94,
            offsetSeconds: 0
          },
          {
            id: "turn-2",
            speaker: "patient",
            language: "hi-IN",
            original: "Haan, lekin naam yaad nahi.",
            translation: "Yes, but I do not remember the name.",
            confidence: 0.91,
            offsetSeconds: 2.1
          }
        ],
        new Set([1])
      )
    ).toEqual([
      {
        encounter_id: 42,
        sequence_number: 2,
        speaker_role: "patient",
        source_language: "hi-IN",
        original_text: "Haan, lekin naam yaad nahi.",
        translated_text: "Yes, but I do not remember the name.",
        confidence: 0.91,
        offset_seconds: 2.1
      }
    ]);
  });

  it("preserves an unclassified diarization turn instead of dropping source evidence", () => {
    expect(
      transcriptRowsToInsert(
        42,
        [
          {
            id: "turn-1",
            speaker: "system",
            language: "hi-IN",
            original: "Speaker could not be classified.",
            translation: "Speaker could not be classified.",
            confidence: 0.51,
            offsetSeconds: 0
          }
        ],
        new Set()
      )
    ).toEqual([
      expect.objectContaining({
        encounter_id: 42,
        sequence_number: 1,
        speaker_role: "system",
        original_text: "Speaker could not be classified."
      })
    ]);
  });

  it("creates rows for newly structured PAC proposals", () => {
    expect(
      proposalRowsToInsert(
        42,
        "clinician-1",
        [
          {
            id: "medications",
            label: "Current/recent medicines",
            state: "uncertain",
            value: "Blood-thinning tablet; name unknown; last taken yesterday",
            sourceTurnIds: ["t2"],
            required: true
          }
        ],
        new Set()
      )
    ).toEqual([
      expect.objectContaining({
        encounter_id: 42,
        field_key: "medications",
        field_state: "uncertain",
        required: true,
        updated_by: "clinician-1"
      })
    ]);
  });

  it("maps proposal evidence links to persisted transcript segments", () => {
    expect(
      sourceRowsToInsert(
        [
          {
            id: "medications",
            label: "Current/recent medicines",
            state: "uncertain",
            value: "Name unknown",
            sourceTurnIds: ["t2", "missing-turn"],
            required: true
          }
        ],
        new Map([["medications", 91]]),
        new Map([["t2", 7]])
      )
    ).toEqual([{ proposal_id: 91, transcript_segment_id: 7 }]);
  });

  it("serves the deterministic synthetic worklist when Supabase mode is active", async () => {
    const store = new SupabaseEncounterStore({} as never);

    const recordings = await store.listRecordings({
      organizationId: "org-1"
    });

    expect(recordings).toHaveLength(10);
    expect(recordings[0]?.patient.displayName).toBe("Kavya Nair");
  });

  it("opens a non-default synthetic encounter without querying Supabase", async () => {
    const store = new SupabaseEncounterStore({} as never);

    const encounter = await store.get("synthetic-ananya");

    expect(encounter).toMatchObject({
      patient: { displayName: "Ananya Rao" },
      procedure: "Laparoscopic hysterectomy"
    });
  });

  it("keeps processed synthetic encounters in the demo store instead of querying a bigint database id", async () => {
    const store = new SupabaseEncounterStore({} as never);
    const encounter = await store.get("synthetic-kavya");
    expect(encounter).not.toBeNull();

    await store.save({
      ...encounter!,
      state: "clinician_review",
      customerSummary: "Draft ready for clinician review."
    });

    await expect(store.get("synthetic-kavya")).resolves.toMatchObject({
      state: "clinician_review",
      customerSummary: "Draft ready for clinician review."
    });
  });
});
