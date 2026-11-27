import { ConvexHullCollider } from "@react-three/rapier";
import { D12_VERTICES } from "./colliderVertices";

export function D12Collider() {
  return <ConvexHullCollider args={[D12_VERTICES]} />;
}
