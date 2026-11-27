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

describe("T-43 throw generation", () => {
  const len = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

  it("position in range, unit quaternion, velocity toward the tray center, angular 2..6", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const t = getRandomDiceThrow(undefined, rangeFrom(seeded(seed)));
      expect(t.position.x).toBeGreaterThanOrEqual(-0.3);
      expect(t.position.x).toBeLessThan(0.3);
      expect(t.position.y).toBeGreaterThanOrEqual(1);
      expect(t.position.y).toBeLessThan(1.2);
      expect(t.position.z).toBeGreaterThanOrEqual(-0.8);
      expect(t.position.z).toBeLessThan(0.8);
      const q = t.rotation;
      expect(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1)).toBeLessThan(1e-9);
      expect(t.linearVelocity.y).toBeCloseTo(0, 12);
      // points inward: opposite to the horizontal position
      expect(t.linearVelocity.x * t.position.x + t.linearVelocity.z * t.position.z).toBeLessThan(0);
      expect(len(t.linearVelocity)).toBeGreaterThanOrEqual(1);
      expect(len(t.linearVelocity)).toBeLessThan(2);
      for (const a of [t.angularVelocity.x, t.angularVelocity.y, t.angularVelocity.z]) {
        expect(a).toBeGreaterThanOrEqual(2);
        expect(a).toBeLessThan(6);
      }
    }
  });

  it("a position at (0, y, 0) gives zero linear velocity", () => {
    // x and z draws hit the middle of their ranges; the other draws come from a seeded rng
    const other = rangeFrom(seeded(5));
    let call = 0;
    const rng: RandomRange = (min, max) => {
      call++;
      return call === 1 || call === 3 ? (min + max) / 2 : other(min, max);
    };
    const t = getRandomDiceThrow(3, rng);
    expect(t.position.x).toBe(0);
    expect(t.position.z).toBe(0);
    expect(t.linearVelocity).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("speedMultiplier scales the speed only (missing or 0 -> x1)", () => {
    const base = getRandomDiceThrow(undefined, rangeFrom(seeded(9)));
    const fast = getRandomDiceThrow(3, rangeFrom(seeded(9)));
    const zero = getRandomDiceThrow(0, rangeFrom(seeded(9)));
    expect(len(fast.linearVelocity)).toBeCloseTo(3 * len(base.linearVelocity), 12);
    expect(zero).toEqual(base);
    expect(fast.position).toEqual(base.position);
    expect(fast.angularVelocity).toEqual(base.angularVelocity);
  });

  it("DiceThrower keeps at least 0.25 between dice when possible, caches by index, clearHistory resets", () => {
    const thrower = new DiceThrower(rangeFrom(seeded(11)));
    const throws = Array.from({ length: 6 }, (_, i) => thrower.getDiceThrow(i));
    for (let i = 0; i < throws.length; i++) {
      for (let j = i + 1; j < throws.length; j++) {
        const a = throws[i].position;
        const b = throws[j].position;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThanOrEqual(0.25);
      }
    }
    expect(thrower.getDiceThrow(2)).toBe(throws[2]);
    thrower.clearHistory();
    expect(thrower.getDiceThrow(0)).not.toBe(throws[0]);
  });
});
