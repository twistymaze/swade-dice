import { Physics } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDieFromDice } from "../helpers/getDieFromDice";
import { TrayColliders } from "../colliders/TrayColliders";
import { DiceRoll as DiceRollType } from "../types/DiceRoll";
import { DiceThrow } from "../types/DiceThrow";
import { DiceTransform } from "../types/DiceTransform";
import { Die } from "../types/Die";
import { Dice as DefaultDice, DiceProps } from "./Dice";
import { PhysicsDice } from "./PhysicsDice";
import { PHYSICS_TIME_STEP } from "./rollFinished";
import { useDebugStore } from "../debug/store";

export function DiceRoll({
  roll,
  rollThrows,
  explosionDice = [],
  finishedDice = [],
  onRollFinished,
  finishedTransforms,
  transformsRef,
  Dice = DefaultDice,
}: {
  roll: DiceRollType;
  rollThrows: Record<string, DiceThrow>;
  explosionDice?: Die[];
  finishedDice?: string[];
  onRollFinished?: (
    id: string,
    number: number,
    transform: DiceTransform
  ) => boolean | void;
  finishedTransforms?: Record<string, DiceTransform>;
  /** An updated ref of the current dice transforms */
  transformsRef?: React.MutableRefObject<Record<
    string,
    DiceTransform | null
  > | null>;
  /** Override to provide a custom Dice component  */
  Dice?: React.JSXElementConstructor<DiceProps>;
}) {
  const allowPhysicsDebug = useDebugStore((state) => state.allowPhysicsDebug);

  const dice = useMemo(() => roll && getDieFromDice(roll), [roll]);
  
  // Combine regular dice and explosion dice
  const allDice = useMemo(() => {
    if (!dice) return [];
    return [...dice, ...explosionDice];
  }, [dice, explosionDice]);

  const emptyCallback = useCallback(() => {}, []);

  /**
   * The physics world is created when a roll starts (it is unmounted on
   * `clearRoll`). There is a frame where all the rigid bodies need to be created,
   * so to ensure smooth playback we pause the physics sim until the frame after
   * everything is created.
   */
  const [paused, setPaused] = useState(true);
  useEffect(() => {
    if (finishedTransforms) {
      setPaused(true);
    } else {
      requestAnimationFrame(() => {
        setPaused(false);
      });
    }
  }, [finishedTransforms]);

  // Stop stepping the world once every die is locked: nothing moves any more.
  // A new explosion die or a reroll makes this false again.
  const allFinished = useMemo(
    () =>
      allDice.length > 0 && allDice.every((die) => finishedDice.includes(die.id)),
    [allDice, finishedDice]
  );

  if (finishedTransforms) {
    // Move to a static dice representation when all dice values have been found
    return (
      <group>
        {allDice?.map((die) => {
          const dieTransform = finishedTransforms[die.id];
          if (!dieTransform) return null; // Skip if no transform yet
          const p = dieTransform.position;
          const r = dieTransform.rotation;
          return (
            <Dice
              userData={{ dieId: die.id }}
              key={die.id}
              die={die}
              position={[p.x, p.y, p.z]}
              quaternion={[r.x, r.y, r.z, r.w]}
            />
          );
        })}
      </group>
    );
  } else {
    // Simulate the roll in a Rapier world. Other clients do not re-simulate:
    // they receive the finished result as a broadcast.
    return (
      <Physics
        colliders={false}
        interpolate={false}
        timeStep={PHYSICS_TIME_STEP}
        debug={allowPhysicsDebug}
        updateLoop="independent"
        paused={paused || allFinished}
      >
        <TrayColliders />
        {allDice?.map((die) => {
          const dieThrow = rollThrows[die.id];
          if (!dieThrow) return null; // Skip if no throw data yet
          // Use a fixed transform if we have it
          // This allows re-rolling of individual dice as
          // we can lock the dice that are already in the tray
          const fixedTransform = transformsRef?.current?.[die.id] || undefined;
          // Check if this die is finished and should be locked
          const isFinished = finishedDice.includes(die.id);
          return (
            <PhysicsDice
              key={die.id}
              die={die}
              dieThrow={dieThrow}
              onRollFinished={onRollFinished}
              fixedTransform={fixedTransform}
              isFinished={isFinished}
            >
              {/* Override onClick event to make sure simulated dice can't be selected */}
              <Dice
                die={die}
                onClick={emptyCallback}
                onPointerDown={emptyCallback}
              />
            </PhysicsDice>
          );
        })}
      </Physics>
    );
  }
}
