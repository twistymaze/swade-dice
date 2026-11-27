import { ConvexHullCollider } from "@react-three/rapier";
import { D6_VERTICES } from "./colliderVertices";

export function D6Collider() {
  return <ConvexHullCollider args={[D6_VERTICES]} />;
}
