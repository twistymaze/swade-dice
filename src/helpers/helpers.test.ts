import { afterEach, describe, expect, it, vi } from "vitest";
import { isPlainObject } from "./isPlainObject";
import { isDice } from "../types/Dice";
import { isDie, Die } from "../types/Die";
import { getDieFromDice } from "./getDieFromDice";
import { getDieWeightClass } from "./getDieWeightClass";
import { getDieDensity } from "./getDieDensity";
import { DiceStyle } from "../types/DiceStyle";
import { DiceType } from "../types/DiceType";

const die = (id: string, type: DiceType = "D6", style: DiceStyle = "GALAXY"): Die => ({ id, type, style });

describe("type guards and dice flattening", () => {
  it("isPlainObject: {} and Object.create(null) true; array, Date, class instance, null false", () => {
    class Thing {}
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Thing())).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
  });

  it("isDice: dice array needed; combination must be a string when present", () => {
    expect(isDice({ dice: [] })).toBe(true);
    expect(isDice({ dice: [], combination: "SUM" })).toBe(true);
    expect(isDice({ dice: [], combination: 1 })).toBe(false);
    expect(isDice({ dice: "x" })).toBe(false);
    expect(isDice([])).toBe(false);
  });

  it("isDie: id, style and type must be strings", () => {
    expect(isDie(die("1"))).toBe(true);
    expect(isDie({ id: 1, style: "GALAXY", type: "D6" })).toBe(false);
    expect(isDie({ id: "1", type: "D6" })).toBe(false);
  });

  it("nested Dice are flattened in order; unknown entries are skipped", () => {
    const roll = {
      dice: [
        die("1"),
        { dice: [die("2"), { dice: [die("3")] }, { bogus: true }] },
        42,
        die("4"),
      ],
    } as unknown as Parameters<typeof getDieFromDice>[0];
    expect(getDieFromDice(roll).map((d) => d.id)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("low-risk helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("weight class: IRON D4 MEDIUM, IRON other HEAVY, other D4 LIGHT, other MEDIUM", () => {
    expect(getDieWeightClass(die("1", "D4", "IRON"))).toBe("MEDIUM");
    expect(getDieWeightClass(die("1", "D12", "IRON"))).toBe("HEAVY");
    expect(getDieWeightClass(die("1", "D4", "GLASS"))).toBe("LIGHT");
    expect(getDieWeightClass(die("1", "D8", "GLASS"))).toBe("MEDIUM");
  });

  it("density: IRON 2, WALNUT and GLASS 1.5, others 1", () => {
    expect(getDieDensity(die("1", "D6", "IRON"))).toBe(2);
    expect(getDieDensity(die("1", "D6", "WALNUT"))).toBe(1.5);
    expect(getDieDensity(die("1", "D6", "GLASS"))).toBe(1.5);
    expect(getDieDensity(die("1", "D6", "NEBULA"))).toBe(1);
  });

  it("getNextBuffer: null before loading, then cycles through the loaded buffers", async () => {
    vi.resetModules();
    const THREE = await import("three");
    let n = 0;
    vi.spyOn(THREE.AudioLoader.prototype, "load").mockImplementation(function (_url, onLoad) {
      onLoad?.({ n: n++ } as unknown as AudioBuffer);
    });
    const audio = await import("../audio/getAudioBuffer");
    expect(audio.getNextBuffer("HEAVY", "SHAKE")).toBeNull();
    audio.loadAudioBuffers();
    audio.loadAudioBuffers(); // loads once
    const first = audio.getNextBuffer("LIGHT", "DICE");
    const seq = [first, audio.getNextBuffer("LIGHT", "DICE"), audio.getNextBuffer("LIGHT", "DICE"), audio.getNextBuffer("LIGHT", "DICE")];
    expect(new Set(seq).size).toBe(4);
    expect(audio.getNextBuffer("LIGHT", "DICE")).toBe(first);
    expect(audio.getNextBuffer("HEAVY", "SHAKE")).not.toBeNull();
    expect(audio.getNextBuffer("LIGHT", "SHAKE")).toBeNull(); // no light shake sounds
    expect(n).toBe(38);
  });

  it("debug hotkeys (dev): Ctrl+Alt+Shift+D toggles physics debug, +C toggles orbit, other keys do nothing", async () => {
    vi.resetModules();
    const { useDebugStore } = await import("../debug/store");
    const press = (code: string, mods = { ctrlKey: true, altKey: true, shiftKey: true }) =>
      document.body.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, ...mods }));
    press("KeyD");
    expect(useDebugStore.getState()).toEqual({ allowOrbit: false, allowPhysicsDebug: true });
    press("KeyC");
    expect(useDebugStore.getState()).toEqual({ allowOrbit: true, allowPhysicsDebug: true });
    press("KeyD", { ctrlKey: true, altKey: true, shiftKey: false });
    press("KeyX");
    expect(useDebugStore.getState()).toEqual({ allowOrbit: true, allowPhysicsDebug: true });
    press("KeyD");
    expect(useDebugStore.getState().allowPhysicsDebug).toBe(false);
  });
});
