import { lazy, Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  OrbitControls,
} from "@react-three/drei";

import Box from "@mui/material/Box";

import { DiceRollControls } from "../controls/DiceRollControls";
import { useDiceControlsStore } from "../controls/store";
import environment from "../environment.hdr";
import { AudioListenerProvider } from "../audio/AudioListenerProvider";
import { Tray } from "./Tray";
import { useDebugStore } from "../debug/store";
import { PreviewDiceRoll } from "../dice/PreviewDiceRoll";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { TrayUnavailable } from "./TrayUnavailable";
import { useWebGLContextLoss } from "./contextLoss";

// The physics subtree (Rapier, about 2 MB of inlined WASM) and the fairness tester
// load in their own chunks, so the tray and the preview dice can paint first.
const InteractiveDiceRoll = lazy(() =>
  import("../dice/InteractiveDiceRoll").then((m) => ({
    default: m.InteractiveDiceRoll,
  }))
);
const FairnessTester = lazy(() =>
  import("../fairness/FairnessTester").then((m) => ({
    default: m.FairnessTester,
  }))
);

// "default" lets the browser pick the GPU (often the integrated one on dual-GPU
// laptops) instead of forcing the discrete GPU; R3F keeps antialias and alpha.
const GL_OPTIONS = { powerPreference: "default" } as const;

function TrayEnvironment() {
  return <Environment files={environment} />;
}

/** Dice tray that controls the dice roll store */
export function InteractiveTray() {
  const allowOrbit = useDebugStore((state) => state.allowOrbit);
  const { lost, canvasKey, onCreated, reload } = useWebGLContextLoss();

  // Load the fairness tester the first time it is opened, then keep it mounted.
  const fairnessOpen = useDiceControlsStore((state) => state.fairnessTesterOpen);
  const [fairnessLoaded, setFairnessLoaded] = useState(false);
  useEffect(() => {
    if (fairnessOpen) setFairnessLoaded(true);
  }, [fairnessOpen]);

  return (
    <Box
      component="div"
      id="interactive-tray"
      sx={{
        borderRadius: 1,
        height: "100%",
        flex: 1,
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "flex-start",  // Align canvas to top
        "& canvas": {
          touchAction: "manipulation",
          userSelect: "none",
        },
      }}
    >
      <ErrorBoundary
        name="InteractiveTray"
        fallback={({ reset }) => (
          <TrayUnavailable
            message="The 3D dice tray stopped because of an error."
            onReload={() => {
              reload();
              reset();
            }}
          />
        )}
      >
        <Canvas
          key={canvasKey}
          frameloop="demand"
          onCreated={onCreated}
          gl={GL_OPTIONS}
          camera={{
            fov: 29,
            position: [0, 4.3, 0],
            rotation: [-Math.PI / 2, 0, 0],
          }}
        >
          <AudioListenerProvider>
            <Suspense fallback={null}>
              <TrayEnvironment />
            </Suspense>
            <ContactShadows
              resolution={256}
              scale={[1, 2]}
              position={[0, 0, 0]}
              blur={0.5}
              opacity={0.5}
              far={1}
              color="#222222"
            />
            {/* Separate boundaries: loading the textures of a new dice style
                must not hide the tray or the other dice */}
            <Suspense fallback={null}>
              <Tray />
            </Suspense>
            <Suspense fallback={null}>
              <PreviewDiceRoll />
            </Suspense>
            <Suspense fallback={null}>
              <InteractiveDiceRoll />
            </Suspense>
            {allowOrbit && <OrbitControls />}
          </AudioListenerProvider>
        </Canvas>
        {lost && (
          <TrayUnavailable
            message="The 3D dice tray lost its graphics context."
            onReload={reload}
          />
        )}
      </ErrorBoundary>
      <DiceRollControls />
      {fairnessLoaded || fairnessOpen ? (
        <Suspense fallback={null}>
          <FairnessTester />
        </Suspense>
      ) : null}
    </Box>
  );
}
