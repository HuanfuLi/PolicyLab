/**
 * Apply a paragraph-level diff to a law text body.
 * Phase 11 D-18, D-19.
 *
 * Splits law by \n\n paragraph boundaries. Normalizes each paragraph
 * FOR COMPARISON ONLY (smart quotes, trimmed whitespace) so LLM-emitted
 * oldParagraph with cosmetic differences still match. Replaces only the
 * matched paragraph in its original position with newParagraph verbatim.
 * All non-matched paragraphs are preserved byte-for-byte (no global
 * normalization side-effect — D-19 "paragraph-level text replacement only").
 *
 * Match order:
 *   1. Exact (normalized) paragraph equality — replaces the whole paragraph.
 *   2. Substring fallback — if oldParagraph spans a section of a single
 *      paragraph (e.g. the LLM quoted a sub-clause), splice the equivalent
 *      region in the ORIGINAL paragraph, preserving surrounding text.
 *
 * Returns applied=true on first match; applied=false if no paragraph matches.
 * Silently returns on no-match — caller decides whether to log.
 */
export function applyParagraphDiff(
  law: string,
  oldParagraph: string,
  newParagraph: string,
): { law: string; applied: boolean } {
  if (!law || !oldParagraph) return { law, applied: false };

  const normalize = (s: string): string =>
    s
      .trim()
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');

  const normalizedOld = normalize(oldParagraph);
  if (!normalizedOld) return { law, applied: false };

  // Split on paragraph boundary (blank line); preserves original spacing inside each paragraph.
  const paragraphs = law.split(/\n\n/);

  // ── Pass 1: exact (normalized) paragraph equality ────────────────────────
  for (let i = 0; i < paragraphs.length; i++) {
    if (normalize(paragraphs[i]) === normalizedOld) {
      paragraphs[i] = newParagraph;
      return { law: paragraphs.join('\n\n'), applied: true };
    }
  }

  // ── Pass 2: substring fallback within a single paragraph ─────────────────
  // If the LLM quoted a sub-clause, splice that region in the ORIGINAL
  // paragraph (NOT the normalized one) so surrounding characters — including
  // any smart quotes outside the matched region — are preserved.
  for (let i = 0; i < paragraphs.length; i++) {
    const normPara = normalize(paragraphs[i]);
    const idx = normPara.indexOf(normalizedOld);
    if (idx === -1) continue;

    // Map normalized index → original index. Normalization does two things:
    //   (a) trims leading/trailing whitespace,
    //   (b) replaces smart quotes with straight quotes (1:1 char swap).
    // Therefore the offset within the ORIGINAL paragraph = leadingTrim + idx,
    // and the matched region in the original has length = normalizedOld.length.
    const leadingTrim = paragraphs[i].length - paragraphs[i].trimStart().length;
    const originalStart = leadingTrim + idx;
    const originalSlice = paragraphs[i].substring(
      originalStart,
      originalStart + normalizedOld.length,
    );
    if (normalize(originalSlice) === normalizedOld) {
      paragraphs[i] =
        paragraphs[i].substring(0, originalStart) +
        newParagraph +
        paragraphs[i].substring(originalStart + originalSlice.length);
      return { law: paragraphs.join('\n\n'), applied: true };
    }
  }

  return { law, applied: false };
}
