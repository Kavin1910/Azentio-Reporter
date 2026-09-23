/**
 * Auto-mapper: template fields → dataset columns.
 *
 * Produces proposals, not decisions. Every result below becomes a row in
 * `customisations`; only an exact-key match is confident enough to be written
 * as approved, and even that can be revoked. Anything fuzzy waits for a human.
 */

import { recipeFor, resolveDerivations, type DerivationRecipe } from './derive';
import type { ColumnType, DatasetColumn, TemplateField } from './types';

export interface MappingCandidate {
  column: string;
  confidence: number;
  reason: string;
}

export interface FieldMappingProposalOut {
  field: TemplateField;
  column: string;
  confidence: number;
  reason: string;
}

export interface AutoMapResult {
  mapped: FieldMappingProposalOut[];
  derived: Array<{ field: TemplateField; recipe: DerivationRecipe; inputs: string[] }>;
  unmapped: Array<{ field: TemplateField; candidates: MappingCandidate[] }>;
  /** Fields satisfied without a column at all — count aggregations. */
  implicit: TemplateField[];
}

/** Below this, a name match is a guess and goes to the queue as unmapped. */
export const MAP_ACCEPT = 60;
/** At or above this, the match is written as approved. Only an exact key reaches it. */
export const MAP_AUTO_APPROVE = 100;

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Column keys that hold a tally rather than a quantity of money. */
const COUNT_LIKE = /(^|_)(accounts?|count|number|no_of|nos?|qty|quantity|units?|cases?)(_|$)/i;

/** Words that add nothing to a match: "amount" appears in half the columns. */
const STOP = new Set(['amount', 'amt', 'no', 'number', 'id', 'date', 'dt', 'name', 'nm', 'of', 'the', 'on', 'in', 'at']);

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Name similarity over the INFORMATIVE tokens only.
 *
 * An earlier version scored all tokens and let "provision_amount" match
 * "sanctioned_amount" at 67% on the strength of a shared "amount". Stop words
 * now contribute a small tie-breaker at most; the decision rests on the words
 * that actually distinguish one column from another.
 */
function nameSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ta = tokens(a), tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  const ia = ta.filter((t) => !STOP.has(t));
  const ib = tb.filter((t) => !STOP.has(t));
  const sharedStop = ta.filter((t) => STOP.has(t) && tb.includes(t)).length;

  // Nothing informative on one side: only the weak, stop-word signal remains.
  if (ia.length === 0 || ib.length === 0) return Math.min(0.2, sharedStop * 0.05);

  const inter = ia.filter((t) => ib.includes(t)).length;
  const union = new Set([...ia, ...ib]).size;
  let score = inter / union;

  // Abbreviations and inflections: disb ↔ disbursed, disbursed ↔ disbursement.
  if (inter === 0) {
    const bestPrefix = Math.max(...ia.flatMap((x) => ib.map((y) => commonPrefixLength(x, y))));
    if (bestPrefix >= 5) score = Math.max(score, 0.5);
    else if (bestPrefix >= 4) score = Math.max(score, 0.35);
  }

  return Math.min(1, score + Math.min(0.1, sharedStop * 0.05));
}

function typeCompatibility(field: ColumnType, column: ColumnType): number {
  if (field === column) return 1;
  if ((field === 'currency' && column === 'number') || (field === 'number' && column === 'currency')) return 0.9;
  if (field === 'text') return 0.6;            // text can hold anything, weakly
  if (column === 'text') return 0.35;          // a text column can be re-typed, but it's a smell
  return 0.1;                                  // date ↔ number etc.
}

export function scoreCandidate(field: TemplateField, column: DatasetColumn): MappingCandidate {
  if (field.key === column.key) {
    return { column: column.key, confidence: 100, reason: 'Exact key match.' };
  }

  const name = Math.max(
    nameSimilarity(field.key, column.key),
    nameSimilarity(field.label, column.label) * 0.9,
    nameSimilarity(field.key, column.source_header ?? '') * 0.85,
  );
  const type = typeCompatibility(field.type, column.data_type);

  let confidence = Math.round(Math.min(99, (name * 0.7 + type * 0.3) * 100));

  // A name match must not outvote a hard type clash. "Disbursement Date" and
  // "Disbursement Amount" share a word, but a date field can never be served by
  // a currency column; cap it below the acceptance bar so it is offered as a
  // hint on an empty slot, not written as a proposal.
  if (type <= 0.1) confidence = Math.min(confidence, MAP_ACCEPT - 25);

  // A money field fed from a count column ("disbursement_accounts") is the same
  // mistake in a quieter form: both numeric, one is ₹, the other is a tally.
  if ((field.type === 'currency') && COUNT_LIKE.test(column.key) && !COUNT_LIKE.test(field.key)) {
    confidence = Math.min(confidence, MAP_ACCEPT - 15);
  }

  const reason =
    name >= 0.6
      ? `Name is similar ("${column.label}"), type ${type >= 0.9 ? 'matches' : 'differs'}.`
      : `Weak name match; ${type >= 0.9 ? 'types agree' : 'type differs'}.`;

  return { column: column.key, confidence, reason };
}

export function autoMap(fields: TemplateField[], columns: DatasetColumn[]): AutoMapResult {
  const result: AutoMapResult = { mapped: [], derived: [], unmapped: [], implicit: [] };
  const taken = new Set<string>();
  const columnKeys = columns.map((c) => c.key);

  // Exact matches first, so a fuzzy match on one field cannot steal the column
  // an exact match on another field needs.
  const ordered = [...fields].sort((a, b) => {
    const ea = columnKeys.includes(a.key) ? 0 : 1;
    const eb = columnKeys.includes(b.key) ? 0 : 1;
    return ea - eb;
  });

  for (const field of ordered) {
    if (field.aggregation === 'count' && !columnKeys.includes(field.key)) {
      result.implicit.push(field);
      continue;
    }

    const ranked = columns
      .filter((c) => !taken.has(c.key))
      .map((c) => scoreCandidate(field, c))
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0];

    if (best && best.confidence >= MAP_ACCEPT) {
      taken.add(best.column);
      result.mapped.push({ field, ...best });
      continue;
    }

    // Nothing close enough. Can it be computed?
    if (field.derivable || recipeFor(field.key)) {
      const { resolved } = resolveDerivations(columnKeys, [field.key]);
      const recipe = resolved.find((r) => r.field === field.key);
      if (recipe) {
        result.derived.push({ field, recipe, inputs: recipe.requires });
        continue;
      }
    }

    result.unmapped.push({ field, candidates: ranked.slice(0, 3).filter((c) => c.confidence >= 25) });
  }

  return result;
}
