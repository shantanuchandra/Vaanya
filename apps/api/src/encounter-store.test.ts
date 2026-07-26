import { describe, expect, it } from "vitest";
import { createDemoEncounters } from "./demo-cohort";
import { MemoryEncounterStore } from "./encounter-store";

describe("recordings worklist", () => {
  it("pins unprocessed uploads before newer processed recordings", async () => {
    const store = new MemoryEncounterStore(createDemoEncounters());

    const items = await store.listRecordings({ organizationId: "org-1" });
    const firstProcessedIndex = items.findIndex(
      item => item.status !== "uploaded"
    );

    expect(firstProcessedIndex).toBeGreaterThan(0);
    expect(
      items
        .slice(0, firstProcessedIndex)
        .every(item => item.status === "uploaded")
    ).toBe(true);
    expect(items.slice(0, firstProcessedIndex).map(item => item.patient.displayName))
      .toEqual(["Kavya Nair", "Ameeth Dubey"]);
    expect(items).toHaveLength(10);
  });
});
