// @vitest-environment node
/**
 * Smoke test: Rapier (the same 0.19.2 build that @react-three/rapier uses) runs in Node and is
 * deterministic: two identical worlds give bit-identical transforms after the same steps.
 * The app-level face-reading determinism test comes later, once collider data is exported.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await RAPIER.init();
});

function simulate(steps: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;

  // Tray floor.
  world.createCollider(RAPIER.ColliderDesc.cuboid(5, 0.1, 5).setTranslation(0, -0.1, 0));

  // A d6-sized box die thrown with a fixed velocity and spin.
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0.1, 1.1, -0.2)
      .setRotation({ x: -0.3553, y: 0.1814, z: -0.7356, w: 0.5474 })
      .setLinvel(0.33, 0, 1.54)
      .setAngvel({ x: 2.5, y: 2.45, z: 5.3 })
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.0075, 0.0075, 0.0075).setDensity(2).setFriction(0.1).setRestitution(0.4), body);

  for (let i = 0; i < steps; i++) world.step();

  const t = body.translation();
  const r = body.rotation();
  const result = [t.x, t.y, t.z, r.x, r.y, r.z, r.w];
  world.free();
  return result;
}

/** Exact bit pattern of each float64, so -0 vs 0 and NaN payloads count as differences. */
const bits = (values: number[]) => {
  const view = new DataView(new ArrayBuffer(8));
  return values.map((v) => {
    view.setFloat64(0, v);
    return view.getBigUint64(0).toString(16);
  });
};

describe("Rapier in Node", () => {
  it("uses rapier3d-compat 0.19.2", () => {
    expect(RAPIER.version()).toBe("0.19.2");
  });

  it("two identical worlds give bit-identical transforms after 600 steps", () => {
    const a = simulate(600);
    const b = simulate(600);
    expect(a.every(Number.isFinite)).toBe(true);
    expect(bits(a)).toEqual(bits(b));
  });

  it("the die actually moved and came to rest on the floor", () => {
    const [x, y, z] = simulate(600);
    expect(Math.hypot(x - 0.1, z + 0.2)).toBeGreaterThan(0.01);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(0.05);
  });
});
