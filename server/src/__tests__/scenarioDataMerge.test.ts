import { describe, expect, it } from 'vitest';
import { mergeScenarioData, mergeStatsData } from '@policylab/shared/scenarioDataMerge';

describe('mergeScenarioData', () => {
  it('merges scenario telemetry into flat rows keyed by field and label', () => {
    const result = mergeScenarioData(
      [
        {
          label: 'Baseline',
          data: [
            { iterationNumber: 1, cpi: 100 },
            { iterationNumber: 2, cpi: 102 },
          ] as any[],
        },
        {
          label: 'Policy A',
          data: [
            { iterationNumber: 1, cpi: 100 },
            { iterationNumber: 2, cpi: 108 },
          ] as any[],
        },
      ],
      'cpi',
    );

    expect(result).toHaveLength(2);
    expect(result[0].iterationNumber).toBe(1);
    expect(result[0].cpi_Baseline).toBe(100);
    expect(result[1]['cpi_Policy A']).toBe(108);
  });

  it('preserves sparse iterations without fabricating values', () => {
    const result = mergeScenarioData(
      [
        { label: 'A', data: [{ iterationNumber: 1, cpi: 100 }] as any[] },
        { label: 'B', data: [{ iterationNumber: 2, cpi: 110 }] as any[] },
      ],
      'cpi',
    );

    expect(result).toHaveLength(2);
    expect(result[0].cpi_B).toBeUndefined();
    expect(result[1].cpi_A).toBeUndefined();
  });

  it('returns an empty array for empty input', () => {
    expect(mergeScenarioData([], 'cpi')).toEqual([]);
  });
});

describe('mergeStatsData', () => {
  it('merges iteration stats using the same flattened key pattern', () => {
    const result = mergeStatsData(
      [
        { label: 'Baseline', data: [{ iterationNumber: 1, avgWealth: 12 }] as any[] },
        { label: 'Policy A', data: [{ iterationNumber: 1, avgWealth: 18 }] as any[] },
      ],
      'avgWealth',
    );

    expect(result).toEqual([
      {
        iterationNumber: 1,
        avgWealth_Baseline: 12,
        'avgWealth_Policy A': 18,
      },
    ]);
  });
});
