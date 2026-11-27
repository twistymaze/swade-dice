/** Fairness tester flow, driven through the dice store. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./FairnessCharts", () => ({
  default: ({ rolledValues }: { rolledValues: number[] }) => <div>chart of {rolledValues.length}</div>,
}));

import { FairnessTester } from "./FairnessTester";
import { useDiceControlsStore } from "../controls/store";
import { useDiceRollStore } from "../dice/store";
import { getDieFromDice } from "../helpers/getDieFromDice";
import { diceSets } from "../sets/diceSets";
import { DiceTransform } from "../types/DiceTransform";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const controls = () => useDiceControlsStore.getState();
const dice = () => useDiceRollStore.getState();

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:rolls"), revokeObjectURL: vi.fn() }));
  act(() => {
    dice().clearRoll();
    useDiceControlsStore.setState({ fairnessTesterOpen: true });
    controls().changeDiceSet(diceSets.find((set) => set.id === "GALAXY_STANDARD")!);
    controls().resetDiceCounts();
  });
});
afterEach(() => {
  act(() => {
    dice().clearRoll();
    useDiceControlsStore.setState({ fairnessTesterOpen: false });
  });
  vi.unstubAllGlobals();
});

const start = () => screen.getByRole("button", { name: "Start" });
const slider = () => screen.getByRole("slider");
const dieId = () => getDieFromDice(dice().roll!)[0]!.id;
function finishCurrent(face: number) {
  act(() => {
    dice().checkAndProcessExplosion(dieId(), face, T);
  });
}
function selectOne() {
  const id = Object.keys(controls().diceCounts).find((k) => k.endsWith("_D6"))!;
  act(() => controls().changeDieCount(id, 1));
  return id;
}

describe("fairness tester flow", () => {
  it("Start needs exactly one die and more than 0 rolls; warnings say why", () => {
    render(<FairnessTester />);
    expect(start()).toBeDisabled();
    expect(screen.getByText("Select one dice to begin testing")).toBeInTheDocument();
    const id = selectOne();
    expect(start()).toBeEnabled();
    act(() => controls().changeDieCount(id, 2));
    expect(start()).toBeDisabled();
    act(() => controls().changeDieCount(id, 1));
    fireEvent.change(slider(), { target: { value: 20 } });
    expect(slider()).toHaveValue("20");
    expect(start()).toBeEnabled();
    expect(screen.getByText(/Low number of rolls selected/)).toBeInTheDocument();
    fireEvent.change(slider(), { target: { value: 0 } });
    // step null: only the marks can be picked, so 0 rolls is not reachable in the UI (canStartFairnessTest covers 0)
    expect(slider()).not.toHaveValue("0");
    expect(start()).toBeEnabled();
  });

  it("Start: a hidden STANDARD roll of the one die without a Wild Die; the counts are reset", () => {
    render(<FairnessTester />);
    selectOne();
    fireEvent.click(start());
    expect(dice().roll?.hidden).toBe(true);
    expect(dice().rollMode).toBe("STANDARD");
    expect(getDieFromDice(dice().roll!).map((d) => [d.type, d.isWildDie === true])).toEqual([["D6", false]]);
    expect(Object.values(controls().diceCounts).every((n) => n === 0)).toBe(true);
    expect(screen.getByText("0 of 500 Rolls")).toBeInTheDocument();
  });

  it("each finished roll adds one value, also when the store changes again before the reroll", () => {
    render(<FairnessTester />);
    selectOne();
    fireEvent.click(start());
    const first = dieId();
    finishCurrent(6); // a max face: STANDARD does not explode
    expect(screen.getByText("1 of 500 Rolls")).toBeInTheDocument();
    expect(dieId()).not.toBe(first); // rerolled
    act(() => useDiceRollStore.setState({ explosionDice: [] })); // unrelated store change
    expect(screen.getByText("1 of 500 Rolls")).toBeInTheDocument();
    finishCurrent(2);
    finishCurrent(3);
    expect(screen.getByText("3 of 500 Rolls")).toBeInTheDocument();
  });

  it("Stop -> results with the partial count, export file name with the count; Restart resets", async () => {
    render(<FairnessTester />);
    selectOne();
    fireEvent.click(start());
    finishCurrent(1);
    finishCurrent(4);
    finishCurrent(6);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByText("3 of 500 rolls completed")).toBeInTheDocument();
    expect(await screen.findByText("chart of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export/ })).toHaveAttribute("download", "GALAXY-D6-rolls-3.txt");
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(start()).toBeInTheDocument();
    expect(screen.queryByText(/rolls completed/)).not.toBeInTheDocument();
    expect(screen.getByText("Rolls")).toBeInTheDocument();
  });

  it("the planned count reached -> the roll is cleared and the results show 20 of 20", async () => {
    render(<FairnessTester />);
    selectOne();
    fireEvent.change(slider(), { target: { value: 20 } });
    expect(slider()).toHaveValue("20");
    fireEvent.click(start());
    for (let i = 0; i < 20; i++) finishCurrent((i % 6) + 1);
    expect(dice().roll).toBeNull();
    expect(screen.getByText("20 of 20 rolls completed")).toBeInTheDocument();
    expect(await screen.findByText("chart of 20")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export/ })).toHaveAttribute("download", "GALAXY-D6-rolls-20.txt");
  });
});
