// @vitest-environment node
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { setupPbrTextures } from "./gltfTexture";

describe("module-scope texture setup", () => {
  it("sets the same flipY and color spaces as the inline callbacks did", () => {
    const textures = [new THREE.Texture(), new THREE.Texture(), new THREE.Texture()];
    const versions = textures.map((t) => t.version);
    setupPbrTextures(textures);
    expect(textures.map((t) => t.flipY)).toEqual([false, false, false]);
    expect(textures.map((t) => t.colorSpace)).toEqual([
      THREE.SRGBColorSpace,
      THREE.NoColorSpace,
      THREE.NoColorSpace,
    ]);
    // No re-upload is requested.
    expect(textures.map((t) => t.version)).toEqual(versions);
  });
});
