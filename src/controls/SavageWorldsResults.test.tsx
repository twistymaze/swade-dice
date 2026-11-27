import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SavageWorldsResults } from "./SavageWorldsResults";
import { SavageWorldsResultsSummary } from "./SavageWorldsResultsSummary";
import { computeRollResult } from "../rules/outcomes";
import { DieChain, SavageRollResult } from "../types/SavageWorldsTypes";

import traitWildDie from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.json";
import standard from "../test/fixtures/golden/broadcast.rollResult.standard.json";

const fixture = (f: unknown) => structuredClone((f as { result: SavageRollResult }).result);
const chain = (dieId: string, dieType: DieChain["dieType"], rolls: number[], isWildDie = false): DieChain => ({
  dieId,
  dieType,
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  isWildDie,
});

/** d6 trait + Wild Die both 1, trait modifier +3, TN 4 (the A-01 scenario). */
function liftedCrit(): SavageRollResult {
  return computeRollResult(
    { mode: "TRAIT", dieChains: [chain("1", "D6", [1]), chain("2", "D6", [1], true)], isComplete: true, timestamp: 1 },
    { targetNumber: 4, traitModifier: 3, damageModifier: 0, wildDieEnabled: true }
  );
}

/** The same roll as an old client (before the fix) sent it: success true, no crit fields. */
function oldPayloadLiftedCrit(): SavageRollResult {
  const r = liftedCrit();
  r.outcomes = r.outcomes.map(({ criticalFailure: _c, criticalFailureReason: _r, ...o }) => ({ ...o, success: true, raises: 0 }));
  return r;
}

describe("T-54 / A-01 a Critical Failure lifted by a modifier is shown as CRIT, not as a success", () => {
  it.each([
    ["new payload", liftedCrit],
    ["old payload (crit computed locally)", oldPayloadLiftedCrit],
  ])("summary (%s): ✗ and !!, no ✓", (_label, make) => {
    render(<SavageWorldsResultsSummary result={make()} singleLine />);
    expect(screen.queryByText("✓")).not.toBeInTheDocument();
    expect(screen.getByText("✗")).toBeInTheDocument();
    expect(screen.getByText("!!")).toBeInTheDocument();
  });

  it.each([
    ["new payload", liftedCrit],
    ["old payload (crit computed locally)", oldPayloadLiftedCrit],
  ])("details panel (%s): Failed and CRIT FAIL, no Success", (_label, make) => {
    render(<SavageWorldsResults result={make()} />);
    expect(screen.queryByText(/Success vs TN/)).not.toBeInTheDocument();
    expect(screen.getByText(/Failed vs TN 4/)).toBeInTheDocument();
    expect(screen.getByText(/CRIT FAIL/)).toBeInTheDocument();
  });

  it("multi-line summary shows !! CRIT FAIL", () => {
    render(<SavageWorldsResultsSummary result={liftedCrit()} />);
    expect(screen.getByText("!! CRIT FAIL")).toBeInTheDocument();
  });

  it("a normal success still shows ✓ and no crit marker", () => {
    render(<SavageWorldsResultsSummary result={fixture(traitWildDie)} singleLine />);
    expect(screen.getByText("✓")).toBeInTheDocument();
    expect(screen.queryByText("!!")).not.toBeInTheDocument();
  });
});

describe("T-12 / T-B1 STANDARD details panel", () => {
  it("lists every die (d4: 3, d12: 12), not only the first", () => {
    render(<SavageWorldsResults result={fixture(standard)} />);
    expect(screen.getByText("d4: 3")).toBeInTheDocument();
    expect(screen.getByText("d12: 12")).toBeInTheDocument();
  });

  it("A-03 an old STANDARD payload with a modifier shows no modifier line or prefix modifier", () => {
    const r = fixture(standard);
    r.modifier = 2;
    r.outcomes = r.outcomes.map((o) => ({ ...o, modifier: 2 }));
    render(<SavageWorldsResults result={r} />);
    expect(screen.queryByText(/Modifier:/)).not.toBeInTheDocument();
    render(<SavageWorldsResultsSummary result={r} singleLine showDicePrefix />);
    expect(screen.getByText("[d4+d12]")).toBeInTheDocument();
  });
});
