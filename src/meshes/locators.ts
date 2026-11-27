/**
 * Face locators of each die mesh: empty groups under the mesh whose direction from the
 * mesh centre marks a face. `getValueFromDiceGroup` reads the number from the name
 * (`NNN_locator_<face>`, D10 face 0 = 10). Kept as data so tests can build the same
 * hierarchy without loading the GLB files.
 */
import { DiceType } from "../types/DiceType";

export interface Locator {
  name: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
}


export const LOCATORS: Record<"sharp" | "rounded", Record<DiceType, Locator[]>> = {
  sharp: {
    D4: [
      { name: "004_locator_1", position: [0, -0.61, -1.27], rotation: [-1.92, 0, 0] },
      { name: "004_locator_2", position: [-1.1, -0.61, 0.63], rotation: [-1.39, -0.3, 2.12] },
      { name: "004_locator_3", position: [1.1, -0.61, 0.63], rotation: [-1.39, 0.3, -2.12] },
      { name: "004_locator_4", position: [0, 1.18, 0] },
    ],
    D6: [
      { name: "006_locator_1", position: [0, -0.77, 0], rotation: [Math.PI, -1.57, 0] },
      { name: "006_locator_2", position: [-0.77, 0, 0], rotation: [-Math.PI, 0, Math.PI / 2] },
      { name: "006_locator_3", position: [0, 0, 0.77], rotation: [Math.PI / 2, -1.57, 0] },
      { name: "006_locator_4", position: [0, 0, -0.77], rotation: [-Math.PI / 2, Math.PI / 2, 0] },
      { name: "006_locator_5", position: [0.77, 0, 0], rotation: [0, 0, -Math.PI / 2] },
      { name: "006_locator_6", position: [0, 0.77, 0] },
    ],
    D8: [
      { name: "008_locator_1", position: [0.42, 0.52, 0.43], rotation: [1.11, 0.42, -0.68] },
      { name: "008_locator_2", position: [-0.47, -0.46, -0.45], rotation: [1.12, 0.43, 2.45] },
      { name: "008_locator_3", position: [0.45, -0.46, -0.47], rotation: [1.09, -0.41, -2.46] },
      { name: "008_locator_4", position: [-0.43, 0.52, 0.42], rotation: [1.11, -0.42, 0.69] },
      { name: "008_locator_5", position: [-0.42, 0.52, -0.43], rotation: [2.04, -0.42, 2.46] },
      { name: "008_locator_6", position: [0.47, -0.46, 0.45], rotation: [2.02, -0.43, -0.69] },
      { name: "008_locator_7", position: [-0.45, -0.46, 0.47], rotation: [2.05, 0.41, 0.68] },
      { name: "008_locator_8", position: [0.43, 0.52, -0.42], rotation: [2.03, 0.42, -2.46] },
    ],
    D10: [
      { name: "010_locator_0", position: [0.4, 0.42, -0.56], rotation: [2.21, 0.4, -2.65] },
      { name: "010_locator_1", position: [-0.7, -0.37, -0.22], rotation: [1.27, 0.68, 2] },
      { name: "010_locator_2", position: [0.01, 0.42, 0.69], rotation: [0.83, 0.01, 0] },
      { name: "010_locator_3", position: [0.69, -0.37, -0.23], rotation: [1.33, -0.7, -1.97] },
      { name: "010_locator_4", position: [-0.41, 0.42, -0.55], rotation: [2.2, -0.42, 2.65] },
      { name: "010_locator_5", position: [0.44, -0.37, 0.59], rotation: [2.22, -0.39, -0.49] },
      { name: "010_locator_6", position: [-0.65, 0.42, 0.22], rotation: [1.28, -0.69, 1.15] },
      { name: "010_locator_7", position: [-0.01, -0.37, -0.73], rotation: [0.83, -0.02, -Math.PI] },
      { name: "010_locator_8", position: [0.66, 0.42, 0.21], rotation: [1.31, 0.7, -1.17] },
      { name: "010_locator_9", position: [-0.42, -0.37, 0.6], rotation: [2.19, 0.43, 0.5] },
    ],
    D12: [
      { name: "012_locator_1", position: [0, -0.93, 0], rotation: [0, 0, Math.PI] },
      { name: "012_locator_10", position: [0.68, -0.41, -0.48], rotation: [-1.86, 0.37, -0.89] },
      { name: "012_locator_11", position: [0.27, 0.44, 0.79], rotation: [1.13, 0.13, -0.28] },
      { name: "012_locator_12", position: [0, 0.96, 0] },
      { name: "012_locator_2", position: [-0.25, -0.41, -0.8], rotation: [-2.01, -0.14, 0.28] },
      { name: "012_locator_3", position: [-0.67, 0.44, 0.5], rotation: [1.29, -0.37, 0.89] },
      { name: "012_locator_4", position: [-0.84, -0.41, -0.01], rotation: [-1.57, -0.46, 1.57] },
      { name: "012_locator_5", position: [0.67, -0.41, 0.5], rotation: [-1.29, 0.37, -2.25] },
      { name: "012_locator_6", position: [-0.27, -0.41, 0.79], rotation: [-1.13, -0.13, 2.86] },
      { name: "012_locator_7", position: [0.25, 0.44, -0.8], rotation: [2.01, 0.14, -2.86] },
      { name: "012_locator_8", position: [-0.68, 0.44, -0.48], rotation: [1.86, -0.37, 2.25] },
      { name: "012_locator_9", position: [0.84, 0.44, -0.01], rotation: [1.57, 0.46, -1.57] },
    ],
  },
  rounded: {
    D4: [
      { name: "004_locator_1", position: [0, -0.61, -1.27], rotation: [-1.92, 0, 0] },
      { name: "004_locator_2", position: [-1.1, -0.61, 0.63], rotation: [-1.39, -0.3, 2.12] },
      { name: "004_locator_3", position: [1.1, -0.61, 0.63], rotation: [-1.39, 0.3, -2.12] },
      { name: "004_locator_4", position: [0, 1.18, 0] },
    ],
    D6: [
      { name: "006_locator_1", position: [0, -0.77, 0], rotation: [Math.PI, -1.57, 0] },
      { name: "006_locator_2", position: [-0.77, 0, 0], rotation: [-Math.PI, 0, Math.PI / 2] },
      { name: "006_locator_3", position: [0, 0, 0.77], rotation: [Math.PI / 2, -1.57, 0] },
      { name: "006_locator_4", position: [0, 0, -0.77], rotation: [-Math.PI / 2, Math.PI / 2, 0] },
      { name: "006_locator_5", position: [0.77, 0, 0], rotation: [0, 0, -Math.PI / 2] },
      { name: "006_locator_6", position: [0, 0.77, 0] },
    ],
    D8: [
      { name: "008_locator_1", position: [0.42, 0.52, 0.43], rotation: [1.11, 0.42, -0.68] },
      { name: "008_locator_2", position: [-0.47, -0.46, -0.45], rotation: [1.12, 0.43, 2.45] },
      { name: "008_locator_3", position: [0.45, -0.46, -0.47], rotation: [1.09, -0.41, -2.46] },
      { name: "008_locator_4", position: [-0.43, 0.52, 0.42], rotation: [1.11, -0.42, 0.69] },
      { name: "008_locator_5", position: [-0.42, 0.52, -0.43], rotation: [2.04, -0.42, 2.46] },
      { name: "008_locator_6", position: [0.47, -0.46, 0.45], rotation: [2.02, -0.43, -0.69] },
      { name: "008_locator_7", position: [-0.45, -0.46, 0.47], rotation: [2.05, 0.41, 0.68] },
      { name: "008_locator_8", position: [0.43, 0.52, -0.42], rotation: [2.03, 0.42, -2.46] },
    ],
    D10: [
      { name: "010_locator_0", position: [0.4, 0.42, -0.56], rotation: [2.21, 0.4, -2.65] },
      { name: "010_locator_1", position: [-0.7, -0.37, -0.22], rotation: [1.27, 0.68, 2] },
      { name: "010_locator_2", position: [0.01, 0.42, 0.69], rotation: [0.83, 0.01, 0] },
      { name: "010_locator_3", position: [0.69, -0.37, -0.23], rotation: [1.33, -0.7, -1.97] },
      { name: "010_locator_4", position: [-0.41, 0.42, -0.55], rotation: [2.2, -0.42, 2.65] },
      { name: "010_locator_5", position: [0.44, -0.37, 0.59], rotation: [2.22, -0.39, -0.49] },
      { name: "010_locator_6", position: [-0.65, 0.42, 0.22], rotation: [1.28, -0.69, 1.15] },
      { name: "010_locator_7", position: [-0.01, -0.37, -0.73], rotation: [0.83, -0.02, -Math.PI] },
      { name: "010_locator_8", position: [0.66, 0.42, 0.21], rotation: [1.31, 0.7, -1.17] },
      { name: "010_locator_9", position: [-0.42, -0.37, 0.6], rotation: [2.19, 0.43, 0.5] },
    ],
    D12: [
      { name: "012_locator_1", position: [0, -0.93, 0], rotation: [0, 0, Math.PI] },
      { name: "012_locator_10", position: [0.68, -0.41, -0.48], rotation: [-1.86, 0.37, -0.89] },
      { name: "012_locator_11", position: [0.27, 0.44, 0.79], rotation: [1.13, 0.13, -0.28] },
      { name: "012_locator_12", position: [0, 0.96, 0] },
      { name: "012_locator_2", position: [-0.25, -0.41, -0.8], rotation: [-2.01, -0.14, 0.28] },
      { name: "012_locator_3", position: [-0.67, 0.44, 0.5], rotation: [1.29, -0.37, 0.89] },
      { name: "012_locator_4", position: [-0.84, -0.41, -0.01], rotation: [-1.57, -0.46, 1.57] },
      { name: "012_locator_5", position: [0.67, -0.41, 0.5], rotation: [-1.29, 0.37, -2.25] },
      { name: "012_locator_6", position: [-0.27, -0.41, 0.79], rotation: [-1.13, -0.13, 2.86] },
      { name: "012_locator_7", position: [0.25, 0.44, -0.8], rotation: [2.01, 0.14, -2.86] },
      { name: "012_locator_8", position: [-0.68, 0.44, -0.48], rotation: [1.86, -0.37, 2.25] },
      { name: "012_locator_9", position: [0.84, 0.44, -0.01], rotation: [1.57, 0.46, -1.57] },
    ],
  },
};
