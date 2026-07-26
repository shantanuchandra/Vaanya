import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceText } from "./EvidenceText";

describe("EvidenceText", () => {
  it("marks grounded evidence phrases without changing the transcript text", () => {
    const { container } = render(
      <EvidenceText
        text="I take a blood thinner but forgot the name."
        phrases={["blood thinner", "FORGOT THE NAME"]}
        lang="en-IN"
      />
    );

    expect(container.querySelectorAll("mark")).toHaveLength(2);
    expect(container.querySelectorAll("mark")[0]?.textContent).toBe(
      "blood thinner"
    );
    expect(container.querySelectorAll("mark")[1]?.textContent).toBe(
      "forgot the name"
    );
    expect(container.textContent).toBe(
      "I take a blood thinner but forgot the name."
    );
  });

  it("keeps overlapping or unmatched phrases from duplicating text", () => {
    const { container } = render(
      <EvidenceText
        text="No allergy was recalled."
        phrases={["No allergy", "allergy", "invented phrase"]}
        lang="en-IN"
      />
    );

    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container.textContent).toBe("No allergy was recalled.");
  });
});
