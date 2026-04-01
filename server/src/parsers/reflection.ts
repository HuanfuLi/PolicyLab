/**
 * C6: Reflection parsers (spec §6, Phase 4).
 *
 * Parses LLM responses for agent reflections and society evaluation.
 * Uses the same 4-strategy JSON extraction as simulation parsers.
 */
import { parseJSON } from './json.js';

export function parseAgentReflection(text: string): { pass1: string } {
  const parsed = parseJSON(text) as Record<string, unknown>;
  return {
    pass1: String(parsed?.pass1 ?? text.trim()),
  };
}

export function parseAgentReflection2(text: string): { pass2: string } {
  const parsed = parseJSON(text) as Record<string, unknown>;
  return {
    pass2: String(parsed?.pass2 ?? text.trim()),
  };
}

export interface ParsedEvaluation {
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  analysis: string;
}

export function parseSocietyEvaluation(text: string): ParsedEvaluation {
  const parsed = parseJSON(text) as Record<string, unknown>;

  const toStrArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String);
    return [];
  };

  return {
    verdict: String(parsed?.verdict ?? ''),
    strengths: toStrArray(parsed?.strengths),
    weaknesses: toStrArray(parsed?.weaknesses),
    analysis: String(parsed?.analysis ?? ''),
  };
}
