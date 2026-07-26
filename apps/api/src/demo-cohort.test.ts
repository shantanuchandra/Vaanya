import { describe, expect, it } from "vitest";
import { createDemoEncounters } from "./demo-cohort";

describe("synthetic PAC cohort", () => {
  it("contains ten labelled patients with unique fictional contacts and varied procedures", () => {
    const encounters = createDemoEncounters();

    expect(encounters).toHaveLength(10);
    expect(encounters.map(item => item.patient?.displayName)).toEqual([
      "Sulochana Patel",
      "Udayan Walvekar",
      "Abhishek Patil",
      "Ameeth Dubey",
      "Rajnish Kumar",
      "Ananya Rao",
      "Meera Kulkarni",
      "Kavya Nair",
      "Priya Deshmukh",
      "Nandini Iyer"
    ]);
    expect(new Set(encounters.map(item => item.patient?.mobileNumber)).size).toBe(
      10
    );
    expect(
      encounters.every(
        item => item.audit[0]?.detail.syntheticDemo === true
      )
    ).toBe(true);
    expect(
      encounters.find(item => item.patient?.displayName === "Ananya Rao")
        ?.procedure
    ).toBe("Laparoscopic hysterectomy");
    expect(
      encounters.find(
        item => item.patient?.displayName === "Sulochana Patel"
      )?.procedure
    ).toBe("Laparoscopic hernia repair");
    expect(encounters[0]?.patient?.sex).toBe("female");
    expect(
      new Set(encounters.map(item => item.checklist?.procedureFamily))
    ).toEqual(
      new Set([
        "laparoscopic_abdominal",
        "hysterectomy",
        "knee_replacement",
        "upper_gi_endoscopy",
        "urological",
        "cataract",
        "breast"
      ])
    );
    expect(
      encounters.every(
        item => item.checklist?.version === "synthetic-pac-v1"
      )
    ).toBe(true);
  });
});
