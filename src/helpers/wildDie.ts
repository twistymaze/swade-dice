import { Die } from "../types/Die";
import { generateDiceId } from "./generateDiceId";

/** The Wild Die is a d6 in the NEBULA style, so it looks different from the trait dice. */
export function createWildDie(): Die {
  return { id: generateDiceId(), style: "NEBULA", type: "D6", isWildDie: true };
}
