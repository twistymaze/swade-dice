// @vitest-environment node
/**
 * T-28 Physics determinism and face reading (test plan section 3.3 / 4).
 * The world is built from the app's own data (tray layout, collider vertices,
 * face locators, roll-finished rules) and the face is read with the app's
 * getValueFromDiceGroup.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { DiceThrow } from "../types/DiceThrow";
import { DiceType } from "../types/DiceType";
import { Die } from "../types/Die";
import { MAX_ROLL_STEPS } from "../dice/rollFinished";
import { rollDie } from "./physicsWorld";

beforeAll(async () => {
  await RAPIER.init();
});

/** Fixed throws in the range DiceThrower produces */
const THROWS: DiceThrow[] = [
  {
    position: { x: 0.12, y: 1.1, z: -0.45 },
    rotation: { x: -0.3553, y: 0.1814, z: -0.7356, w: 0.5474 },
    linearVelocity: { x: -0.37, y: 0, z: 1.4 },
    angularVelocity: { x: 2.5, y: -4.1, z: 5.3 },
  },
  {
    position: { x: -0.25, y: 1.05, z: 0.6 },
    rotation: { x: 0.62, y: -0.21, z: 0.11, w: 0.747 },
    linearVelocity: { x: 0.75, y: 0, z: -1.8 },
    angularVelocity: { x: -3.2, y: 2.2, z: -4.4 },
  },
];

const FACES: Record<DiceType, number> = { D4: 4, D6: 6, D8: 8, D10: 10, D12: 12 };
const TYPES = Object.keys(FACES) as DiceType[];

/** Exact bit pattern of each float64, so any drift counts as a difference. */
const bits = (values: number[]) => {
  const view = new DataView(new ArrayBuffer(8));
  return values.map((v) => {
    view.setFloat64(0, v);
    return view.getBigUint64(0).toString(16);
  });
};

const die = (type: DiceType, style: Die["style"] = "GALAXY"): Die => ({ id: `t-${type}`, type, style });

describe("T-28 physics determinism and face reading (Rapier in Node)", () => {
  for (const type of TYPES) {
    it(`T-28 ${type}: the same throw twice gives the same pose and face`, () => {
      for (const dieThrow of THROWS) {
        const a = rollDie(die(type), dieThrow);
        const b = rollDie(die(type), dieThrow);
        expect(bits(b.transform)).toEqual(bits(a.transform));
        expect(b.face).toBe(a.face);
        expect(b.steps).toBe(a.steps);
        expect(a.decision).toBe("rest");
        expect(a.face).toBeGreaterThanOrEqual(1);
        expect(a.face).toBeLessThanOrEqual(FACES[type]);
        // At rest in the tray, not in mid-air.
        expect(a.transform[1]).toBeLessThan(0.3);
      }
    });
  }

  it("T-28 explosion throw (speed x1.5) and heavy dice also come to rest with a valid face", () => {
    const fast: DiceThrow = {
      ...THROWS[0],
      linearVelocity: { x: -0.37 * 1.5, y: 0, z: 1.4 * 1.5 },
    };
    const a = rollDie(die("D6", "IRON"), fast);
    const b = rollDie(die("D6", "IRON"), fast);
    expect(a.decision).toBe("rest");
    expect(bits(b.transform)).toEqual(bits(a.transform));
    expect(a.face).toBeGreaterThanOrEqual(1);
    expect(a.face).toBeLessThanOrEqual(6);
  });

  it("T-28 a die that never settles is forced after 600 steps and still yields a face", () => {
    // No gravity: the die spins in place inside the tray and never comes to rest.
    const spinning: DiceThrow = {
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 1, y: 2, z: 3 },
    };
    const a = rollDie(die("D8"), spinning, { gravityScale: 0 });
    expect(a.decision).toBe("timeout");
    expect(a.steps).toBe(MAX_ROLL_STEPS);
    expect(a.face).toBeGreaterThanOrEqual(1);
    expect(a.face).toBeLessThanOrEqual(8);
  });

  it("T-28 golden throw -> face table (a Rapier or collider change that alters results fails here)", () => {
    const table = TYPES.flatMap((type) =>
      THROWS.map((dieThrow, i) => {
        const { face, steps } = rollDie(die(type), dieThrow);
        return `${type} throw ${i}: face ${face} after ${steps} steps`;
      })
    );
    expect(table).toMatchSnapshot();
  });
});
