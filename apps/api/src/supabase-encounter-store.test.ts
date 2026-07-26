import { describe, expect, it } from "vitest";
import {
  normalizeDatabaseTimestamp,
  SupabaseEncounterStore,
  transcriptRowsToInsert
} from "./supabase-encounter-store";

describe("Supabase encounter mapping", () => {
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
});
