/**
 * Node-side model of the app's dice world (DiceRoll + TrayColliders + PhysicsDice)
 * built from the same data: tray layout, collider vertices, face locators and
 * the roll-finished rules. Used by the physics determinism tests.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

import { DICE_COLLIDER_VERTICES } from "../colliders/colliderVertices";
import { TRAY_CUBOID_HALF_EXTENTS, TRAY_FLOOR, TRAY_WALLS } from "../colliders/trayDimensions";
import { getRestDecision, PHYSICS_TIME_STEP, RestDecision } from "../dice/rollFinished";
import { getDieDensity } from "../helpers/getDieDensity";
import { getValueFromDiceGroup } from "../helpers/getValueFromDiceGroup";
import { LOCATORS } from "../meshes/locators";
import { DiceThrow } from "../types/DiceThrow";
import { Die } from "../types/Die";
import { DiceType } from "../types/DiceType";

/** The `PhysicsDice` group > `Dice` mesh group (scale 0.1) > "dice" > mesh > locators hierarchy */
export function buildDieGroup(type: DiceType, sharp = false) {
  const root = new THREE.Group();
  const physicsGroup = new THREE.Group();
  const meshGroup = new THREE.Group();
  meshGroup.scale.setScalar(0.1);
  const dice = new THREE.Group();
  dice.name = "dice";
  const mesh = new THREE.Object3D();
  for (const { name, position, rotation } of LOCATORS[sharp ? "sharp" : "rounded"][type]) {
    const locator = new THREE.Group();
    locator.name = name;
    if (position) locator.position.set(...position);
    if (rotation) locator.rotation.set(...rotation);
    mesh.add(locator);
  }
  dice.add(mesh);
  meshGroup.add(dice);
  physicsGroup.add(meshGroup);
  root.add(physicsGroup);
  return { root, physicsGroup };
}

const euler = new THREE.Euler();
const quaternion = new THREE.Quaternion();
function eulerToQuaternion([x, y, z]: [number, number, number]) {
  quaternion.setFromEuler(euler.set(x, y, z));
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function addTray(world: RAPIER.World) {
  const [hx, hy, hz] = TRAY_CUBOID_HALF_EXTENTS;
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(...TRAY_FLOOR.position)
      .setFriction(TRAY_FLOOR.friction)
      .setRestitution(TRAY_FLOOR.restitution),
    floor
  );
  const walls = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const { position, rotation } of TRAY_WALLS.cuboids) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(...position)
        .setRotation(eulerToQuaternion(rotation))
        .setFriction(TRAY_WALLS.friction)
        .setRestitution(TRAY_WALLS.restitution),
      walls
    );
  }
}

export interface RollOutcome {
  face: number;
  decision: RestDecision;
  steps: number;
  /** translation x, y, z and rotation x, y, z, w at the lock step */
  transform: number[];
}

/** Throw one die in a fresh world, step until the app's rules finish it, read the face. */
export function rollDie(
  die: Die,
  dieThrow: DiceThrow,
  { gravityScale = 2, sharp = die.style === "WALNUT" } = {}
): RollOutcome {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_TIME_STEP;
  addTray(world);

  // PhysicsDice converts the throw quaternion to an Euler rotation prop.
  const r = dieThrow.rotation;
  euler.setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
  const rotation = eulerToQuaternion([euler.x, euler.y, euler.z]);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(dieThrow.position.x, dieThrow.position.y, dieThrow.position.z)
      .setRotation(rotation)
      .setLinvel(dieThrow.linearVelocity.x, dieThrow.linearVelocity.y, dieThrow.linearVelocity.z)
      .setAngvel(dieThrow.angularVelocity)
      .setGravityScale(gravityScale)
  );
  world.createCollider(
    RAPIER.ColliderDesc.convexHull(new Float32Array(DICE_COLLIDER_VERTICES[die.type]))!
      .setDensity(getDieDensity(die))
      .setFriction(0.1),
    body
  );

  let steps = 0;
  let decision: RestDecision = "rolling";
  while (decision === "rolling") {
    world.step();
    steps += 1;
    decision = getRestDecision(
      { linvel: body.linvel(), angvel: body.angvel(), translation: body.translation() },
      steps
    );
  }

  const t = body.translation();
  const q = body.rotation();
  const { root, physicsGroup } = buildDieGroup(die.type, sharp);
  root.position.set(t.x, t.y, t.z);
  root.quaternion.set(q.x, q.y, q.z, q.w);
  const face = getValueFromDiceGroup(physicsGroup, die.type);
  world.free();
  return { face, decision, steps, transform: [t.x, t.y, t.z, q.x, q.y, q.z, q.w] };
}
