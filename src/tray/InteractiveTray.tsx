import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  OrbitControls,
} from "@react-three/drei";

import Box from "@mui/material/Box";

import { DiceRollControls } from "../controls/DiceRollControls";
import environment from "../environment.hdr";
import { AudioListenerProvider } from "../audio/AudioListenerProvider";
import { Tray } from "./Tray";
import { useDebugStore } from "../debug/store";
import { PreviewDiceRoll } from "../dice/PreviewDiceRoll";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { TrayUnavailable } from "./TrayUnavailable";
import { useWebGLContextLoss } from "./contextLoss";
import { InteractiveDiceRoll } from "../dice/InteractiveDiceRoll";
import { FairnessTester } from "../fairness/FairnessTester";

function TrayEnvironment() {
  return <Environment files={environment} />;
}

/** Dice tray that controls the dice roll store */
export function InteractiveTray() {
  const allowOrbit = useDebugStore((state) => state.allowOrbit);
  const { lost, canvasKey, onCreated, reload } = useWebGLContextLoss();

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
      <FairnessTester />
    </Box>
  );
}
