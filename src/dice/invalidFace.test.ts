// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  getInvalidFaceAction,
  getNearestValidFace,
  getRethrowVelocities,
  getFaceCandidates,
  MAX_RETHROWS,
} from "./invalidFace";
import { buildDieGroup } from "../test/physicsWorld";

const mid = (min: number, max: number) => (min + max) / 2;

describe("invalid face: re-throw, then nearest face", () => {
  it("re-throws up to 3 times, then uses the nearest face", () => {
    expect(MAX_RETHROWS).toBe(3);
    expect([0, 1, 2, 3, 4].map((n) => getInvalidFaceAction(n))).toEqual([
      "rethrow",
      "rethrow",
      "rethrow",
      "nearest",
      "nearest",
    ]);
    expect(getInvalidFaceAction(0, 0)).toBe("nearest");
  });

  it("nearest face is the valid locator that points most up", () => {
    const candidates = [
      { face: 0, dot: 0.99 }, // unparsable / invalid for a D6
      { face: 3, dot: 0.7 },
      { face: 5, dot: 0.71 },
      { face: Number.NaN, dot: 1 },
    ];
    expect(getNearestValidFace(candidates, "D6", mid)).toBe(5);
  });

  it("D10 locator 0 counts as face 10", () => {
    expect(getNearestValidFace([{ face: 10, dot: 0.9 }, { face: 4, dot: 0.2 }], "D10", mid)).toBe(10);
  });

  it("without any valid locator a random valid face is used (always 1..N)", () => {
    expect(getNearestValidFace([], "D8", () => 1)).toBe(1);
    expect(getNearestValidFace([], "D8", (_min, max) => max)).toBe(8);
    expect(getNearestValidFace([{ face: 99, dot: 1 }], "D8", mid)).toBe(5);
  });

  it("re-throw is a small hop with spin", () => {
    const { linvel, angvel } = getRethrowVelocities(mid);
    expect(linvel.y).toBeGreaterThanOrEqual(1);
    expect(linvel.y).toBeLessThanOrEqual(1.5);
    expect(Math.abs(linvel.x)).toBeLessThanOrEqual(0.3);
    for (const v of [angvel.x, angvel.y, angvel.z]) {
      expect(Math.abs(v)).toBeGreaterThanOrEqual(2);
      expect(Math.abs(v)).toBeLessThanOrEqual(6);
    }
  });

  it("face candidates from a real die group: the up face has the highest dot", () => {
    const { physicsGroup } = buildDieGroup("D6");
    const candidates = getFaceCandidates(physicsGroup, "D6");
    expect(candidates).toHaveLength(6);
    expect(getNearestValidFace(candidates, "D6", mid)).toBe(6); // locator 6 is at +y
  });
});
