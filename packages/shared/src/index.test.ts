import { describe, expect, it } from "vitest";
import { calculatePlantRisk } from "./index";

describe("calculatePlantRisk", () => {
  it("returns low risk for healthy ranges", () => {
    expect(calculatePlantRisk(55, 24)).toBe(13);
  });

  it("returns elevated risk for dry and hot conditions", () => {
    expect(calculatePlantRisk(20, 35)).toBe(65);
  });
});
