'use client';

import { Select } from '@/components/catalyst/select';
import type { SingleSimulationTaxesChartDataPoint } from '@/lib/types/chart-data-points';
import type { TaxesDataView } from '@/lib/types/chart-data-views';
import { useShowReferenceLines } from '@/lib/stores/simulator-store';
import type { KeyMetrics } from '@/lib/types/key-metrics';
import { useCountryConfig } from '@/hooks/use-country-config';

import SingleSimulationTaxesLineChart from '../../charts/single-simulation/single-simulation-taxes-line-chart';
import ChartTimeFrameDropdown from '../../chart-time-frame-dropdown';
import ChartCard from '../chart-card';

interface SingleSimulationTaxesLineChartCardProps {
  onAgeSelect: (age: number) => void;
  selectedAge: number;
  setDataView: (view: TaxesDataView) => void;
  dataView: TaxesDataView;
  rawChartData: SingleSimulationTaxesChartDataPoint[];
  keyMetrics: KeyMetrics;
  startAge: number;
}

export default function SingleSimulationTaxesLineChartCard({
  onAgeSelect,
  selectedAge,
  setDataView,
  dataView,
  rawChartData,
  keyMetrics,
  startAge,
}: SingleSimulationTaxesLineChartCardProps) {
  const showReferenceLines = useShowReferenceLines();
  const countryConfig = useCountryConfig();
  const socialSecurityLabel = countryConfig.incomeTypes.find((t) => t.isSocialSecurityLike)?.label ?? null;

  return (
    <ChartCard
      title="Taxes"
      subtitle="Time Series"
      truncateTitle
      controls={
        <>
          <Select
            aria-label="Taxes data view options"
            className="max-w-48 sm:max-w-64"
            id="taxes-data-view"
            name="taxes-data-view"
            value={dataView}
            onChange={(e) => setDataView(e.target.value as TaxesDataView)}
          >
            <optgroup label="Tax Amounts">
              <option value="annualAmounts">Annual Taxes</option>
              <option value="cumulativeAmounts">Cumulative Taxes</option>
              <option value="adjustmentsAndDeductions">Adjustments &amp; Deductions</option>
            </optgroup>
            <optgroup label="Tax Rates">
              <option value="marginalRates">Top Marginal Rates</option>
              <option value="effectiveRates">Effective Rates</option>
            </optgroup>
            <optgroup label="Income Calculations">
              <option value="adjustedGrossIncome">Adjusted Gross Income</option>
              <option value="taxableIncome">Taxable Income</option>
            </optgroup>
            <optgroup label="Income Sources">
              <option value="ordinaryIncome">Ordinary Income</option>
              <option value="capitalGainsAndDividends">Capital Gains &amp; Dividends</option>
              <option value="investmentIncome">Investment Income</option>
              <option value="retirementDistributions">Retirement Distributions</option>
              <option value="taxFreeIncome">Tax-Free Income</option>
            </optgroup>
            <optgroup label="Issues & Penalties">
              <option value="earlyWithdrawalPenalties">Early Withdrawal Penalties</option>
            </optgroup>
            {socialSecurityLabel && (
              <optgroup label={socialSecurityLabel}>
                <option value="socialSecurityIncome">{socialSecurityLabel} Income</option>
                <option value="socialSecurityTaxablePercentage">Taxable % of {socialSecurityLabel}</option>
              </optgroup>
            )}
          </Select>
          <ChartTimeFrameDropdown timeFrameType="single" />
        </>
      }
    >
      <SingleSimulationTaxesLineChart
        onAgeSelect={onAgeSelect}
        selectedAge={selectedAge}
        rawChartData={rawChartData}
        keyMetrics={keyMetrics}
        showReferenceLines={showReferenceLines}
        dataView={dataView}
        startAge={startAge}
      />
    </ChartCard>
  );
}
