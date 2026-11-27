// @vitest-environment node
/** T-29 Face reading from a die pose with the app's getValueFromDiceGroup and mesh locators. */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { getValueFromDiceGroup } from "../helpers/getValueFromDiceGroup";
import { LOCATORS } from "../meshes/locators";
import { DiceType } from "../types/DiceType";
import { buildDieGroup } from "./physicsWorld";

const TYPES: DiceType[] = ["D4", "D6", "D8", "D10", "D12"];
const UP = new THREE.Vector3(0, 1, 0);

function faceOf(name: string, type: DiceType) {
  const n = parseInt(name.slice(12));
  return n === 0 && type === "D10" ? 10 : n;
}

describe("T-29 face reading from a die pose", () => {
  for (const sharp of [false, true]) {
    for (const type of TYPES) {
      it(`T-29 ${sharp ? "sharp" : "rounded"} ${type}: each locator turned up reads its face, also tilted 20 degrees`, () => {
        for (const { name, position } of LOCATORS[sharp ? "sharp" : "rounded"][type]) {
          const { root, physicsGroup } = buildDieGroup(type, sharp);
          const direction = new THREE.Vector3(...position!).normalize();
          root.quaternion.setFromUnitVectors(direction, UP);
          expect(getValueFromDiceGroup(physicsGroup, type)).toBe(faceOf(name, type));

          // Tilt around a horizontal axis: the same face stays the most "up".
          const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(20));
          root.quaternion.premultiply(tilt);
          expect(getValueFromDiceGroup(physicsGroup, type)).toBe(faceOf(name, type));
        }
      });
    }
  }

  it("T-29 sharp and rounded locators have the same names: 1..N, D10 0..9", () => {
    for (const type of TYPES) {
      const names = (kind: "sharp" | "rounded") => LOCATORS[kind][type].map((l) => l.name).sort();
      expect(names("sharp")).toEqual(names("rounded"));
      const faces = LOCATORS.sharp[type].map((l) => faceOf(l.name, type)).sort((a, b) => a - b);
      const n = parseInt(type.slice(1));
      expect(faces).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });

  it("T-29 D10 locator 0 reads as 10", () => {
    const { root, physicsGroup } = buildDieGroup("D10");
    const zero = LOCATORS.rounded.D10.find((l) => l.name.endsWith("_0"))!;
    root.quaternion.setFromUnitVectors(new THREE.Vector3(...zero.position!).normalize(), UP);
    expect(getValueFromDiceGroup(physicsGroup, "D10")).toBe(10);
  });

  it("T-29 a group without a \"dice\" child reads 0", () => {
    expect(getValueFromDiceGroup(new THREE.Group(), "D6")).toBe(0);
  });
});
