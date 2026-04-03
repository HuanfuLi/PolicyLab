/**
 * World Bank Open Data API v2 client.
 *
 * Fetches indicator data for a given country code. Handles the v2 response
 * format ([metadata, data[]]) including null data arrays for invalid queries.
 *
 * All indicator codes should come from indicatorMap.ts — never hardcode inline.
 */

import type { ConfidenceLevel } from '@policylab/shared';

const BASE_URL = 'https://api.worldbank.org/v2';

export interface IndicatorResult {
  indicatorCode: string;
  value: number;
  year: number;
  confidence: ConfidenceLevel;
}

/**
 * Determine confidence level based on how old the data is relative to current year.
 * - Same year or 1 year old: 'high'
 * - 2-3 years old: 'medium'
 * - 4+ years old: 'low'
 */
function assessConfidence(dataYear: number): ConfidenceLevel {
  const currentYear = new Date().getFullYear();
  const age = currentYear - dataYear;
  if (age <= 1) return 'high';
  if (age <= 3) return 'medium';
  return 'low';
}

/**
 * Fetch a single indicator value for a country (most recent value).
 *
 * @param countryCode - ISO 2-letter country code (e.g., 'US', 'BR')
 * @param indicatorCode - World Bank indicator code (e.g., 'SP.POP.TOTL')
 * @param dateRange - Optional date range (e.g., '2020:2024'). Uses mrv=1 by default.
 * @returns IndicatorResult or null if no data available
 */
export async function fetchIndicator(
  countryCode: string,
  indicatorCode: string,
  dateRange?: string,
): Promise<IndicatorResult | null> {
  try {
    let url = `${BASE_URL}/country/${countryCode}/indicator/${indicatorCode}?format=json&per_page=10&mrv=1`;
    if (dateRange) {
      url += `&date=${dateRange}`;
    }

    const res = await fetch(url);
    const json = await res.json();

    // World Bank API v2 returns [metadata, data[]] tuple
    const data = json[1];
    if (!data || data.length === 0 || data[0].value === null) {
      return null;
    }

    const entry = data[0];
    return {
      indicatorCode,
      value: entry.value,
      year: parseInt(entry.date, 10),
      confidence: assessConfidence(parseInt(entry.date, 10)),
    };
  } catch (err) {
    console.warn(`[worldBankApi] Failed to fetch ${indicatorCode} for ${countryCode}:`, err);
    return null;
  }
}

/**
 * Fetch multiple indicators in a single API call using semicolon-separated codes.
 *
 * The World Bank API supports querying multiple indicators by joining codes with
 * semicolons. This reduces round-trips for bulk data fetching.
 *
 * @param countryCode - ISO 2-letter country code
 * @param indicatorCodes - Array of indicator codes to fetch
 * @param dateRange - Optional date range
 * @returns Array of IndicatorResult for indicators that returned valid data
 */
export async function fetchIndicatorBatch(
  countryCode: string,
  indicatorCodes: string[],
  dateRange?: string,
): Promise<IndicatorResult[]> {
  try {
    const joined = indicatorCodes.join(';');
    let url = `${BASE_URL}/country/${countryCode}/indicator/${joined}?format=json&per_page=500&mrv=1`;
    if (dateRange) {
      url += `&date=${dateRange}`;
    }

    const res = await fetch(url);
    const json = await res.json();

    const data = json[1];
    if (!data || !Array.isArray(data)) {
      return [];
    }

    const results: IndicatorResult[] = [];
    for (const entry of data) {
      if (entry.value === null || entry.value === undefined) continue;
      results.push({
        indicatorCode: entry.indicator.id,
        value: entry.value,
        year: parseInt(entry.date, 10),
        confidence: assessConfidence(parseInt(entry.date, 10)),
      });
    }

    return results;
  } catch (err) {
    console.warn(`[worldBankApi] Failed to fetch batch for ${countryCode}:`, err);
    return [];
  }
}
