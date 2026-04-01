import type { ComparisonResult } from '@policylab/shared';

export const compareApi = {
  async runComparison(id1: string, id2: string): Promise<ComparisonResult> {
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id1, id2 }),
    });
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error || 'Comparison failed');
    }
    const data = await res.json() as { comparison: ComparisonResult };
    return data.comparison;
  },

  async getHistory(): Promise<{ id: string, timestamp: string, comparison: ComparisonResult }[]> {
    const res = await fetch('/api/compare/history');
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error || 'Failed to fetch comparison history');
    }
    const data = await res.json() as { history: { id: string, timestamp: string, comparison: ComparisonResult }[] };
    return data.history;
  },

  async sendMessage(id1: string, id2: string, message: string): Promise<string> {
    const res = await fetch('/api/compare/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id1, id2, message }),
    });
    if (!res.ok) {
      const err = await res.json() as { error: string };
      throw new Error(err.error || 'Chat failed');
    }
    const data = await res.json() as { reply: string };
    return data.reply;
  },
};
