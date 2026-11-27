import VerifiedRounded from "@mui/icons-material/VerifiedRounded";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { BarPlot } from "@mui/x-charts/BarChart";
import { ChartsAxisHighlight } from "@mui/x-charts/ChartsAxisHighlight";
import { ChartsTooltip } from "@mui/x-charts/ChartsTooltip";
import { ChartsXAxis } from "@mui/x-charts/ChartsXAxis";
import { ChartsYAxis } from "@mui/x-charts/ChartsYAxis";
import { LinePlot } from "@mui/x-charts/LineChart";
import { ChartsContainer } from "@mui/x-charts/ChartsContainer";
import { useMemo } from "react";
import { Die } from "../types/Die";
import { summarizeFairness } from "./fairnessMath";

export default function FairnessCharts({
  die,
  rolledValues,
}: {
  die: Die;
  rolledValues: number[];
}) {
  const summary = useMemo(() => summarizeFairness(rolledValues, die.type), [rolledValues, die.type]);
  const xAxis = useMemo(() => summary.counts.map((_, i) => i + 1), [summary]);
  const expectedValueYAxis = useMemo(() => summary.counts.map(() => summary.expected), [summary]);
  const isFair = summary.isFair;

  return (
    <Stack sx={{ width: "100%", gap: 1 }}>
      <Tooltip title={`Chi-squared statistic (fair below ${summary.criticalValue} at p = 0.05)`}>
        <Typography
          variant="caption"
          color={isFair ? "success.main" : "warning.main"}
          sx={{ textAlign: "center", my: 1 }}
        >
          χ²: {summary.chiSquared.toFixed(2)}{" "}
          {isFair && (
            <VerifiedRounded
              sx={{ fontSize: "1.1rem", verticalAlign: "top" }}
              color="inherit"
            />
          )}
        </Typography>
      </Tooltip>
      <ChartsContainer
        xAxis={[
          {
            id: "roll-values",
            data: xAxis,
            scaleType: "band",
            position: "bottom",
            // Room for the tick labels and the axis label. x-charts blanks a
            // tick label whose measured height exceeds the space left by even a
            // fraction of a pixel; at 125 % zoom 45 left exactly the label height
            // (15.2 px), so keep a few pixels of slack.
            height: 50,
          },
        ]}
        yAxis={[
          {
            // No fixed max: the domain covers the bars and the expected line
            id: "number-rolls",
            position: "left",
          },
        ]}
        series={[
          {
            type: "bar",
            data: summary.counts,
            label: "Rolled",
          },
          {
            type: "line",
            data: expectedValueYAxis,
            label: "Expected",
          },
        ]}
        height={300}
        sx={{ overflow: "hidden" }}
      >
        <BarPlot />
        <LinePlot />
        <ChartsXAxis
          label={`${die.style.slice(0, 1)}${die.style.slice(1).toLowerCase()} ${
            die.type
          } Value`}
          axisId="roll-values"
        />
        <ChartsYAxis
          label="No. of Rolls"
          axisId="number-rolls"
        />
        <ChartsAxisHighlight x="band" />
        <ChartsTooltip />
      </ChartsContainer>
    </Stack>
  );
}
