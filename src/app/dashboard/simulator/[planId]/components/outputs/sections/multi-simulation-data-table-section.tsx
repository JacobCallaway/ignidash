'use client';

import { useState, memo } from 'react';

import SectionContainer from '@/components/ui/section-container';
import type { SimulationResult } from '@/lib/calc/simulation-engine';
import type { MultiSimulationTableRow, YearlyAggregateTableRow } from '@/lib/schemas/tables/multi-simulation-table-schema';
import { generateMultiSimulationTableColumns, generateYearlyAggregateTableColumns } from '@/lib/utils/table-formatters';

import TableTypeSelector, { TableType } from '../table-type-selector';
import Table from '../tables/table';
import SingleSimulationDataTable from '../tables/single-simulation-data-table';

const multiSimColumns = generateMultiSimulationTableColumns();
const yearlyAggColumns = generateYearlyAggregateTableColumns();

interface TableWithSelectedSeedProps {
  simulation: SimulationResult;
}

function TableWithSelectedSeed({ simulation }: TableWithSelectedSeedProps) {
  return <SingleSimulationDataTable simulation={simulation} />;
}

interface MultiSimulationDataTableSectionProps {
  simulation: SimulationResult | null | undefined;
  tableData: MultiSimulationTableRow[];
  yearlyTableData: YearlyAggregateTableRow[];
  activeSeed: number | undefined;
  handleSeedFromTableChange: (seed: number | null) => void;
  showFailedScenariosOnly: boolean;
  onClearFailedScenarios: () => void;
}

function MultiSimulationDataTableSection({
  simulation,
  tableData,
  yearlyTableData,
  activeSeed,
  handleSeedFromTableChange,
  showFailedScenariosOnly = false,
  onClearFailedScenarios = () => {},
}: MultiSimulationDataTableSectionProps) {
  const [currentTableType, setCurrentTableType] = useState<TableType>(TableType.AllSimulations);

  const filteredTableData = showFailedScenariosOnly ? tableData.filter((row) => !row.success) : tableData;
  const failedCount = tableData.length - filteredTableData.length;

  let tableComponent;
  if (activeSeed && simulation) {
    tableComponent = <TableWithSelectedSeed simulation={simulation} />;
  } else {
    switch (currentTableType) {
      case TableType.AllSimulations:
        tableComponent = (
          <>
            {showFailedScenariosOnly && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <div>
                  Showing <strong>{failedCount}</strong> failed simulation{failedCount === 1 ? '' : 's'} only.
                </div>
                <button
                  type="button"
                  onClick={onClearFailedScenarios}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  Show all scenarios
                </button>
              </div>
            )}
            <Table<MultiSimulationTableRow>
              columns={multiSimColumns}
              data={filteredTableData}
              keyField="seed"
              onRowClick={(row: MultiSimulationTableRow) => handleSeedFromTableChange(row.seed)}
              exportFilename="multi-simulation-data.csv"
            />
          </>
        );
        break;
      case TableType.YearlyResults:
        tableComponent = (
          <Table<YearlyAggregateTableRow>
            columns={yearlyAggColumns}
            data={yearlyTableData}
            keyField="year"
            exportFilename="yearly-aggregate-data.csv"
          />
        );
        break;
    }
  }

  return (
    <SectionContainer showBottomBorder={false} className="mb-0">
      {!activeSeed && <TableTypeSelector currentType={currentTableType} setCurrentType={setCurrentTableType} />}
      {tableComponent}
    </SectionContainer>
  );
}

export default memo(MultiSimulationDataTableSection);
