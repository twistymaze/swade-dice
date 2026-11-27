/** T-37 result text per mode (and the T-11 damage grouping text). */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SavageWorldsResultsSummary } from "./SavageWorldsResultsSummary";
import { SavageWorldsResults } from "./SavageWorldsResults";
import { computeRollResult, RollSettings } from "../rules/outcomes";
import { DieChain, SavageRollMode, SavageRollResult } from "../types/SavageWorldsTypes";

import traitWildDie from "../test/fixtures/golden/broadcast.rollResult.traitWildDie.json";
import multiTraitWildDie from "../test/fixtures/golden/broadcast.rollResult.multiTraitWildDie.json";
import damage from "../test/fixtures/golden/broadcast.rollResult.damage.json";
import damageExploding from "../test/fixtures/golden/broadcast.rollResult.damageExploding.json";
import traitNoWild from "../test/fixtures/golden/broadcast.rollResult.traitNoWild.json";

const fixture = (f: unknown) => structuredClone((f as { result: SavageRollResult }).result);
const chain = (dieId: string, dieType: DieChain["dieType"], rolls: number[], isWildDie = false): DieChain => ({
  dieId,
  dieType,
  rolls,
  total: rolls.reduce((a, b) => a + b, 0),
  isWildDie,
});
const make = (mode: SavageRollMode, dieChains: DieChain[], s: Partial<RollSettings> = {}) =>
  computeRollResult(
    { mode, dieChains, isComplete: true, timestamp: 1 },
    { targetNumber: 4, traitModifier: 0, damageModifier: 0, wildDieEnabled: true, ...s }
  );
const text = (c: HTMLElement) => c.textContent!.replace(/\s+/g, " ").trim();

describe("T-37 result summary text", () => {
  it("single trait die, multi-line: 'Result:' and '6 ✓'", () => {
    const { container } = render(<SavageWorldsResultsSummary result={fixture(traitWildDie)} />);
    expect(text(container)).toBe("Result:6 ✓");
  });

  it("multi-die trait, multi-line: 'Results:' and one line per outcome", () => {
    const { container } = render(<SavageWorldsResultsSummary result={fixture(multiTraitWildDie)} />);
    expect(screen.getByText("Results:")).toBeInTheDocument();
    expect(container.querySelectorAll(".MuiTypography-root")).toHaveLength(3); // prefix + 2 lines
    expect(text(container)).toBe("Results:4 ✓5 ✓");
  });

  it("multi-die trait, single line: outcomes joined with ', '", () => {
    const { container } = render(<SavageWorldsResultsSummary result={fixture(multiTraitWildDie)} singleLine />);
    expect(container.querySelectorAll(".MuiTypography-root")).toHaveLength(1);
    expect(text(container)).toBe("Results: 4 ✓, 5 ✓");
  });

  it("damage: 'Total:' and no ✓/✗ (OD-5)", () => {
    const { container } = render(<SavageWorldsResultsSummary result={fixture(damage)} singleLine />);
    expect(text(container)).toBe("Total: 13");
  });

  it("hidePrefix removes 'Result(s):' / 'Total:'", () => {
    const { container } = render(<SavageWorldsResultsSummary result={fixture(traitWildDie)} singleLine hidePrefix />);
    expect(text(container)).toBe("6 ✓");
  });

  it("hidden shows the hidden icon, only when hidden", () => {
    const { rerender } = render(<SavageWorldsResultsSummary result={fixture(traitWildDie)} singleLine hidden />);
    expect(screen.getByTestId("VisibilityOffRoundedIcon")).toBeInTheDocument();
    rerender(<SavageWorldsResultsSummary result={fixture(traitWildDie)} singleLine />);
    expect(screen.queryByTestId("VisibilityOffRoundedIcon")).not.toBeInTheDocument();
  });

  it("raise arrows are capped at 3 (raises 5 -> 3 arrows), 1 raise -> 1 arrow, 0 -> none", () => {
    const r = (total: number) => make("TRAIT", [chain("1", "D12", [total - 10])], { traitModifier: 10, wildDieEnabled: false });
    const arrows = (result: SavageRollResult) => {
      const { container, unmount } = render(<SavageWorldsResultsSummary result={result} singleLine hidePrefix />);
      const n = (container.textContent!.match(/⬆︎/g) ?? []).length;
      unmount();
      return n;
    };
    expect(make("TRAIT", [chain("1", "D12", [12])], { traitModifier: 12, wildDieEnabled: false }).outcomes[0]!.raises).toBe(5);
    expect(arrows(make("TRAIT", [chain("1", "D12", [12])], { traitModifier: 12, wildDieEnabled: false }))).toBe(3);
    expect(arrows(r(18))).toBe(3);
    expect(arrows(r(11))).toBe(1);
    expect(arrows(r(7))).toBe(0);
  });

  it("dice prefix: trait '[d8+1]', damage '[d6+d8+2]', the wild chain is not in the damage prefix", () => {
    const { container, rerender } = render(<SavageWorldsResultsSummary result={fixture(traitWildDie)} singleLine hidePrefix showDicePrefix />);
    expect(text(container)).toBe("[d8+1] 6 ✓");
    rerender(<SavageWorldsResultsSummary result={fixture(damage)} singleLine hidePrefix showDicePrefix />);
    expect(text(container)).toBe("[d6+d8+2] 13");
    rerender(<SavageWorldsResultsSummary result={fixture(damageExploding)} singleLine hidePrefix showDicePrefix />);
    expect(text(container)).toBe("[2d6] 11");
    const withWild = make("DAMAGE", [chain("1", "D6", [4]), chain("2", "D6", [3], true)]);
    rerender(<SavageWorldsResultsSummary result={withWild} singleLine hidePrefix showDicePrefix />);
    expect(text(container)).toBe("[d6] 7"); // T-11: excluded from the prefix, included in the total
  });

  it("mode icon: 🎯 for trait, ⚔️ for damage; 'vs TN n' only when TN != 4 (OD-6)", () => {
    const { container, rerender } = render(<SavageWorldsResultsSummary result={fixture(traitWildDie)} singleLine hidePrefix showModeIcon showTargetNumber />);
    expect(text(container)).toBe("🎯6 ✓");
    const tn8 = make("TRAIT", [chain("1", "D8", [3]), chain("2", "D6", [5], true)], { targetNumber: 8, traitModifier: 1 });
    rerender(<SavageWorldsResultsSummary result={tn8} singleLine hidePrefix showModeIcon showTargetNumber />);
    expect(text(container)).toBe("🎯6 ✗ vs TN 8");
    rerender(<SavageWorldsResultsSummary result={fixture(damage)} singleLine hidePrefix showModeIcon showTargetNumber />);
    expect(text(container)).toBe("⚔️13");
  });

  it("crit markers: '!!' for a Critical Failure, '??' for a possible one", () => {
    const crit = make("TRAIT", [chain("1", "D6", [1]), chain("2", "D6", [1], true)]);
    const { container, rerender } = render(<SavageWorldsResultsSummary result={crit} singleLine hidePrefix />);
    expect(text(container)).toBe("1 ✗!!");
    const possible = make("TRAIT", [chain("1", "D6", [1])], { wildDieEnabled: false });
    rerender(<SavageWorldsResultsSummary result={possible} singleLine hidePrefix />);
    expect(text(container)).toBe("1 ✗??");
  });

  it("null result -> nothing", () => {
    const { container } = render(<SavageWorldsResultsSummary result={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("T-37 / T-11 result details text", () => {
  it("modifier line only when the modifier is not 0", () => {
    const { rerender } = render(<SavageWorldsResults result={fixture(traitWildDie)} />);
    expect(screen.getByText("Modifier: +1")).toBeInTheDocument();
    rerender(<SavageWorldsResults result={fixture(multiTraitWildDie)} />);
    expect(screen.queryByText(/^Modifier:/)).not.toBeInTheDocument();
  });

  it("Wild line only when the Wild Die is on", () => {
    const { container, rerender } = render(<SavageWorldsResults result={fixture(traitWildDie)} />);
    expect(text(container)).toContain("Wild (d6): 5");
    const off = make("TRAIT", [chain("1", "D8", [3]), chain("2", "D6", [5], true)], { wildDieEnabled: false });
    rerender(<SavageWorldsResults result={off} />);
    expect(text(container)).not.toContain("Wild");
    expect(text(container)).toContain("Trait (d8): 3");
  });

  it("single trait result: 'Result: 9' and 'Success vs TN 4 with 1 raise!'", () => {
    render(<SavageWorldsResults result={fixture(traitNoWild)} />);
    expect(screen.getByText("Result: 9")).toBeInTheDocument();
    expect(screen.getByText("Success vs TN 4 with 1 raise!")).toBeInTheDocument();
  });

  it("T-11 damage grouping: '2d6: 6💥 + 2 + 3 = 11' and 'Total: 11'", () => {
    const { container } = render(<SavageWorldsResults result={fixture(damageExploding)} />);
    expect(text(container)).toContain("2d6: 6💥 + 2 + 3 = 11");
    expect(screen.getByText("Total: 11")).toBeInTheDocument();
  });

  it("dieChains empty -> renders nothing", () => {
    const r = fixture(traitWildDie);
    r.dieChains = [];
    const { container } = render(<SavageWorldsResults result={r} />);
    expect(container).toBeEmptyDOMElement();
  });
});
