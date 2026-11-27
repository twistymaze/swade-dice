import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error("boom");
  return <p>child ok</p>;
}

function Sibling() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>sibling {n}</button>;
}

describe("T-51 ErrorBoundary (D-02)", () => {
  it("T-51 shows the fallback, keeps siblings, logs once, and reset renders the child again", () => {
    shouldThrow = true;
    const onError = vi.fn();
    // React logs caught render errors to console.error; keep the test output clean.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <ErrorBoundary
          onError={onError}
          fallback={({ error, reset }) => (
            <div>
              <p>fallback: {(error as Error).message}</p>
              <button onClick={reset}>retry</button>
            </div>
          )}
        >
          <Bomb />
        </ErrorBoundary>
        <Sibling />
      </div>
    );

    expect(screen.getByText("fallback: boom")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    // The rest of the page still works.
    fireEvent.click(screen.getByText("sibling 0"));
    expect(screen.getByText("sibling 1")).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText("retry"));
    expect(screen.getByText("child ok")).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("T-51 without onError the error is logged with the boundary name", () => {
    shouldThrow = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary name="Tray" fallback={() => <p>fallback</p>}>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(consoleError.mock.calls.some((args) => args[0] === "[Tray]")).toBe(true);
    consoleError.mockRestore();
  });
});
