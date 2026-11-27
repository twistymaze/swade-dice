/**
 * Pure rules for "this die has stopped rolling". They run once per fixed physics step
 * (simulated time), never per render frame or on wall-clock time, so a slow or hidden
 * pane cannot lock a die in mid-air.
 */

/** Fixed physics time step of the dice world (seconds) */
export const PHYSICS_TIME_STEP = 1 / 120;
/** Minimum linear plus angular speed before a die counts as at rest */
export const MIN_ROLL_FINISHED_SPEED = 0.005;
/** A die above this height is not in the tray */
export const MAX_REST_HEIGHT = 1.5;
/** Force stop a die after 5 seconds of simulated time */
export const MAX_ROLL_STEPS = Math.round(5 / PHYSICS_TIME_STEP);
/**
 * A die still above the tray after `MAX_ROLL_STEPS` gets this long before it is
 * forced, so a roll always ends.
 */
export const HARD_MAX_ROLL_STEPS = 2 * MAX_ROLL_STEPS;

export interface Vector {
  x: number;
  y: number;
  z: number;
}

export interface DiePhysicsState {
  linvel: Vector;
  angvel: Vector;
  translation: Vector;
}

/** "rolling": keep simulating; "rest": the die is at rest in the tray; "timeout": force stop */
export type RestDecision = "rolling" | "rest" | "timeout";

function magnitude({ x, y, z }: Vector) {
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * Decide after a physics step whether a die is finished.
 * @param state body velocities and position after the step
 * @param steps physics steps simulated for this die so far (including this one)
 */
export function getRestDecision(
  state: DiePhysicsState,
  steps: number
): RestDecision {
  const speed = magnitude(state.linvel) + magnitude(state.angvel);
  const inTray = state.translation.y < MAX_REST_HEIGHT;
  if (speed < MIN_ROLL_FINISHED_SPEED && inTray) {
    return "rest";
  }
  if (steps >= HARD_MAX_ROLL_STEPS || (steps >= MAX_ROLL_STEPS && inTray)) {
    return "timeout";
  }
  return "rolling";
}
