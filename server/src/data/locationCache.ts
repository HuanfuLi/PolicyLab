/**
 * File-based location data cache with 30-day TTL.
 *
 * Caches LocationProfile data per country code to avoid redundant API calls,
 * and LLM-generated governance/infrastructure descriptions to avoid redundant
 * LLM calls on retries of the same location.
 *
 * Cache files are stored as JSON in ~/.policylab/cache/:
 *   {CC}.json          — World Bank indicators + assembled LocationProfile
 *   {CC}_llm.json      — LLM-generated governance + infrastructure descriptions
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { LocationProfile } from '@policylab/shared';

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.policylab', 'cache');

/** 30-day TTL in milliseconds */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  fetchedAt: string;
  profile: LocationProfile;
}

interface LLMCacheEntry {
  fetchedAt: string;
  governance: { value: string; source: string; confidence: string } | null;
  infrastructure: { value: string; source: string; confidence: string } | null;
}

/** Current cache directory — overridable for testing */
let cacheDir = DEFAULT_CACHE_DIR;

/**
 * Override the cache directory. For testing only.
 * @internal
 */
export function _setCacheDirForTest(dir: string): void {
  cacheDir = dir;
}

// ── LocationProfile cache (World Bank indicators) ───────────────────────────

/**
 * Retrieve a cached LocationProfile for a country code.
 * Returns null if expired (>30 days) or missing.
 */
export async function getCachedProfile(countryCode: string): Promise<LocationProfile | null> {
  const file = path.join(cacheDir, `${countryCode.toUpperCase()}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > TTL_MS) return null;
    return entry.profile;
  } catch {
    return null;
  }
}

/**
 * Store a LocationProfile in the cache for a country code.
 */
export async function setCachedProfile(countryCode: string, profile: LocationProfile): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${countryCode.toUpperCase()}.json`);
  const entry: CacheEntry = { fetchedAt: new Date().toISOString(), profile };
  await fs.writeFile(file, JSON.stringify(entry, null, 2));
}

// ── LLM cache (governance + infrastructure descriptions) ────────────────────

/**
 * Retrieve cached LLM-generated governance and infrastructure descriptions.
 * Returns null if expired (>30 days) or missing.
 */
export async function getCachedLLMData(countryCode: string): Promise<LLMCacheEntry | null> {
  const file = path.join(cacheDir, `${countryCode.toUpperCase()}_llm.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const entry: LLMCacheEntry = JSON.parse(raw);
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Cache LLM-generated governance and infrastructure descriptions.
 */
export async function setCachedLLMData(
  countryCode: string,
  governance: LLMCacheEntry['governance'],
  infrastructure: LLMCacheEntry['infrastructure'],
): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${countryCode.toUpperCase()}_llm.json`);
  const entry: LLMCacheEntry = { fetchedAt: new Date().toISOString(), governance, infrastructure };
  await fs.writeFile(file, JSON.stringify(entry, null, 2));
}

// ── Cache management ────────────────────────────────────────────────────────

/**
 * Clear all cached data (WB profiles + LLM descriptions).
 * Returns the number of files deleted.
 */
export async function clearCache(): Promise<number> {
  try {
    const files = await fs.readdir(cacheDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    await Promise.all(jsonFiles.map(f => fs.unlink(path.join(cacheDir, f))));
    return jsonFiles.length;
  } catch {
    return 0;
  }
}

/**
 * Get cache statistics: file count, total size, oldest entry.
 */
export async function getCacheStats(): Promise<{ fileCount: number; totalSizeKB: number; countries: string[] }> {
  try {
    const files = await fs.readdir(cacheDir);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('_llm.json'));
    let totalSize = 0;
    for (const f of files.filter(f => f.endsWith('.json'))) {
      const stat = await fs.stat(path.join(cacheDir, f));
      totalSize += stat.size;
    }
    return {
      fileCount: files.filter(f => f.endsWith('.json')).length,
      totalSizeKB: Math.round(totalSize / 1024),
      countries: jsonFiles.map(f => f.replace('.json', '')),
    };
  } catch {
    return { fileCount: 0, totalSizeKB: 0, countries: [] };
  }
}
