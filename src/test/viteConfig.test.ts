// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveConfig } from "vite";
import config, { CONTENT_SECURITY_POLICY, OWLBEAR_ORIGINS, cspPlugin } from "../../vite.config";

describe("C-10 dev server and build config", () => {
  it("dev CORS allows only the Owlbear Rodeo origins", () => {
    expect(config.server?.cors).toEqual({ origin: OWLBEAR_ORIGINS });
    expect(OWLBEAR_ORIGINS).toEqual(["https://www.owlbear.rodeo", "https://owlbear.rodeo"]);
  });

  it("production source maps are not linked from the bundles", () => {
    expect(config.build?.sourcemap).toBe("hidden");
  });
});

describe("C-09 production Content Security Policy", () => {
  const plugin = cspPlugin();

  it("applies to the build only, not to the dev server", async () => {
    expect(plugin.apply).toBe("build");
    const names = async (command: "build" | "serve") =>
      (await resolveConfig({ configFile: "vite.config.ts", logLevel: "silent" }, command)).plugins.map((p) => p.name);
    expect(await names("build")).toContain("swade-csp");
    expect(await names("serve")).not.toContain("swade-csp");
  });

  it("injects the policy as a meta element at the start of head", () => {
    const hook = plugin.transformIndexHtml as { handler: () => unknown };
    expect(hook.handler()).toEqual([
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
        injectTo: "head-prepend",
      },
    ]);
  });

  it("keeps the directives the build needs and nothing that a meta CSP ignores", () => {
    const directives = new Map(
      CONTENT_SECURITY_POLICY.split(";").map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values] as const;
      })
    );
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives.get("style-src")).toEqual(["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]);
    expect(directives.get("font-src")).toContain("https://fonts.gstatic.com");
    expect(directives.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.has("frame-ancestors")).toBe(false);
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
  });
});
