/**
 * What a die does when its face cannot be read (A-08): no locator found, or a
 * value the store rejects, for example a die cocked against a wall. Like at the
 * table, the die is re-thrown a few times; after that the nearest valid face is
 * used, so a roll always completes.
 */
import * as THREE from "three";

import { getMaxValueForDie, isValidFaceValue } from "../helpers/explosionHelpers";
import { DiceType } from "../types/DiceType";

/** Re-throws of one die before the nearest valid face is used */
export const MAX_RETHROWS = 3;

export type InvalidFaceAction = "rethrow" | "nearest";

/** Decide what to do after the store rejected a face; `rethrowsSoFar` counts earlier re-throws */
export function getInvalidFaceAction(
  rethrowsSoFar: number,
  maxRethrows = MAX_RETHROWS
): InvalidFaceAction {
  return rethrowsSoFar < maxRethrows ? "rethrow" : "nearest";
}

type RandomFn = (min: number, max: number) => number;

/**
 * A small re-throw of a die that lies in the tray: a short hop with a random
 * spin, so it lands on a face again.
 */
export function getRethrowVelocities(rand: RandomFn) {
  const spin = () => rand(2, 6) * (rand(0, 1) < 0.5 ? -1 : 1);
  return {
    linvel: { x: rand(-0.3, 0.3), y: rand(1, 1.5), z: rand(-0.3, 0.3) },
    angvel: { x: spin(), y: spin(), z: spin() },
  };
}

export interface FaceCandidate {
  /** Face number read from the locator name (D10 locator 0 = 10) */
  face: number;
  /** Dot product of the locator direction with world up (1 = straight up) */
  dot: number;
}

/**
 * The valid face whose locator points most upward. With no valid locator at all,
 * a uniformly random valid face (still fair).
 */
export function getNearestValidFace(
  candidates: FaceCandidate[],
  dieType: DiceType,
  rand: RandomFn
): number {
  let best: FaceCandidate | null = null;
  for (const candidate of candidates) {
    if (!isValidFaceValue(candidate.face, dieType)) continue;
    if (!best || candidate.dot > best.dot) best = candidate;
  }
  if (best) return best.face;
  const max = getMaxValueForDie(dieType);
  return Math.min(max, Math.max(1, Math.floor(rand(1, max + 1))));
}

const meshPosition = new THREE.Vector3();
const locatorPosition = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/** Every locator of a die group with its face number and how much it points up */
export function getFaceCandidates(parent: THREE.Object3D, dieType: DiceType): FaceCandidate[] {
  const mesh = parent.getObjectByName("dice")?.children[0];
  if (!mesh) return [];
  mesh.getWorldPosition(meshPosition);
  return mesh.children.map((locator) => {
    locator.getWorldPosition(locatorPosition);
    const dot = locatorPosition.sub(meshPosition).normalize().dot(up);
    let face = parseInt(locator.name.slice(12));
    if (face === 0 && dieType === "D10") face = 10;
    return { face, dot };
  });
}
