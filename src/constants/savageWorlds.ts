/**
 * Constants for Savage Worlds dice mechanics
 */

// Speed multiplier for explosion dice (makes them roll slightly faster)
export const EXPLOSION_SPEED_MULTIPLIER = 1.5;

/**
 * One Wild Die per roll (A-10, SWADE "One Wild Die per Action"). With several trait dice (Rate of
 * Fire, Frenzy) it replaces the worst trait die when it is higher. A Multi-Action is several
 * separate rolls, each with its own Wild Die.
 */
export const WILD_DIE_HELP =
  "One Wild Die per roll: it replaces the lowest trait die if higher. Roll multi-actions separately.";
