import { ConvexHullCollider } from "@react-three/rapier";
import { D8_VERTICES } from "./colliderVertices";

export function D8Collider() {
  return <ConvexHullCollider args={[D8_VERTICES]} />;
}
