import { describe, expect, it } from "vitest";
import { createDemoEncounters } from "./demo-cohort";
import { MemoryEncounterStore, recordingListItem } from "./encounter-store";

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
    await expect(
      store.listRecordings({
        organizationId: "4cbcb624-214f-4f4a-a3dc-08b41fa10000"
      })
    ).resolves.toHaveLength(10);
  });

  it("reports every required item as an open gap before an upload is processed", () => {
    const encounter = createDemoEncounters().find(
      item => item.id === "synthetic-kavya"
    );
    expect(encounter).toBeDefined();

    expect(recordingListItem(encounter!)).toMatchObject({
      status: "uploaded",
      answeredCount: 0,
      applicableCount: encounter!.checklist?.applicableCount,
      criticalGapCount: 12
    });
  });
});
