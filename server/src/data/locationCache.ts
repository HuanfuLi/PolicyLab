/**
 * File-based location data cache with 30-day TTL.
 *
 * Caches LocationProfile data per country code to avoid redundant API calls.
 * Cache files are stored as JSON in ~/.policylab/cache/{CC}.json.
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

/** Current cache directory — overridable for testing */
let cacheDir = DEFAULT_CACHE_DIR;

/**
 * Override the cache directory. For testing only.
 * @internal
 */
export function _setCacheDirForTest(dir: string): void {
  cacheDir = dir;
}

/**
 * Retrieve a cached LocationProfile for a country code.
 *
 * Returns null if the cache file doesn't exist, is corrupted, or has expired
 * (older than 30 days).
 *
 * @param countryCode - ISO 2-letter country code (case-insensitive)
 * @returns Cached LocationProfile or null
 */
export async function getCachedProfile(countryCode: string): Promise<LocationProfile | null> {
  const file = path.join(cacheDir, `${countryCode.toUpperCase()}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const entry: CacheEntry = JSON.parse(raw);
    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    if (age > TTL_MS) return null; // expired
    return entry.profile;
  } catch {
    return null;
  }
}

/**
 * Store a LocationProfile in the cache for a country code.
 *
 * Creates the cache directory if it doesn't exist.
 *
 * @param countryCode - ISO 2-letter country code (case-insensitive)
 * @param profile - LocationProfile to cache
 */
export async function setCachedProfile(countryCode: string, profile: LocationProfile): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${countryCode.toUpperCase()}.json`);
  const entry: CacheEntry = { fetchedAt: new Date().toISOString(), profile };
  await fs.writeFile(file, JSON.stringify(entry, null, 2));
}
