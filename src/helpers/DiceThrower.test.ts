import { afterEach, describe, expect, it, vi } from "vitest";
import { DiceThrower, getRandomDiceThrow, RandomRange } from "./DiceThrower";

/** Deterministic stand-in for Math.random (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rangeFrom = (next: () => number): RandomRange => (min, max) => next() * (max - min) + min;

describe("D-10 injectable RNG in DiceThrower", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the same seeded rng gives the same throw", () => {
    expect(getRandomDiceThrow(1.5, rangeFrom(seeded(7)))).toEqual(getRandomDiceThrow(1.5, rangeFrom(seeded(7))));
    expect(getRandomDiceThrow(1, rangeFrom(seeded(7)))).not.toEqual(getRandomDiceThrow(1, rangeFrom(seeded(8))));
  });

  it("the default draws from Math.random in the same order as an injected rng (behavior unchanged)", () => {
    const next = seeded(42);
    const values = Array.from({ length: 200 }, next);
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => values[i++]);
    const viaDefault = getRandomDiceThrow(2);
    const used = i;
    let j = 0;
    const viaInjected = getRandomDiceThrow(2, rangeFrom(() => values[j++]));
    expect(viaInjected).toEqual(viaDefault);
    expect(j).toBe(used);
  });

  it("DiceThrower uses the injected rng and keeps its history", () => {
    const a = new DiceThrower(rangeFrom(seeded(3)));
    const b = new DiceThrower(rangeFrom(seeded(3)));
    expect(a.getDiceThrow(0)).toEqual(b.getDiceThrow(0));
    expect(a.getDiceThrow(1)).toEqual(b.getDiceThrow(1));
    expect(a.getDiceThrow(0)).toBe(a.getDiceThrow(0));
  });
});

describe("D-10 no audio listener at import", () => {
  it("importing getAudioBuffer adds no window listener", async () => {
    const add = vi.spyOn(window, "addEventListener");
    vi.resetModules();
    await import("../audio/getAudioBuffer");
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
  });
});
