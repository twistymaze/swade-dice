import { describe, expect, it } from "vitest";
import {
  canStartFairnessTest,
  CHI_SQUARED_CRITICAL_005,
  chiSquared,
  countFaces,
  expectedPerFace,
  summarizeFairness,
} from "./fairnessMath";

describe("fairness math", () => {
  it("T-B4 the expectation uses the rolled count, not the planned count", () => {
    // 60 rolls of a d6 made (stopped early of 500 planned), perfectly even
    const values = Array.from({ length: 60 }, (_, i) => (i % 6) + 1);
    const s = summarizeFairness(values, "D6");
    expect(s.expected).toBe(10);
    expect(s.chiSquared).toBe(0);
    expect(s.isFair).toBe(true);
  });

  it("T-B5 critical values are for df = sides - 1 at p = 0.05", () => {
    expect(CHI_SQUARED_CRITICAL_005).toEqual({ D4: 7.815, D6: 11.07, D8: 14.067, D10: 16.919, D12: 19.675 });
  });

  it("chi-squared statistic: counts [10, 20] -> expected 15, (25 + 25) / 15", () => {
    expect(expectedPerFace([10, 20])).toBe(15);
    expect(chiSquared([10, 20])).toBeCloseTo(50 / 15, 10);
    expect(chiSquared([0, 0, 0])).toBe(0);
  });

  it("a clearly biased d4 fails", () => {
    const values = [...Array(100).fill(4), ...Array(20).fill(1), ...Array(20).fill(2), ...Array(20).fill(3)];
    expect(summarizeFairness(values, "D4").isFair).toBe(false);
  });

  it("T-B6 values out of range (0, 7, 2.5, NaN for a d6) are not counted", () => {
    expect(countFaces([0, 7, 2.5, Number.NaN, 1, 6, 6], 6)).toEqual([1, 0, 0, 0, 0, 2]);
  });

  it("T-B7 Start needs exactly one die and at least one roll", () => {
    expect(canStartFairnessTest({ a: 1 }, 500)).toBe(true);
    expect(canStartFairnessTest({ a: 1 }, 0)).toBe(false);
    expect(canStartFairnessTest({ a: 2 }, 500)).toBe(false);
    expect(canStartFairnessTest({ a: 0 }, 500)).toBe(false);
    expect(canStartFairnessTest({}, 500)).toBe(false);
  });
});

describe("T-30 fairness statistics (chi-squared)", () => {
  it("a perfectly uniform d6, 600 rolls -> statistic 0, expected 100, fair", () => {
    const values = Array.from({ length: 600 }, (_, i) => (i % 6) + 1);
    const s = summarizeFairness(values, "D6");
    expect(s.counts).toEqual([100, 100, 100, 100, 100, 100]);
    expect(s.expected).toBe(100);
    expect(s.chiSquared).toBe(0);
    expect(s.isFair).toBe(true);
  });

  it("all 6s -> unfair", () => {
    const s = summarizeFairness(Array(600).fill(6), "D6");
    expect(s.chiSquared).toBeCloseTo(3000, 6);
    expect(s.isFair).toBe(false);
  });

  it.each([
    ["D4", 7.815],
    ["D6", 11.07],
    ["D8", 14.067],
    ["D10", 16.919],
    ["D12", 19.675],
  ] as const)("%s uses the df = sides - 1 critical value %f", (type, critical) => {
    expect(summarizeFairness([1], type).criticalValue).toBe(critical);
  });

  it("stopped early: 500 planned, 100 even d4 rolls made -> fair (expected from the rolls made)", () => {
    const values = Array.from({ length: 100 }, (_, i) => (i % 4) + 1);
    const s = summarizeFairness(values, "D4");
    expect(s.expected).toBe(25);
    expect(s.isFair).toBe(true);
  });

  it("no rolls -> no division by zero: expected 0, statistic 0, all finite", () => {
    const s = summarizeFairness([], "D8");
    expect(s.counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(s.expected).toBe(0);
    expect(s.chiSquared).toBe(0);
    expect(Number.isFinite(s.chiSquared)).toBe(true);
  });

  it("values 0 and > sides do not create new faces", () => {
    const s = summarizeFairness([0, 5, -1, 1, 2, 3, 4], "D4");
    expect(s.counts).toEqual([1, 1, 1, 1]);
    expect(s.counts).toHaveLength(4);
  });

  it("an unknown die type throws (D20/D100 were removed, OD-8)", () => {
    expect(() => summarizeFairness([1], "D20" as never)).toThrow(/Unknown die type/);
  });
});
