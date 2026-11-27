// @vitest-environment node
import { describe, expect, it } from "vitest";
import config, { OWLBEAR_ORIGINS } from "../../vite.config";

describe("C-10 dev server and build config", () => {
  it("dev CORS allows only the Owlbear Rodeo origins", () => {
    expect(config.server?.cors).toEqual({ origin: OWLBEAR_ORIGINS });
    expect(OWLBEAR_ORIGINS).toEqual(["https://www.owlbear.rodeo", "https://owlbear.rodeo"]);
  });

  it("production source maps are not linked from the bundles", () => {
    expect(config.build?.sourcemap).toBe("hidden");
  });
});
