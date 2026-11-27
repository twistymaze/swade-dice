import { describe, expect, it } from "vitest";
import {
  getRestDecision,
  HARD_MAX_ROLL_STEPS,
  MAX_REST_HEIGHT,
  MAX_ROLL_STEPS,
  MIN_ROLL_FINISHED_SPEED,
  PHYSICS_TIME_STEP,
} from "./rollFinished";

const zero = { x: 0, y: 0, z: 0 };
const state = (speed: number, y: number) => ({
  linvel: { x: speed, y: 0, z: 0 },
  angvel: zero,
  translation: { x: 0, y, z: 0 },
});

describe("E-13 roll-finished rules (physics steps, not frames)", () => {
  it("E-13 keeps the old thresholds: speed 0.005, height 1.5, 5 s at 1/120 s steps", () => {
    expect(MIN_ROLL_FINISHED_SPEED).toBe(0.005);
    expect(MAX_REST_HEIGHT).toBe(1.5);
    expect(PHYSICS_TIME_STEP).toBe(1 / 120);
    expect(MAX_ROLL_STEPS).toBe(600);
  });

  it("E-13 a slow die in the tray is at rest", () => {
    expect(getRestDecision(state(0.004, 0.1), 50)).toBe("rest");
  });

  it("E-13 linear and angular speed are added", () => {
    const s = {
      linvel: { x: 0.003, y: 0, z: 0 },
      angvel: { x: 0, y: 0.003, z: 0 },
      translation: { x: 0, y: 0.1, z: 0 },
    };
    expect(getRestDecision(s, 50)).toBe("rolling");
  });

  it("E-13 a moving die keeps rolling before the step limit", () => {
    expect(getRestDecision(state(1, 0.1), MAX_ROLL_STEPS - 1)).toBe("rolling");
  });

  it("E-13 a still die above the tray is never at rest", () => {
    expect(getRestDecision(state(0, 1.6), 10)).toBe("rolling");
  });

  it("E-13 after 600 steps a die in the tray is forced", () => {
    expect(getRestDecision(state(1, 0.1), MAX_ROLL_STEPS)).toBe("timeout");
  });

  it("E-13 after 600 steps a die above the tray is not read in mid-air", () => {
    expect(getRestDecision(state(1, 2), MAX_ROLL_STEPS)).toBe("rolling");
    expect(getRestDecision(state(1, 2), HARD_MAX_ROLL_STEPS)).toBe("timeout");
  });

  it("E-13 the decision depends only on physics state and step count", () => {
    // Same inputs, same answer: no wall clock, no frame count.
    const a = getRestDecision(state(0.0049, 1.49), 7);
    const b = getRestDecision(state(0.0049, 1.49), 7);
    expect(a).toBe(b);
  });
});
