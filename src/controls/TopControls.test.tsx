/** T-34 / T-35 top-bar controls: enabled state, TN and modifier inputs. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TopControls } from "./TopControls";
import { SavageWorldsResultsSummaryContainer } from "./SavageWorldsResultsSummaryContainer";
import { useDiceControlsStore } from "./store";
import { useDiceRollStore } from "../dice/store";
import { createWildDie } from "../helpers/wildDie";
import { generateDiceId } from "../helpers/generateDiceId";
import { DiceTransform } from "../types/DiceTransform";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const controls = () => useDiceControlsStore.getState();
const dice = () => useDiceRollStore.getState();

beforeEach(() => {
  act(() => {
    dice().clearRoll();
    controls().resetDiceCounts();
    controls().setTargetNumber(4);
    controls().setTraitModifier(0);
    controls().setDamageModifier(0);
    useDiceControlsStore.setState({ wildDieEnabled: true });
  });
});

const wildButton = () => (screen.queryByTestId("StarIcon") ?? screen.getByTestId("StarBorderIcon")).closest("button")!;
const tnButton = () => screen.getByText(/^TN: /).closest("button")!;
const traitButton = () => screen.getByText("🎯").closest("button")!;
const damageButton = () => screen.getByText("⚔️").closest("button")!;

/** A finished TRAIT roll: one d6 with the given face, plus a Wild Die when `wildFace` is set. */
function finishTrait(face: number, wildFace?: number) {
  const trait = { id: generateDiceId(), type: "D6" as const, style: "GALAXY" as const };
  const wild = wildFace !== undefined ? createWildDie() : undefined;
  act(() => {
    dice().startRoll({ dice: wild ? [trait, wild] : [trait] }, { mode: "TRAIT", settings: { ...controls() } });
    dice().checkAndProcessExplosion(trait.id, face, T);
    if (wild) dice().checkAndProcessExplosion(wild.id, wildFace!, T);
  });
}

describe("T-34 enable/disable logic of the top-bar controls", () => {
  it("no dice and no roll -> all four controls enabled for the next roll", () => {
    render(<TopControls />);
    for (const b of [wildButton(), tnButton(), traitButton()]) expect(b).toBeEnabled();
    // the damage modifier needs a damage selection (AUTO with 0 dice is "none")
    expect(damageButton()).toBeDisabled();
  });

  it("DAMAGE selection (2 dice) -> TN, trait modifier and Wild Die disabled; damage modifier enabled", () => {
    const [a, b] = Object.keys(controls().diceCounts);
    act(() => {
      controls().changeDieCount(a, 1);
      controls().changeDieCount(b, 1);
    });
    render(<TopControls />);
    expect(wildButton()).toBeDisabled();
    expect(tnButton()).toBeDisabled();
    expect(traitButton()).toBeDisabled();
    expect(damageButton()).toBeEnabled();
    expect(wildButton().parentElement).toHaveAttribute("aria-label", "Wild Die (disabled for damage rolls)");
  });

  it("TRAIT selection (1 die) -> Wild Die, TN and trait modifier enabled; damage modifier disabled", () => {
    act(() => controls().changeDieCount(Object.keys(controls().diceCounts)[0], 1));
    render(<TopControls />);
    for (const b of [wildButton(), tnButton(), traitButton()]) expect(b).toBeEnabled();
    expect(damageButton()).toBeDisabled();
  });

  it("finished TRAIT roll without a wild chain and Wild Die off -> toggle disabled, 'Cannot add wild die...'", () => {
    act(() => useDiceControlsStore.setState({ wildDieEnabled: false }));
    finishTrait(3);
    render(<TopControls />);
    expect(wildButton()).toBeDisabled();
    expect(wildButton().parentElement).toHaveAttribute("aria-label", "Cannot add wild die to completed roll");
    fireEvent.click(wildButton());
    expect(controls().wildDieEnabled).toBe(false);
  });

  it("finished TRAIT roll with a wild chain -> the toggle works and the summary changes", () => {
    finishTrait(2, 5);
    render(<TopControls />);
    const { container } = render(<SavageWorldsResultsSummaryContainer />);
    const summary = () => container;
    expect(wildButton()).toBeEnabled();
    expect(within(summary()).getByText("5")).toBeInTheDocument();
    expect(within(summary()).getByText("✓")).toBeInTheDocument();
    fireEvent.click(wildButton());
    expect(controls().wildDieEnabled).toBe(false);
    expect(within(summary()).getByText("2")).toBeInTheDocument();
    expect(within(summary()).getByText("✗")).toBeInTheDocument();
    // back on: the wild chain is still there
    fireEvent.click(wildButton());
    expect(within(summary()).getByText("5")).toBeInTheDocument();
  });

  it("finished DAMAGE roll -> damage modifier enabled, trait controls disabled", () => {
    const d = { id: generateDiceId(), type: "D8" as const, style: "GALAXY" as const };
    act(() => {
      dice().startRoll({ dice: [d] }, { mode: "DAMAGE" });
      dice().checkAndProcessExplosion(d.id, 3, T);
    });
    render(<TopControls />);
    expect(damageButton()).toBeEnabled();
    expect(tnButton()).toBeDisabled();
    expect(traitButton()).toBeDisabled();
    expect(wildButton()).toBeDisabled();
  });
});

describe("T-35 TN and modifier inputs", () => {
  const openMenu = (button: HTMLElement) => fireEvent.click(button, { shiftKey: true });
  const input = () => screen.getByRole("spinbutton") as HTMLInputElement;

  it("click +1, right click -1 on TN and modifier", () => {
    render(<TopControls />);
    fireEvent.click(tnButton());
    expect(controls().targetNumber).toBe(5);
    fireEvent.contextMenu(tnButton());
    fireEvent.contextMenu(tnButton());
    expect(controls().targetNumber).toBe(3);
    fireEvent.click(traitButton());
    expect(controls().traitModifier).toBe(1);
    fireEvent.contextMenu(traitButton());
    fireEvent.contextMenu(traitButton());
    expect(controls().traitModifier).toBe(-1);
  });

  it.each([4, 6, 8])("TN quick button %i sets the TN and closes the menu", (value) => {
    act(() => controls().setTargetNumber(5));
    render(<TopControls />);
    openMenu(tnButton());
    fireEvent.click(screen.getByRole("button", { name: String(value) }));
    expect(controls().targetNumber).toBe(value);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it.each([1, 2, 3, 4, -1, -2, -3, -4])("modifier quick button %i", (value) => {
    render(<TopControls />);
    openMenu(traitButton());
    fireEvent.click(screen.getByRole("button", { name: value > 0 ? `+${value}` : String(value) }));
    expect(controls().traitModifier).toBe(value);
  });

  it.each(["abc", "0", "100", ""])("TN custom %j + Enter -> ignored, menu stays open", (value) => {
    render(<TopControls />);
    openMenu(tnButton());
    fireEvent.change(input(), { target: { value } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(controls().targetNumber).toBe(4);
    expect(input()).toBeInTheDocument();
  });

  it("TN custom 12 + Enter applies and closes", () => {
    render(<TopControls />);
    openMenu(tnButton());
    fireEvent.change(input(), { target: { value: "12" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(controls().targetNumber).toBe(12);
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("TN steppers stop at 1 and 99", () => {
    act(() => controls().setTargetNumber(1));
    render(<TopControls />);
    openMenu(tnButton());
    fireEvent.click(screen.getByRole("button", { name: "−" }));
    expect(controls().targetNumber).toBe(1);
    expect(input().value).toBe("1");
    fireEvent.change(input(), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(controls().targetNumber).toBe(99);
    expect(input().value).toBe("99");
  });

  it("TN click at 99 stays 99 (store clamp)", () => {
    act(() => controls().setTargetNumber(99));
    render(<TopControls />);
    fireEvent.click(tnButton());
    expect(controls().targetNumber).toBe(99);
  });

  it("modifier custom \"abc\" ignored; \"-120\" accepted and clamped to -99 (B-08); Clear Modifier -> 0", () => {
    render(<TopControls />);
    openMenu(traitButton());
    fireEvent.change(input(), { target: { value: "abc" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(controls().traitModifier).toBe(0);
    fireEvent.change(input(), { target: { value: "-120" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(controls().traitModifier).toBe(-99);
    expect(screen.getByText("-99")).toBeInTheDocument();
    openMenu(traitButton());
    fireEvent.click(screen.getByRole("button", { name: "Clear Modifier" }));
    expect(controls().traitModifier).toBe(0);
  });

  it("modifier steppers add and subtract 1 from the custom value", () => {
    render(<TopControls />);
    openMenu(traitButton());
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(controls().traitModifier).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "−" }));
    expect(controls().traitModifier).toBe(1);
  });

  it("a disabled control ignores clicks", () => {
    const [a, b] = Object.keys(controls().diceCounts);
    act(() => {
      controls().changeDieCount(a, 1);
      controls().changeDieCount(b, 1);
    });
    render(<TopControls />);
    fireEvent.click(tnButton());
    fireEvent.contextMenu(traitButton());
    expect(controls().targetNumber).toBe(4);
    expect(controls().traitModifier).toBe(0);
  });
});

describe("T-35 modifier steppers at the limit (W-01)", () => {
  it("the custom field never shows a value outside -99..99 that the store did not apply", () => {
    act(() => controls().setTraitModifier(-99));
    render(<TopControls />);
    fireEvent.click(traitButton(), { shiftKey: true });
    const field = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: "−" }));
    expect(controls().traitModifier).toBe(-99);
    expect(field.value).toBe("-99");
    fireEvent.change(field, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(controls().traitModifier).toBe(99);
    expect(field.value).toBe("99");
  });
});
