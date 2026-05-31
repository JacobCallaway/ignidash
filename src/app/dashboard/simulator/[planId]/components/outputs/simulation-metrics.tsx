'use client';

import { useEffect } from 'react';
import { PartyPopperIcon, UmbrellaIcon, TriangleAlertIcon, BanknoteXIcon, LandmarkIcon, SunsetIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { KeyMetrics } from '@/lib/types/key-metrics';
import type { SimulationResult } from '@/lib/calc/simulation-engine';
import { keyMetricsForDisplay } from '@/lib/utils/display-formatters';
import { useUpdateCachedKeyMetrics, useUpdateCachedSimulationResult } from '@/lib/stores/simulator-store';
import { simulationResultToConvex } from '@/lib/utils/data-transformers';

import MetricsCard from './metrics-card';

interface SimulationMetricsProps {
  keyMetrics: KeyMetrics;
  simulationResult?: SimulationResult;
  onClickSuccessMetric?: () => void;
}

const getSuccessColor = (success: number): string => {
  if (success >= 0.8)
    return 'bg-green-100 text-green-800 inset-ring inset-ring-green-700/75 dark:bg-green-300/10 dark:text-green-200 dark:inset-ring-green-400/75';
  if (success >= 0.6)
    return 'bg-blue-100 text-blue-800 inset-ring inset-ring-blue-700/75 dark:bg-blue-300/10 dark:text-blue-200 dark:inset-ring-blue-400/75';
  if (success >= 0.4)
    return 'bg-yellow-100 text-yellow-800 inset-ring inset-ring-yellow-700/75 dark:bg-yellow-300/10 dark:text-yellow-200 dark:inset-ring-yellow-400/75';
  if (success >= 0.2)
    return 'bg-pink-100 text-pink-800 inset-ring inset-ring-pink-700/75 dark:bg-pink-300/10 dark:text-pink-200 dark:inset-ring-pink-400/75';
  return 'bg-red-100 text-red-800 inset-ring inset-ring-red-700/75 dark:bg-red-300/10 dark:text-red-200 dark:inset-ring-red-400/75';
};

export default function SimulationMetrics({ keyMetrics, simulationResult, onClickSuccessMetric }: SimulationMetricsProps) {
  const updateCachedKeyMetrics = useUpdateCachedKeyMetrics();
  const updateCachedSimulationResult = useUpdateCachedSimulationResult();

  useEffect(() => {
    updateCachedKeyMetrics(keyMetrics);
    return () => updateCachedKeyMetrics(null);
  }, [keyMetrics, updateCachedKeyMetrics]);

  useEffect(() => {
    if (simulationResult) {
      updateCachedSimulationResult(simulationResultToConvex(simulationResult));
    } else {
      updateCachedSimulationResult(null);
    }
    return () => updateCachedSimulationResult(null);
  }, [simulationResult, updateCachedSimulationResult]);

  const {
    successForDisplay,
    retirementAgeForDisplay,
    bankruptcyAgeForDisplay,
    portfolioAtRetirementForDisplay,
    lifetimeTaxesAndPenaltiesForDisplay,
    finalPortfolioForDisplay,
    progressToRetirementForDisplay,
  } = keyMetricsForDisplay(keyMetrics);

  const successColor = getSuccessColor(keyMetrics.success);

  const progressToRetirement = keyMetrics.progressToRetirement;
  const progressWidget =
    progressToRetirement !== null ? (
      <div className="relative h-10 w-10">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-primary/20" strokeWidth="6" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            className="stroke-primary"
            strokeWidth="6"
            strokeDasharray={`${progressToRetirement * 97.4} 97.4`}
            strokeLinecap="round"
          />
        </svg>
      </div>
    ) : null;

  const metricName = (name: string) => (keyMetrics.type === 'multi' ? `Mean ${name}` : name);

  return (
    <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
      <MetricsCard
        name="Success"
        stat={successForDisplay}
        className="col-span-2 2xl:col-span-1"
        statClassName={cn('px-1', successColor)}
        statContext="Hover for details"
        infoTooltip="Shows the share of Monte Carlo runs that reached retirement, ended with a positive balance, and had no portfolio shortfall. Click to show only failed scenarios."
        statWidget={<PartyPopperIcon className="text-primary h-10 w-10" />}
        onClick={onClickSuccessMetric}
        ariaLabel="Filter table to failed Monte Carlo scenarios"
      />
      <MetricsCard
        name={metricName('Progress to Retirement')}
        stat={progressToRetirementForDisplay}
        className="col-span-2"
        statContext="Hover for details"
        infoTooltip="The portfolio progress toward retirement is shown as a percentage of portfolio value at retirement, capped at 100%."
        statWidget={progressWidget}
      />
      <MetricsCard
        name={metricName('Retirement Age')}
        stat={retirementAgeForDisplay}
        statContext="Hover for details"
        infoTooltip="The age at which the simulation enters the retirement phase."
        statWidget={<UmbrellaIcon className="text-primary h-10 w-10" />}
      />
      <MetricsCard
        name={metricName('Bankruptcy Age')}
        stat={bankruptcyAgeForDisplay}
        statContext="Hover for details"
        infoTooltip="If the portfolio runs out, this is the first age where a shortfall occurs."
        statWidget={<TriangleAlertIcon className="text-primary h-10 w-10" />}
      />
      <MetricsCard
        name={metricName('Lifetime Taxes')}
        stat={lifetimeTaxesAndPenaltiesForDisplay}
        className="hidden 2xl:block"
        statContext="Hover for details"
        infoTooltip="Total lifetime federal income, FICA, capital gains, NIIT, and early withdrawal penalties estimated in this simulation."
        statWidget={<BanknoteXIcon className="text-primary h-10 w-10" />}
      />
      <MetricsCard
        name={metricName('Retirement Portfolio')}
        stat={portfolioAtRetirementForDisplay}
        className="2xl:col-span-2"
        statContext="Hover for details"
        infoTooltip="The portfolio value when retirement begins in the simulation."
        statWidget={<LandmarkIcon className="text-primary h-10 w-10" />}
      />
      <MetricsCard
        name={metricName('Final Portfolio')}
        stat={finalPortfolioForDisplay}
        statContext="Hover for details"
        infoTooltip="Portfolio value at the end of the simulation horizon."
        statWidget={<SunsetIcon className="text-primary h-10 w-10" />}
      />
    </div>
  );
}
