import { ConvexHullCollider } from "@react-three/rapier";
import { D4_VERTICES } from "./colliderVertices";

export function D4Collider() {
  return <ConvexHullCollider args={[D4_VERTICES]} />;
}
