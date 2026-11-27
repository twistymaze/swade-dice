/** Component smoke tests: each renders from a fixture, shows one key text, logs no error. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushObr, obr, resetObrMock } from "./obrMock";

vi.mock("@owlbear-rodeo/sdk", () => import("./obrMock").then((m) => m.createSdkModule()));
vi.mock("../tray/InteractiveTray", () => ({ InteractiveTray: () => <p>tray stand-in</p> }));

import { App } from "../App";
import { PopoverApp } from "../plugin/PopoverApp";
import { RollHistoryPanel } from "../plugin/RollHistoryPanel";
import { PlayerRollPill } from "../plugin/PlayerRollPill";
import { RollNotification } from "../plugin/RollNotification";
import { SavageWorldsResults } from "../controls/SavageWorldsResults";
import { SavageWorldsResultsSummary } from "../controls/SavageWorldsResultsSummary";
import { FinishedRollResultsWrapper } from "../controls/FinishedRollResultsWrapper";
import { SavageWorldsResultsSummaryContainer } from "../controls/SavageWorldsResultsSummaryContainer";
import { TopControls } from "../controls/TopControls";
import { Sidebar } from "../controls/Sidebar";
import { DiceRollControls } from "../controls/DiceRollControls";
import { DiceHistory } from "../controls/DiceHistory";
import { DiceSetPicker } from "../controls/DiceSetPicker";
import { ModeSelector } from "../controls/ModeSelector";
import { FairnessTester } from "../fairness/FairnessTester";
import { useDiceControlsStore } from "../controls/store";
import { useDiceHistoryStore, RecentRoll } from "../controls/history";
import { useDiceRollStore } from "../dice/store";
import { createWildDie } from "../helpers/wildDie";
import { HistoryEntry } from "../plugin/rollHistory";
import { SenderIdentity } from "../plugin/partyDirectory";
import { SavageRollResult } from "../types/SavageWorldsTypes";
import { DiceTransform } from "../types/DiceTransform";

import entriesFixture from "./fixtures/golden/rollHistory.entries.json";
import emptyFixture from "./fixtures/golden/rollHistory.empty.json";
import recentRollsFixture from "./fixtures/golden/diceHistory.recentRolls.json";
import traitWildDie from "./fixtures/golden/broadcast.rollResult.traitWildDie.json";
import modifierChanged from "./fixtures/golden/broadcast.rollResult.traitWildDie.modifierChanged.json";
import multiTraitWildDie from "./fixtures/golden/broadcast.rollResult.multiTraitWildDie.json";
import traitNoWild from "./fixtures/golden/broadcast.rollResult.traitNoWild.json";
import rolledOne from "./fixtures/golden/broadcast.rollResult.traitNoWild.rolledOne.json";
import damage from "./fixtures/golden/broadcast.rollResult.damage.json";
import damageExploding from "./fixtures/golden/broadcast.rollResult.damageExploding.json";
import standard from "./fixtures/golden/broadcast.rollResult.standard.json";
import popoverOpen from "./fixtures/golden/popover.notification.open.json";
import explodingChain from "./fixtures/golden/broadcast.rollResult.explodingChain.json";

const T: DiceTransform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
const result = (f: unknown) => structuredClone((f as { result: SavageRollResult }).result);
const controls = () => useDiceControlsStore.getState();
const dice = () => useDiceRollStore.getState();

type GoldenEntry = { id: string; player: { connectionId: string; name: string; color: string }; result: SavageRollResult };
const goldenEntries = entriesFixture as unknown as GoldenEntry[];
const entries: HistoryEntry[] = goldenEntries.map((e) => ({
  key: e.id,
  connectionId: e.player.connectionId,
  rollId: e.id,
  rev: 0,
  result: e.result,
}));
const identities: Record<string, SenderIdentity> = Object.fromEntries(
  goldenEntries.map((e) => [
    e.player.connectionId,
    { connectionId: e.player.connectionId, name: e.player.name, color: e.player.color, role: "PLAYER", isSelf: false },
  ])
);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetObrMock({ id: "self", connectionId: "self-conn", name: "Self" });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  consoleError = vi.spyOn(console, "error");
  act(() => {
    dice().clearRoll();
    controls().resetDiceCounts();
    controls().setTargetNumber(4);
    controls().setTraitModifier(0);
    controls().setDamageModifier(0);
    useDiceControlsStore.setState({ wildDieEnabled: true, diceHidden: false, fairnessTesterOpen: false, resultsDetailsHovered: false });
    useDiceHistoryStore.setState({ recentRolls: [] });
  });
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** d8 3 + Wild Die 5, trait modifier +1: the traitWildDie golden roll, finished in the store. */
function finishGoldenTrait() {
  const d8 = { id: "d8", type: "D8" as const, style: "GALAXY" as const };
  const wild = createWildDie();
  act(() => {
    controls().setTraitModifier(1);
    dice().startRoll({ dice: [d8, wild] }, { mode: "TRAIT", settings: { ...controls() } });
    dice().checkAndProcessExplosion(d8.id, 3, T);
    dice().checkAndProcessExplosion(wild.id, 5, T);
  });
}

describe("component smoke tests", () => {
  it("RollHistoryPanel with the golden entries: one pill per entry with the player name", () => {
    render(<RollHistoryPanel entries={entries} identities={identities} />);
    expect(screen.getAllByText("Wren").length).toBe(entries.length);
  });

  it("RollHistoryPanel empty: 'Party dice rolls appear here'", () => {
    render(<RollHistoryPanel entries={emptyFixture as HistoryEntry[]} identities={{}} />);
    expect(screen.getByText("Party dice rolls appear here")).toBeInTheDocument();
  });

  it("PlayerRollPill with and without a result", () => {
    const { container, rerender } = render(<PlayerRollPill player={{ name: "Wren", color: "#4e9a06" }} result={result(damage)} showDicePrefix />);
    expect(container).toHaveTextContent("Wren");
    expect(container).toHaveTextContent("[d6+d8+2] 13");
    rerender(<PlayerRollPill player={{ name: "Wren", color: "#4e9a06" }} />);
    expect(container).toHaveTextContent(/^Wren$/);
  });

  it("RollNotification with the damage golden", () => {
    const { container } = render(<RollNotification name="Wren" result={result(damage)} />);
    expect(container).toHaveTextContent("Wren:");
    expect(container).toHaveTextContent("13");
  });

  it.each([
    ["traitWildDie", traitWildDie, "6"],
    ["traitWildDie.modifierChanged", modifierChanged, "3"],
    ["multiTraitWildDie", multiTraitWildDie, "5"],
    ["traitNoWild", traitNoWild, "9"],
    ["traitNoWild.rolledOne", rolledOne, "1"],
    ["damage", damage, "13"],
    ["damageExploding", damageExploding, "11"],
    ["standard", standard, "12"],
    ["explodingChain", explodingChain, "15"],
  ])("SavageWorldsResults and SavageWorldsResultsSummary render %s", (_name, fixture, total) => {
    const { container: details } = render(<SavageWorldsResults result={result(fixture)} />);
    expect(details.textContent).toContain(total);
    const { container: summary } = render(<SavageWorldsResultsSummary result={result(fixture)} />);
    expect(summary.textContent).toContain(total);
  });

  it("FinishedRollResultsWrapper / SavageWorldsResultsSummaryContainer with a finished trait roll; hover shows the details", () => {
    finishGoldenTrait();
    const { container } = render(<FinishedRollResultsWrapper />);
    expect(container).toHaveTextContent("6 ✓");
    expect(container).not.toHaveTextContent("Modifier: +1");
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(container).toHaveTextContent("Modifier: +1");
    const { container: summary } = render(<SavageWorldsResultsSummaryContainer />);
    expect(summary).toHaveTextContent("6 ✓");
  });

  it("TopControls: Wild Die, TN, trait and damage modifier", () => {
    render(<TopControls />);
    expect(screen.getByText("TN: 4")).toBeInTheDocument();
    expect(screen.getByText("🎯")).toBeInTheDocument();
    expect(screen.getByText("⚔️")).toBeInTheDocument();
    expect(screen.getByTestId("StarIcon")).toBeInTheDocument();
  });

  it("Sidebar: dice of the set, history and fairness buttons; sets the action width inside OBR", async () => {
    render(<Sidebar />);
    await act(flushObr);
    expect(screen.getAllByAltText(/^GALAXY D(4|6|8|10|12) preview$/)).toHaveLength(5);
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fairness" })).toBeInTheDocument();
    expect(obr().action.setWidth).toHaveBeenCalled();
  });

  it("DiceRollControls: nothing without dice; Roll and Trait/Damage with dice; the result when finished", () => {
    const { container, rerender } = render(<DiceRollControls />);
    expect(container).toBeEmptyDOMElement();
    act(() => controls().changeDieCount(Object.keys(controls().diceCounts)[0]!, 1));
    rerender(<DiceRollControls />);
    expect(screen.getByRole("button", { name: /^Roll/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trait" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Damage" })).toBeInTheDocument();
    act(() => controls().resetDiceCounts());
    finishGoldenTrait();
    rerender(<DiceRollControls />);
    expect(container).toHaveTextContent("6 ✓");
  });

  it("DiceHistory with the golden recent rolls", () => {
    act(() => useDiceHistoryStore.setState({ recentRolls: structuredClone(recentRollsFixture) as RecentRoll[] }));
    render(<DiceHistory />);
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("menu").querySelectorAll(".MuiChip-root")).toHaveLength(6);
  });

  it("DiceSetPicker offers 7 sets: not NEBULA (Wild Die) and not 'all'", () => {
    render(<DiceSetPicker />);
    fireEvent.click(screen.getByRole("button", { name: "change dice set" }));
    const menu = screen.getByRole("menu");
    const names = within(menu)
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["galaxy dice", "gemstone dice", "glass dice", "iron dice", "sunrise dice", "sunset dice", "walnut dice"]);
  });

  it("ModeSelector: only Trait and Damage; hidden when not visible", () => {
    const onModeChange = vi.fn();
    const { rerender, container } = render(<ModeSelector autoMode="TRAIT" visible onModeChange={onModeChange} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Trait", "Damage"]);
    fireEvent.click(screen.getByRole("button", { name: "Damage" }));
    expect(onModeChange).toHaveBeenCalledWith("DAMAGE");
    rerender(<ModeSelector autoMode="TRAIT" visible={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("FairnessTester open", () => {
    act(() => useDiceControlsStore.setState({ fairnessTesterOpen: true }));
    render(<FairnessTester />);
    expect(screen.getByText("test dice fairness by rolling many times")).toBeInTheDocument();
  });

  it("App outside OBR: controls and tray render, the party history (PluginGate) does not", () => {
    resetObrMock({ available: false, ready: false });
    render(<App />);
    expect(screen.getByText("tray stand-in")).toBeInTheDocument();
    expect(screen.getByText("TN: 4")).toBeInTheDocument();
    expect(screen.queryByText("Party dice rolls appear here")).not.toBeInTheDocument();
  });

  it("App inside OBR: the party history shows", async () => {
    render(<App />);
    await act(flushObr);
    expect(screen.getByText("tray stand-in")).toBeInTheDocument();
    expect(screen.getByText("Party dice rolls appear here")).toBeInTheDocument();
  });

  it("PopoverApp outside OBR renders nothing; inside OBR it listens for rolls", async () => {
    resetObrMock({ available: false, ready: false });
    const { container, unmount } = render(<PopoverApp />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    resetObrMock({ actionOpen: false });
    await obr().popover.open(structuredClone(popoverOpen)); // background.ts opens it first
    render(<PopoverApp />);
    await act(flushObr);
    expect(obr().broadcast.onMessage).toHaveBeenCalled();
    expect(obr().state.popovers.get(popoverOpen.id)).toMatchObject({ width: 0, height: 0 });
  });
});
