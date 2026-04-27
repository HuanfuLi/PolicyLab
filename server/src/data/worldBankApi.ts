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

/** Per-request timeout for World Bank API calls (8s). Without this, a slow or
 * unreachable WB API hangs the bootstrap UI on "Fetching demographics" forever
 * because there is no error path for upstream timeouts. On abort the catch
 * below returns null and the caller falls through to LLM-estimate path. */
const FETCH_TIMEOUT_MS = 8000;

/**
 * Fetch a single indicator value for a country (most recent value).
 *
 * @param countryCode - ISO 2-letter country code (e.g., 'US', 'BR')
 * @param indicatorCode - World Bank indicator code (e.g., 'SP.POP.TOTL')
 * @param dateRange - Optional date range (e.g., '2020:2024'). Uses mrv=1 by default.
 * @returns IndicatorResult or null if no data available, request times out, or upstream fails
 */
export async function fetchIndicator(
  countryCode: string,
  indicatorCode: string,
  dateRange?: string,
): Promise<IndicatorResult | null> {
  let url = `${BASE_URL}/country/${countryCode}/indicator/${indicatorCode}?format=json&per_page=10&mrv=1`;
  if (dateRange) {
    url += `&date=${dateRange}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[worldBankApi] HTTP ${res.status} for ${indicatorCode} (${countryCode})`);
      return null;
    }
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
    const isAbort = err instanceof Error && err.name === 'AbortError';
    console.warn(
      `[worldBankApi] ${isAbort ? `Timeout (${FETCH_TIMEOUT_MS}ms)` : 'Failed'} for ${indicatorCode} (${countryCode}):`,
      isAbort ? '' : err,
    );
    return null;
  } finally {
    clearTimeout(timeoutId);
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
  // World Bank API does NOT support semicolon-separated indicator codes.
  // Fetch in small concurrent batches of 5 to avoid rate limiting (429/504 errors).
  const BATCH_SIZE = 5;
  const allResults: IndicatorResult[] = [];

  for (let i = 0; i < indicatorCodes.length; i += BATCH_SIZE) {
    const chunk = indicatorCodes.slice(i, i + BATCH_SIZE);
    const promises = chunk.map(code => fetchIndicator(countryCode, code, dateRange));
    const results = await Promise.all(promises);
    allResults.push(...results.filter((r): r is IndicatorResult => r !== null));
  }

  return allResults;
}
