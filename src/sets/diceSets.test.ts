import { describe, expect, it } from "vitest";
import { diceSets } from "./diceSets";
import { getPluginId } from "../plugin/getPluginId";
import { ROLL_CHANNEL } from "../plugin/rollWire";
import ids from "../test/fixtures/golden/ids.json";

const STYLES = ["GALAXY", "GEMSTONE", "GLASS", "IRON", "NEBULA", "SUNRISE", "SUNSET", "WALNUT"];

describe("ids and constants", () => {
  it("getPluginId gives the golden broadcast channel and popover id", () => {
    expect(getPluginId("roll-result")).toBe(ids.broadcastChannels.rollResult);
    expect(ROLL_CHANNEL).toBe(ids.broadcastChannels.rollResult);
    expect(getPluginId("notification-popover")).toBe(ids.popovers.notification);
  });

  it("8 standard sets plus \"all\"; set ids are <STYLE>_STANDARD", () => {
    expect(diceSets.map((s) => s.id)).toEqual([...STYLES.map((s) => `${s}_STANDARD`), "all"]);
  });

  it("each standard set has D4..D12 only, in order, of its own style (no D20/D100)", () => {
    for (const set of diceSets.filter((s) => s.id !== "all")) {
      const style = set.id.replace("_STANDARD", "");
      expect(set.dice.map((d) => d.type)).toEqual(["D4", "D6", "D8", "D10", "D12"]);
      expect(set.dice.every((d) => d.style === style)).toBe(true);
      expect(set.dice.map((d) => d.id)).toEqual(["D4", "D6", "D8", "D10", "D12"].map((t) => `${set.id}_${t}`));
    }
  });

  it("\"all\" has the 40 dice of the standard sets, ids unique", () => {
    const all = diceSets.find((s) => s.id === "all")!;
    expect(all.dice).toHaveLength(40);
    expect(new Set(all.dice.map((d) => d.id)).size).toBe(40);
  });
});
