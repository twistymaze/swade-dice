import React from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { getMaxValue } from "../helpers/explosionDisplay";
import { SavageRollResult, DieChain } from "../types/SavageWorldsTypes";
import { DiceType } from "../types/DiceType";
import { getCriticalFailureStatus, formatCriticalIndicator } from "../helpers/criticalFailure";

interface SavageWorldsResultsProps {
  result: SavageRollResult;
}

export function SavageWorldsResults({ result }: SavageWorldsResultsProps) {
  const { dieChains, outcomes, mode, modifier, targetNumber, isComplete, wildDieEnabled } = result;
  
  const isTraitTest = mode === "TRAIT";
  const isMultiDieTrait = isTraitTest && outcomes.length > 1;
  const isStandard = mode === "STANDARD";
  // A Critical Failure is never a success, also in old payloads that say success
  const critStatusOf = (index: number) => getCriticalFailureStatus(result, index);
  const isSuccess = (index: number) =>
    outcomes[index]?.success === true && !critStatusOf(index).isCritical;
  const renderCrit = (index: number, ml: number) => {
    const critStatus = critStatusOf(index);
    if (critStatus.isPossible && isSuccess(index)) return null;
    const indicator = formatCriticalIndicator(critStatus, true);
    if (!indicator) return null;
    return (
      <Typography variant="body2" sx={{ color: indicator.color, fontWeight: "bold", ml }}>
        {critStatus.isCritical ? "!!" : "??"} {indicator.text}
      </Typography>
    );
  };
  
  // Don't show anything if no results yet
  if (!dieChains || dieChains.length === 0) {
    return null;
  }
  
  // Explosion chain of one die, rendered flat (no nesting per roll)
  const renderExplosionChain = (rolls: number[], dieType: DiceType) => (
    <>
      {rolls.map((value: number, index: number) => {
        const isMax = value === getMaxValue(dieType);
        const isLastRoll = index === rolls.length - 1;
        const showExplosion = isMax && !isLastRoll;
        return (
          <span key={index}>
            {value}{showExplosion && "💥"}
            {!isLastRoll && " + "}
          </span>
        );
      })}
    </>
  );
  
  // Prepare dice display based on mode
  let diceDisplay: React.ReactNode;
  
  if (isTraitTest) {
    // Trait test - show individual chains with "Trait" and "Wild" labels
    const regularChains = dieChains.filter(c => !c.isWildDie);
    const wildChains = dieChains.filter(c => c.isWildDie);
    
    diceDisplay = (
      <>
        {regularChains.map((chain, index) => (
          <Typography key={`trait-${index}`} variant="body2" color="white">
            Trait ({chain.dieType.toLowerCase()}): {renderExplosionChain(chain.rolls, chain.dieType)}
            {chain.rolls.length > 1 && ` = ${chain.total}`}
          </Typography>
        ))}
        {wildDieEnabled && wildChains.map((chain, index) => (
          <Typography key={`wild-${index}`} variant="body2" color="white">
            Wild ({chain.dieType.toLowerCase()}): {renderExplosionChain(chain.rolls, chain.dieType)}
            {chain.rolls.length > 1 && ` = ${chain.total}`}
          </Typography>
        ))}
      </>
    );
  } else {
    // Damage roll - group by die type (a Map: no prototype keys from a payload)
    const groupedByType = new Map<DiceType, DieChain[]>();
    dieChains.forEach(chain => {
      const group = groupedByType.get(chain.dieType);
      if (group) group.push(chain);
      else groupedByType.set(chain.dieType, [chain]);
    });
    
    diceDisplay = (
      <>
        {[...groupedByType.entries()].map(([dieType, chains]) => {
          const groupTotal = chains.reduce((sum, c) => sum + c.total, 0);
          const needsTotal = chains.length > 1 || chains.some(c => c.rolls.length > 1);
          return (
            <Typography key={dieType} variant="body2" color="white">
              {chains.length}{dieType.toLowerCase()}: {
                chains.map((chain, chainIndex) => (
                  <span key={chainIndex}>
                    {chainIndex > 0 && " + "}
                    {renderExplosionChain(chain.rolls, chain.dieType as DiceType)}
                  </span>
                ))
              }
              {needsTotal && ` = ${groupTotal}`}
            </Typography>
          );
        })}
      </>
    );
  }
  
  return (
    <Stack spacing={0.5} sx={{ alignItems: "flex-start" }}>
      {/* Display dice */}
      {diceDisplay}
      
      {/* Show modifier if non-zero. STANDARD rolls have no modifier. */}
      {!isStandard && modifier !== undefined && modifier !== 0 && (
        <Typography variant="body2" color="white">
          Modifier: {modifier > 0 ? '+' : ''}{modifier}
        </Typography>
      )}
      
      {/* Show results */}
      {isTraitTest && isMultiDieTrait ? (
        // Multi-die trait test results
        <>
          <Typography variant="body2" color="white" sx={{ borderTop: '1px solid rgba(255,255,255,0.3)', pt: 0.5, mt: 0.5 }}>
            Results:
          </Typography>
          {outcomes.map((outcome, index) => (
            <Stack key={index} direction="row" spacing={0.5} sx={{ alignItems: "center", ml: 2 }}>
              <Typography variant="body2" color="white">
                {outcome.total}
                {outcome.replacedByWild && " (wild)"}
              </Typography>
              {outcome.success !== undefined && (
                isSuccess(index) ? (
                  <>
                    <CheckIcon sx={{ fontSize: "14px", color: "#4caf50" }} />
                    <Typography variant="body2" color="#4caf50">
                      Success vs TN {targetNumber}{outcome.raises && outcome.raises > 0 ? ` (${outcome.raises} raise${outcome.raises > 1 ? 's' : ''})` : ''}
                    </Typography>
                  </>
                ) : (
                  <>
                    <CloseIcon sx={{ fontSize: "14px", color: "#f44336" }} />
                    <Typography variant="body2" color="#f44336">
                      Failed vs TN {targetNumber}
                    </Typography>
                    {renderCrit(index, 0.5)}
                  </>
                )
              )}
            </Stack>
          ))}
        </>
      ) : isStandard && outcomes.length > 1 ? (
        // STANDARD: one raw value per die
        <>
          <Typography variant="body2" color="white" sx={{ borderTop: '1px solid rgba(255,255,255,0.3)', pt: 0.5, mt: 0.5 }}>
            Results:
          </Typography>
          {outcomes.map((outcome, index) => (
            <Typography key={index} variant="body2" color="white" sx={{ ml: 2 }}>
              {outcome.chains[0]?.dieType.toLowerCase()}: {outcome.total}
            </Typography>
          ))}
        </>
      ) : outcomes.length > 0 ? (
        // Single result (single trait test or damage)
        <>
          <Typography variant="body2" color="white" sx={{ borderTop: '1px solid rgba(255,255,255,0.3)', pt: 0.5, mt: 0.5 }}>
            {isTraitTest ? "Result" : "Total"}: {outcomes[0]!.total}
          </Typography>
          {isTraitTest && isComplete && outcomes[0]!.success !== undefined && (
            isSuccess(0) ? (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <CheckIcon sx={{ fontSize: "16px", color: "#4caf50" }} />
                <Typography variant="body2" color="#4caf50">
                  Success vs TN {targetNumber}
                  {outcomes[0]!.raises && outcomes[0]!.raises > 0 ? ` with ${outcomes[0]!.raises} raise${outcomes[0]!.raises > 1 ? 's' : ''}!` : ''}
                </Typography>
              </Stack>
            ) : (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <CloseIcon sx={{ fontSize: "16px", color: "#f44336" }} />
                <Typography variant="body2" color="#f44336">
                  Failed vs TN {targetNumber}
                </Typography>
                {renderCrit(0, 1)}
              </Stack>
            )
          )}
        </>
      ) : null}
    </Stack>
  );
}