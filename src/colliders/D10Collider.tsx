import { ConvexHullCollider } from "@react-three/rapier";
import { D10_VERTICES } from "./colliderVertices";

export function D10Collider() {
  return <ConvexHullCollider args={[D10_VERTICES]} />;
}
