import * as THREE from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CollisionEnterPayload,
  RigidBody,
  RapierRigidBody,
  useAfterPhysicsStep,
} from "@react-three/rapier";

import { Die } from "../types/Die";
import { getValueFromDiceGroup } from "../helpers/getValueFromDiceGroup";
import { ThreeElements } from "@react-three/fiber";
import { useAudioListener } from "../audio/useAudioListener";
import { getNextBuffer } from "../audio/getAudioBuffer";
import { playOneShotSound } from "../audio/oneShotSound";
import { PhysicalMaterial } from "../types/PhysicalMaterial";
import { getDieWeightClass } from "../helpers/getDieWeightClass";
import { getDieDensity } from "../helpers/getDieDensity";
import { DiceThrow } from "../types/DiceThrow";
import { DiceTransform } from "../types/DiceTransform";
import { DiceCollider } from "../colliders/DiceCollider";
import { getRestDecision } from "./rollFinished";

/** Cool down in MS before dice audio can get played again */
const AUDIO_COOLDOWN = 200;

const _matrix = new THREE.Matrix4();
const _inverseParent = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/**
 * Move the rigid body's object to the body's current pose, as the
 * `@react-three/rapier` sync does (without interpolation) after the steps of a frame.
 * The after-step callback runs before that sync, so the face is read from this pose.
 */
function placeObjectAtBody(object: THREE.Object3D, rigidBody: RapierRigidBody) {
  const t = rigidBody.translation();
  const r = rigidBody.rotation();
  _matrix.compose(
    _position.set(t.x, t.y, t.z),
    _quaternion.set(r.x, r.y, r.z, r.w),
    object.scale
  );
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false);
    _matrix.premultiply(_inverseParent.copy(object.parent.matrixWorld).invert());
  }
  _matrix.decompose(object.position, object.quaternion, _scale);
}

function magnitude({ x, y, z }: { x: number; y: number; z: number }) {
  return Math.sqrt(x * x + y * y + z * z);
}

type Vector3Array = [number, number, number];

export function PhysicsDice({
  die,
  dieThrow,
  onRollFinished,
  children,
  fixedTransform,
  isFinished,
  ...props
}: ThreeElements["group"] & {
  die: Die;
  dieThrow: DiceThrow;
  onRollFinished?: (
    id: string,
    number: number,
    transform: DiceTransform
  ) => void;
  fixedTransform?: DiceTransform;
  isFinished?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  // Convert dice throw into THREE values
  const [position] = useState<Vector3Array>(() => {
    const p = fixedTransform ? fixedTransform.position : dieThrow.position;
    return [p.x, p.y, p.z];
  });

  const [rotation] = useState<Vector3Array>(() => {
    const r = fixedTransform ? fixedTransform.rotation : dieThrow.rotation;
    const quaternion = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    return [euler.x, euler.y, euler.z];
  });

  const [linearVelocity] = useState<Vector3Array>(() => {
    const v = fixedTransform ? { x: 0, y: 0, z: 0 } : dieThrow.linearVelocity;
    return [v.x, v.y, v.z];
  });

  const [angularVelocity] = useState<Vector3Array>(() => {
    const v = fixedTransform ? { x: 0, y: 0, z: 0 } : dieThrow.angularVelocity;
    return [v.x, v.y, v.z];
  });

  const lockedRef = useRef(false);
  const lockDice = useCallback(() => {
    const rigidBody = rigidBodyRef.current;
    if (rigidBody) {
      // Disable rigid body rotation and translation
      // This stops the dice from getting changed after it has finished rolling
      rigidBody.setEnabledRotations(false, false, false, false);
      rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, false);
      rigidBody.setEnabledTranslations(false, false, false, false);
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, false);
      lockedRef.current = true;
    }
  }, []);

  // Check once per fixed physics step (simulated time), not per render frame, so the
  // result and the resting pose do not depend on the frame rate or on a hidden pane.
  const stepsRef = useRef(0);
  useAfterPhysicsStep(() => {
    const rigidBody = rigidBodyRef.current;
    const group = ref.current;
    if (!rigidBody || !group || lockedRef.current) {
      return;
    }
    stepsRef.current += 1;
    const decision = getRestDecision(
      {
        linvel: rigidBody.linvel(),
        angvel: rigidBody.angvel(),
        translation: rigidBody.translation(),
      },
      stepsRef.current
    );
    if (decision === "rolling") {
      return;
    }
    lockDice();
    placeObjectAtBody(group.parent ?? group, rigidBody);
    const value = getValueFromDiceGroup(group, die.type);
    const position = rigidBody.translation();
    const rotation = rigidBody.rotation();
    const transform = {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w,
      },
    };
    onRollFinished?.(die.id, value, transform);
  });

  // Lock the dice when we have a manual transform or when it's marked as finished
  useEffect(() => {
    if (fixedTransform || isFinished) {
      lockDice();
    }
  }, [fixedTransform, isFinished, lockDice]);

  const listener = useAudioListener();
  const lastAudioTimeRef = useRef(0);
  const handleCollision = useCallback(
    ({ rigidBodyObject }: CollisionEnterPayload) => {
      if (performance.now() - lastAudioTimeRef.current < AUDIO_COOLDOWN) {
        return;
      }
      const group = ref.current;
      // rigidBodyObject is optional in the @react-three/rapier types and not every
      // body sets userData.material, so fall back to leather.
      const physicalMaterial: PhysicalMaterial =
        rigidBodyObject?.userData?.material || "LEATHER";
      const linvel = rigidBodyRef.current?.linvel();
      if (group && physicalMaterial && linvel) {
        const speed = magnitude(linvel);
        const weightClass = getDieWeightClass(die);
        const buffer = getNextBuffer(weightClass, physicalMaterial);
        if (buffer && listener) {
          playOneShotSound(listener, buffer, group, {
            refDistance: 3,
            // Modulate sound volume based off of the speed of the colliding dice
            volume: Math.min(speed / 5, 1),
          });
          lastAudioTimeRef.current = performance.now();
        }
      }
    },
    [die, listener]
  );

  const userData = useMemo(
    () => ({ material: "DICE", dieId: die.id }),
    [die.id]
  );

  return (
    <RigidBody
      // Increase gravity on the dice to offset the non-standard dice size.
      // Dice are around 10x larger then they should be to account for
      // physics errors when shown at proper size.
      gravityScale={2}
      density={getDieDensity(die)}
      friction={0.1}
      position={position}
      rotation={rotation}
      linearVelocity={linearVelocity}
      angularVelocity={angularVelocity}
      ref={rigidBodyRef}
      onCollisionEnter={handleCollision}
      userData={userData}
    >
      <group ref={ref} {...props}>
        <DiceCollider diceType={die.type} />
        {children}
      </group>
    </RigidBody>
  );
}
