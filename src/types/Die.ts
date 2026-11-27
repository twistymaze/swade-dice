import { isPlainObject } from "../helpers/isPlainObject";

import { DiceStyle } from "./DiceStyle";
import { DiceType } from "./DiceType";

export interface Die {
  id: string;
  style: DiceStyle;
  type: DiceType;
  /** Set on the Wild Die that `getDiceToRoll` adds (D-12). The dice store reads this flag. */
  isWildDie?: boolean;
}

export function isDie(value: unknown): value is Die {
  return (
    isPlainObject(value) &&
    typeof (value as Record<string, unknown>).id === "string" &&
    typeof (value as Record<string, unknown>).style === "string" &&
    typeof (value as Record<string, unknown>).type === "string"
  );
}
