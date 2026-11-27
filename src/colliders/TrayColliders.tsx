import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { ThreeElements } from "@react-three/fiber";
import { TRAY_CUBOID_HALF_EXTENTS, TRAY_FLOOR, TRAY_WALLS } from "./trayDimensions";

export function TrayColliders(props: ThreeElements["group"]) {
  return (
    <group {...props}>
      {/* Floor of the tray */}
      <RigidBody
        type="fixed"
        friction={TRAY_FLOOR.friction}
        restitution={TRAY_FLOOR.restitution}
        userData={{ material: "LEATHER" }}
      >
        <CuboidCollider args={TRAY_CUBOID_HALF_EXTENTS} position={TRAY_FLOOR.position} />
      </RigidBody>
      {/* Walls and roof of the tray */}
      <RigidBody
        type="fixed"
        friction={TRAY_WALLS.friction}
        restitution={TRAY_WALLS.restitution}
        userData={{ material: "WOOD" }}
      >
        {TRAY_WALLS.cuboids.map(({ position, rotation }, index) => (
          <CuboidCollider
            key={index}
            args={TRAY_CUBOID_HALF_EXTENTS}
            position={position}
            rotation={rotation}
          />
        ))}
      </RigidBody>
    </group>
  );
}
