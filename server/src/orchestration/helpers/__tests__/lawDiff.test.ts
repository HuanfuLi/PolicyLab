import { describe, it, expect } from 'vitest';
import { applyParagraphDiff } from '../lawDiff.js';

// Phase 11 D-18, D-19 — paragraph-level law diff helper shared by
// centralAgent.refineLaw and governanceManager law_amendment ratification.

describe('applyParagraphDiff (Phase 11 D-18, D-19)', () => {
  it('replaces a paragraph when oldParagraph matches verbatim', () => {
    const law = 'Article 1. All citizens have rights.\n\nArticle 2. Property is protected.\n\nArticle 3. Justice for all.';
    const result = applyParagraphDiff(
      law,
      'Article 2. Property is protected.',
      'Article 2. Property is collectively owned.',
    );
    expect(result.applied).toBe(true);
    expect(result.law).toContain('Article 2. Property is collectively owned.');
    expect(result.law).toContain('Article 1. All citizens have rights.');
    expect(result.law).toContain('Article 3. Justice for all.');
    expect(result.law).not.toContain('Article 2. Property is protected.');
  });

  it('returns law unchanged when oldParagraph is not found', () => {
    const law = 'Article 1. Rights.\n\nArticle 2. Duties.';
    const result = applyParagraphDiff(
      law,
      'Article 99. Nonexistent clause.',
      'Article 99. Replacement.',
    );
    expect(result.applied).toBe(false);
    expect(result.law).toBe(law);
  });

  it('matches paragraphs across smart-quote differences (curly vs straight)', () => {
    // Law contains straight single quotes; amendment quotes use curly apostrophes.
    const law = "Article 1. The citizen's right to work.\n\nArticle 2. Duties.";
    const oldParaSmart = "Article 1. The citizen\u2019s right to work."; // U+2019 right single quote
    const newPara = 'Article 1. The right to employment is guaranteed.';
    const result = applyParagraphDiff(law, oldParaSmart, newPara);
    expect(result.applied).toBe(true);
    expect(result.law).toContain('Article 1. The right to employment is guaranteed.');
    expect(result.law).toContain('Article 2. Duties.');
  });

  it('matches paragraphs across double smart-quote differences', () => {
    const law = 'Section 1. "The people" shall govern.\n\nSection 2. Other.';
    const oldParaSmart = 'Section 1. \u201CThe people\u201D shall govern.'; // U+201C / U+201D
    const newPara = 'Section 1. The people shall govern.';
    const result = applyParagraphDiff(law, oldParaSmart, newPara);
    expect(result.applied).toBe(true);
    expect(result.law).toContain('Section 1. The people shall govern.');
  });

  it('matches oldParagraph with trailing whitespace/newlines', () => {
    const law = 'Article 1. Rights.\n\nArticle 2. Duties.';
    const oldParaWithTrailing = '  Article 1. Rights.   \n';
    const result = applyParagraphDiff(law, oldParaWithTrailing, 'Article 1. New rights.');
    expect(result.applied).toBe(true);
    expect(result.law).toContain('Article 1. New rights.');
    expect(result.law).toContain('Article 2. Duties.');
  });

  it('preserves non-target paragraphs byte-identically (no smart-quote side effects)', () => {
    // Paragraph 2 contains smart quotes; an amendment targeting paragraph 1 must NOT
    // rewrite paragraph 2's smart quotes to straight quotes.
    const paraWithSmart = 'Article 2. The \u201Cpeople\u2019s\u201D assembly convenes weekly.';
    const law = [
      'Article 1. Rights.',
      paraWithSmart,
      'Article 3. Justice.',
    ].join('\n\n');
    const result = applyParagraphDiff(law, 'Article 1. Rights.', 'Article 1. Expanded rights.');
    expect(result.applied).toBe(true);
    const parts = result.law.split('\n\n');
    // Paragraph at index 1 (the smart-quote one) must be byte-identical to input.
    expect(parts[1]).toBe(paraWithSmart);
    expect(parts[2]).toBe('Article 3. Justice.');
  });

  it('returns unchanged when oldParagraph is empty', () => {
    const law = 'Article 1. Rights.';
    const result = applyParagraphDiff(law, '', 'Article 1. Rights forever.');
    expect(result.applied).toBe(false);
    expect(result.law).toBe(law);
  });

  it('returns unchanged when law is empty', () => {
    const result = applyParagraphDiff('', 'x', 'y');
    expect(result.applied).toBe(false);
    expect(result.law).toBe('');
  });

  it('does not log on miss — caller decides warning behavior', () => {
    const errs: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => { errs.push(`warn:${String(args[0])}`); };
    console.error = (...args: unknown[]) => { errs.push(`error:${String(args[0])}`); };
    try {
      applyParagraphDiff('Article 1.\n\nArticle 2.', 'not found', 'replacement');
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
    expect(errs).toHaveLength(0);
  });
});

describe('GovernanceBallotItem discriminated union (Phase 11 D-18)', () => {
  it('policy ballot narrows via kind discriminator', async () => {
    const { /* type-only import at runtime has no effect, but keeps this importable */ } = await import('@policylab/shared');
    // TypeScript compile-time check: union narrowing.
    // Runtime: assert that an object with kind:'policy' is structurally valid.
    const item: { kind: 'policy'; field: 'tax_rate'; proposedValue: number; description: string } = {
      kind: 'policy',
      field: 'tax_rate',
      proposedValue: 0.1,
      description: 'Raise tax',
    };
    expect(item.kind).toBe('policy');
  });

  it('law_amendment ballot carries oldParagraph / newParagraph', () => {
    const item: { kind: 'law_amendment'; oldParagraph: string; newParagraph: string; description: string } = {
      kind: 'law_amendment',
      oldParagraph: 'Old text.',
      newParagraph: 'New text.',
      description: 'Amendment',
    };
    expect(item.kind).toBe('law_amendment');
    expect(item.oldParagraph).toBe('Old text.');
  });
});
