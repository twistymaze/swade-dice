/**
 * Tray collider layout, shared by `TrayColliders` and the physics tests.
 * Use a very large wall size and thickness to avoid the possibility
 * of the dice teleporting through the dice tray.
 */
export const WALL_THICKNESS = 50;
export const WALL_SIZE = 100;
export const FLOOR_Y = -WALL_THICKNESS + 0.005; // Push the floor up a little for better contact shadows
export const ROOF_Y = WALL_THICKNESS + 1.5;
export const WALL_X = WALL_THICKNESS + 0.46; // Move the wall in a bit to account for the wood thickness
export const WALL_Z = WALL_THICKNESS + 0.96;

/** Half extents of every tray cuboid */
export const TRAY_CUBOID_HALF_EXTENTS: [number, number, number] = [WALL_SIZE, WALL_THICKNESS, WALL_SIZE];

/** Large friction and restitution to simulate a bouncy material */
export const TRAY_FLOOR = { friction: 10, restitution: 0.5, position: [0, FLOOR_Y, 0] as [number, number, number] };

/**
 * Small friction to simulate a wooden material, high restitution to reduce the
 * chance that the dice will rest up against the wall. In creation order.
 */
export const TRAY_WALLS = {
  friction: 1,
  restitution: 0.9,
  cuboids: [
    // Bottom wall
    { position: [0, FLOOR_Y, WALL_Z], rotation: [Math.PI / 2, 0, 0] },
    // Top wall
    { position: [0, FLOOR_Y, -WALL_Z], rotation: [Math.PI / 2, 0, 0] },
    // Right wall
    { position: [WALL_X, FLOOR_Y, 0], rotation: [0, 0, Math.PI / 2] },
    // Left wall
    { position: [-WALL_X, FLOOR_Y, 0], rotation: [0, 0, Math.PI / 2] },
    // Roof
    { position: [0, ROOF_Y, 0], rotation: [0, 0, 0] },
  ] as { position: [number, number, number]; rotation: [number, number, number] }[],
};
