import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { LocationProfile } from '@policylab/shared';

describe('locationCache', () => {
  let testCacheDir: string;
  let getCachedProfile: (countryCode: string) => Promise<LocationProfile | null>;
  let setCachedProfile: (countryCode: string, profile: LocationProfile) => Promise<void>;

  const mockProfile: LocationProfile = {
    locationName: 'Sao Paulo, Brazil',
    countryCode: 'BR',
    countryName: 'Brazil',
    coordinates: { lat: -23.55, lon: -46.63 },
    fetchedAt: new Date().toISOString(),
    demographics: {
      population: { value: 214000000, year: 2023, source: 'api', confidence: 'high' },
    },
    economics: {
      gdpPerCapita: { value: 8917, year: 2023, source: 'api', confidence: 'high' },
    },
    fiscal: {},
  };

  beforeEach(async () => {
    vi.useRealTimers();
    // Create a unique temp dir for each test
    testCacheDir = path.join(os.tmpdir(), `policylab-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testCacheDir, { recursive: true });

    // Dynamic import to get fresh module + override cache dir
    const mod = await import('../locationCache.js');
    getCachedProfile = mod.getCachedProfile;
    setCachedProfile = mod.setCachedProfile;

    // Override cache dir for testing
    mod._setCacheDirForTest(testCacheDir);
  });

  afterEach(async () => {
    // Clean up temp dir
    await fs.rm(testCacheDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns null for non-existent cache file', async () => {
    const result = await getCachedProfile('ZZ');
    expect(result).toBeNull();
  });

  it('round-trips a LocationProfile via set then get', async () => {
    await setCachedProfile('BR', mockProfile);
    const result = await getCachedProfile('BR');
    expect(result).not.toBeNull();
    expect(result!.countryCode).toBe('BR');
    expect(result!.locationName).toBe('Sao Paulo, Brazil');
    expect(result!.demographics.population?.value).toBe(214000000);
  });

  it('returns null for expired entries (>30 days old)', async () => {
    // Write a cache entry with an old fetchedAt
    const oldEntry = {
      fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      profile: mockProfile,
    };
    const filePath = path.join(testCacheDir, 'BR.json');
    await fs.writeFile(filePath, JSON.stringify(oldEntry, null, 2));

    const result = await getCachedProfile('BR');
    expect(result).toBeNull();
  });
});
