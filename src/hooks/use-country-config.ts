import { useEffect, useMemo } from 'react';

import { getCountryConfig } from '@/lib/country';
import type { CountryConfig } from '@/lib/country/types';
import { setCurrencyConfig } from '@/lib/utils/number-formatters';
import { usePlanData } from './use-convex-data';

export function useCountryConfig(): CountryConfig {
  const { data } = usePlanData();
  const countryConfig = useMemo(() => getCountryConfig(data?.country), [data?.country]);

  useEffect(() => {
    setCurrencyConfig(countryConfig.currency);
  }, [countryConfig]);

  return countryConfig;
}
