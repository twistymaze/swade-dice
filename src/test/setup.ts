// Vitest setup: jest-dom matchers, React Testing Library cleanup, clean storage per test.
// Files with `// @vitest-environment node` also run this, so DOM parts are guarded.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

const hasDom = typeof window !== "undefined" && typeof document !== "undefined";

// jsdom has no layout: Element.scrollTo is missing (RollHistoryPanel auto-scrolls). No-op stand-in.
if (hasDom && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

function clearStorage() {
  if (!hasDom) return;
  window.localStorage.clear();
  window.sessionStorage.clear();
}

beforeEach(clearStorage);

afterEach(() => {
  if (hasDom) cleanup();
  clearStorage();
});
