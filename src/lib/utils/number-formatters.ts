/**
 * Currency display formatting via Intl.NumberFormat.
 *
 * Provides full-precision and compact formatters for currency values.
 * Formatters are lazy-created and invalidated on setCurrencyConfig().
 */

import type { CountryConfig } from '@/lib/country/types';

let currencyConfig: CountryConfig['currency'] = { code: 'USD', locale: 'en-US', symbol: '$' };
let _formatter: Intl.NumberFormat | null = null;
let _formatterWithCents: Intl.NumberFormat | null = null;

export function setCurrencyConfig(config: CountryConfig['currency']): void {
  currencyConfig = config;
  _formatter = null;
  _formatterWithCents = null;
  percentageFormatters.clear();
}

function getFormatter(): Intl.NumberFormat {
  if (!_formatter) {
    _formatter = new Intl.NumberFormat(currencyConfig.locale, {
      style: 'currency',
      currency: currencyConfig.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
  return _formatter;
}

function getFormatterWithCents(): Intl.NumberFormat {
  if (!_formatterWithCents) {
    _formatterWithCents = new Intl.NumberFormat(currencyConfig.locale, {
      style: 'currency',
      currency: currencyConfig.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return _formatterWithCents;
}

export function formatCurrency(amount: number, options?: { cents?: boolean }): string {
  if (options?.cents) {
    return getFormatterWithCents().format(amount);
  }
  return getFormatter().format(amount);
}

export function formatCompactCurrency(amount: number, fractionDigits: number = 2): string {
  const absNum = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  const symbol = currencyConfig.symbol;

  if (absNum >= 1000000000) return sign + symbol + (absNum / 1000000000).toFixed(2) + 'B';
  if (absNum >= 1000000) return sign + symbol + (absNum / 1000000).toFixed(2) + 'M';
  if (absNum >= 1000) return sign + symbol + (absNum / 1000).toFixed(1) + 'k';

  return sign + symbol + absNum.toFixed(fractionDigits);
}

export function getCurrencySymbol(): string {
  return currencyConfig.symbol;
}

export function formatCurrencyPlaceholder(amount: number): string {
  return getFormatter().format(amount);
}

const percentageFormatters = new Map<number, Intl.NumberFormat>();

function getPercentageFormatter(fractionDigits: number): Intl.NumberFormat {
  let formatter = percentageFormatters.get(fractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(currencyConfig.locale, {
      style: 'percent',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    percentageFormatters.set(fractionDigits, formatter);
  }
  return formatter;
}

export function formatPercentage(value: number, fractionDigits: number = 1): string {
  return getPercentageFormatter(fractionDigits).format(value);
}
