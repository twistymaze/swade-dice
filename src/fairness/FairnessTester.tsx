import CloseIcon from "@mui/icons-material/CloseRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import ExpandLess from "@mui/icons-material/ExpandLessRounded";
import InfoRounded from "@mui/icons-material/InfoRounded";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import FormLabel from "@mui/material/FormLabel";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { getDiceToRoll, useDiceControlsStore } from "../controls/store";
import { useDiceRollStore } from "../dice/store";
import { Die } from "../types/Die";
import Backdrop from "@mui/material/Backdrop";
import Slide from "@mui/material/Slide";
import { SavageRollResult } from "../types/SavageWorldsTypes";
import { FAIRNESS_UPDATE_EVERY, canStartFairnessTest, getSides, isFaceValue } from "./fairnessMath";

const FairnessCharts = lazy(() => import("./FairnessCharts"));

const marks = [
  {
    value: 20,
  },
  {
    value: 100,
  },
  {
    value: 500,
    label: "500",
  },
  {
    value: 1000,
  },
  {
    value: 2000,
    label: "2K",
  },
  {
    value: 5000,
    label: "5K",
  },
];

export function FairnessTester() {
  const open = useDiceControlsStore((state) => state.fairnessTesterOpen);
  const toggleOpen = useDiceControlsStore(
    (state) => state.toggleFairnessTester
  );

  const startRoll = useDiceRollStore((state) => state.startRoll);
  const clearRoll = useDiceRollStore((state) => state.clearRoll);
  const reroll = useDiceRollStore((state) => state.reroll);
  const diceById = useDiceControlsStore((state) => state.diceById);
  const counts = useDiceControlsStore((state) => state.diceCounts);
  const resetDiceCounts = useDiceControlsStore(
    (state) => state.resetDiceCounts
  );

  const singleDiceSelected = useMemo(() => {
    const totalCount = Object.values(counts).reduce(
      (prev, curr) => prev + curr,
      0
    );
    return totalCount === 1;
  }, [counts]);

  const [numberRolls, setNumberRolls] = useState(500);

  const [active, setActive] = useState(false);

  // Values are collected in a ref and copied to state in batches (E-11)
  const valuesRef = useRef<number[]>([]);
  const lastResultRef = useRef<SavageRollResult | null>(null);
  const [rolledValues, setRolledValues] = useState<number[]>([]);
  // Finished rolls, valid or not; each one triggers the next reroll
  const [attempts, setAttempts] = useState(0);
  const [rolledCount, setRolledCount] = useState(0);
  const [invalidRolls, setInvalidRolls] = useState(0);
  const [rolledDie, setRolledDie] = useState<Die | null>(null);

  const [showResults, setShowResults] = useState(false);

  const finished = Boolean(!active && rolledDie);
  const starting = Boolean(!active && !rolledDie);

  function resetValues() {
    valuesRef.current = [];
    lastResultRef.current = null;
    setRolledValues([]);
    setAttempts(0);
    setRolledCount(0);
    setInvalidRolls(0);
  }

  function handleStart() {
    resetValues();

    const rolling = Object.entries(counts).find(([_, value]) => value > 0);
    if (rolling && diceById[rolling[0]]) {
      const rollingDie = diceById[rolling[0]];
      if (rollingDie) {
        setRolledDie(rollingDie);
        // STANDARD: raw values, no explosions. No wild die: test one die only.
        const dice = getDiceToRoll(counts, diceById, false);
        startRoll({ dice, hidden: true }, { mode: "STANDARD" });
        setActive(true);
        handleCountsReset();
      }
    }
  }

  function handleStop() {
    setRolledValues([...valuesRef.current]);
    setShowResults(true);
    setActive(false);
  }

  function handleRestart() {
    setActive(false);
    setRolledDie(null);
    resetValues();
    setShowResults(false);
  }

  function handleCountsReset() {
    resetDiceCounts();
  }

  // Subscribe to roll finish events: each finished result is counted once
  useEffect(() => {
    if (active && rolledDie) {
      const sides = getSides(rolledDie.type);
      return useDiceRollStore.subscribe((state) => {
        const result = state.currentRollResult;
        if (!state.roll || !result || !result.isComplete || result === lastResultRef.current) {
          return;
        }
        lastResultRef.current = result;
        const value = result.dieChains[0]?.total ?? NaN;
        if (isFaceValue(value, sides)) {
          valuesRef.current.push(value);
          const count = valuesRef.current.length;
          setRolledCount(count);
          if (count % FAIRNESS_UPDATE_EVERY === 0 || count >= numberRolls) {
            setRolledValues([...valuesRef.current]);
          }
        } else {
          setInvalidRolls((n) => n + 1);
        }
        setAttempts((n) => n + 1);
      });
    }
  }, [active, rolledDie, numberRolls]);

  // Reroll if we need or clear the roll if we've reached our rolls
  useEffect(() => {
    if (active && attempts > 0) {
      if (rolledCount >= numberRolls) {
        setActive(false);
        clearRoll();
        setRolledValues([...valuesRef.current]);
        setShowResults(true);
      } else {
        reroll();
      }
    }
  }, [active, attempts, rolledCount, clearRoll, numberRolls, reroll]);


  const theme = useTheme();

  return (
    <>
      <Backdrop open={open && active} invisible />
      <Slide in={open} direction="up" unmountOnExit>
        <Paper
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            p: 2,
            backgroundColor: active
              ? theme.palette.mode === "light"
                ? "rgba(241, 243, 249, 0.6)"
                : "rgba(30, 34, 49, 0.8)"
              : undefined,
          }}
        >
          <Stack sx={{ gap: 1 }}>
            <Alerts
              active={active}
              numberRolls={numberRolls}
              rolled={rolledDie !== null}
              singleDiceSelected={singleDiceSelected}
            />
            {rolledDie && (
              <Stack>
                <Button
                  onClick={() => {
                    setShowResults(!showResults);
                  }}
                  size="small"
                  sx={{
                    pt: 1.5,
                    px: 2,
                  }}
                  fullWidth
                >
                  <ExpandLess
                    sx={{
                      position: "absolute",
                      top: "0px",
                      transform: `rotate(${showResults ? "180deg" : "0deg"})`,
                      transition: theme.transitions.create("transform", {
                        duration: theme.transitions.duration.shortest,
                      }),
                    }}
                    fontSize="small"
                  />
                  <Typography variant="caption">Results</Typography>
                </Button>
                <Collapse in={showResults} unmountOnExit>
                  <Stack
                    sx={{
                      height: 345,
                      width: "100%",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Suspense fallback={<CircularProgress />}>
                      <FairnessCharts
                        die={rolledDie}
                        rolledValues={rolledValues}
                      />
                    </Suspense>
                  </Stack>
                </Collapse>
              </Stack>
            )}
            {starting && (
              <Stack
                direction="row"
                sx={{
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Typography variant="h6" id="rolls-label">
                  Rolls
                </Typography>
                <Tooltip title="Close Tester" disableInteractive>
                  <IconButton onClick={() => toggleOpen()} disabled={active}>
                    <CloseIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
            {starting && (
              <Stack sx={{ px: 1 }}>
                <Slider
                  aria-labelledby="rolls-label"
                  value={numberRolls}
                  onChange={(_event: Event, v: number | number[]) => !Array.isArray(v) && setNumberRolls(v)}
                  min={0}
                  max={5000}
                  defaultValue={500}
                  step={null}
                  valueLabelDisplay="auto"
                  marks={marks}
                  disabled={active}
                />
              </Stack>
            )}
            {active && (
              <Stack sx={{ gap: 1 }}>
                <LinearProgress
                  sx={{ my: 1, borderRadius: 2 }}
                  id="testing-progress"
                  variant="determinate"
                  value={numberRolls > 0 ? (rolledCount / numberRolls) * 100 : 0}
                />
                <FormLabel htmlFor="testing-progress">
                  {rolledCount} of {numberRolls} Rolls
                  {invalidRolls > 0 && ` (${invalidRolls} invalid)`}
                </FormLabel>
              </Stack>
            )}
            {starting && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: "center" }}
              >
                test dice fairness by rolling many times
              </Typography>
            )}
            {finished && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: "center" }}
              >
                {rolledValues.length} of {numberRolls} rolls completed
                {invalidRolls > 0 && `, ${invalidRolls} invalid`}
              </Typography>
            )}
            {starting && (
              <Button
                variant="contained"
                disabled={!canStartFairnessTest(counts, numberRolls)}
                fullWidth
                onClick={() => handleStart()}
              >
                Start
              </Button>
            )}
            {active && (
              <Button
                variant="contained"
                fullWidth
                onClick={() => handleStop()}
              >
                Stop
              </Button>
            )}
            {finished && (
              <Stack direction="row" sx={{ gap: 1 }}>
                <Button
                  variant="outlined"
                  fullWidth
                  endIcon={<InfoRounded />}
                  size="small"
                  href="https://blog.owlbear.rodeo/are-owlbear-rodeos-dice-still-fair/"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Explain
                </Button>
                {rolledDie && (
                  <ExportButton
                    rolledDie={rolledDie}
                    rolledValues={rolledValues}
                  />
                )}
              </Stack>
            )}
            {finished && (
              <Button
                variant="contained"
                fullWidth
                onClick={() => handleRestart()}
              >
                Restart
              </Button>
            )}
          </Stack>
        </Paper>
      </Slide>
    </>
  );
}

function ExportButton({
  rolledValues,
  rolledDie,
}: {
  rolledValues: number[];
  rolledDie: Die;
}) {
  const [url, setUrl] = useState("#");

  useEffect(() => {
    const content = rolledValues.join("\n");
    const file = new Blob([content], { type: "text/plain" });
    const href = URL.createObjectURL(file);
    setUrl(href);
    return () => {
      URL.revokeObjectURL(href);
    };
  }, [rolledValues]);

  return (
    <Button
      variant="outlined"
      fullWidth
      endIcon={<DownloadRounded />}
      size="small"
      href={url}
      download={`${rolledDie.style}-${rolledDie.type}-rolls-${rolledValues.length}.txt`}
    >
      Export
    </Button>
  );
}

function Alerts({
  singleDiceSelected,
  numberRolls,
  active,
  rolled,
}: {
  singleDiceSelected: boolean;
  numberRolls: number;
  active: boolean;
  rolled: boolean;
}) {
  if (active || rolled) {
    return null;
  }

  return (
    <>
      {!singleDiceSelected && (
        <Alert severity="warning">Select one dice to begin testing</Alert>
      )}
      {numberRolls < 500 && (
        <Alert severity="warning">
          Low number of rolls selected. This will give inaccurate results
        </Alert>
      )}
    </>
  );
}
