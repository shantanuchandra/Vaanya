import { describe, expect, it } from "vitest";
import { normalizeDatabaseTimestamp } from "./supabase-encounter-store";

describe("Supabase encounter mapping", () => {
  it("normalizes Postgres offset timestamps to contract ISO datetimes", () => {
    expect(normalizeDatabaseTimestamp("2026-07-26T06:15:00+00:00")).toBe(
      "2026-07-26T06:15:00.000Z"
    );
  });
});
