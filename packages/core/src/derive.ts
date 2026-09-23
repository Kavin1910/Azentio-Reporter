/**
 * Derived-field recipes.
 *
 * When a template asks for `age` and the file only has `date_of_birth`, the
 * mapper does not fail — it proposes a derivation. Each recipe names the columns
 * it needs, the formula that produces the value, and a plain-English reason that
 * appears in the Customisation Layer so the user knows what they are approving.
 *
 * Recipes may depend on other derived fields (foir needs emi_amount, which is
 * itself derived), so resolution is ordered by dependency.
 */

import { compileFormula, type FormulaValue } from './formula';
import type { ColumnType } from './types';

export interface DerivationRecipe {
  field: string;
  label: string;
  formula: string;
  /** Columns that must exist — either in the file or as an earlier derivation. */
  requires: string[];
  /** Columns used when present but not required. */
  optional?: string[];
  resultType: ColumnType;
  rationale: string;
}

export const RECIPES: DerivationRecipe[] = [
  {
    field: 'age',
    label: 'Age',
    formula: 'YEARS_BETWEEN(date_of_birth, TODAY)',
    requires: ['date_of_birth'],
    resultType: 'number',
    rationale:
      'The file has a date of birth but no age. Age is computed from it at report time, so it stays correct as the data ages.',
  },
  {
    field: 'age_band',
    label: 'Age Band',
    formula: "BUCKET(age, 25, '18-25', 35, '26-35', 45, '36-45', 60, '46-60', '60+')",
    requires: ['age'],
    resultType: 'text',
    rationale: 'Groups age into the bands used for demographic reporting.',
  },
  {
    field: 'dpd_bucket',
    label: 'Aging Bucket',
    formula: "BUCKET(dpd, 0, 'Current', 30, '1-30', 60, '31-60', 90, '61-90', '90+')",
    requires: ['dpd'],
    resultType: 'text',
    rationale:
      'Standard delinquency aging buckets derived from days past due. Zero DPD is reported as Current rather than as a 1-30 bucket.',
  },
  {
    field: 'score_band',
    label: 'Score Band',
    formula:
      "BUCKET(cibil_score, 0, 'No History', 549, 'Poor', 649, 'Fair', 749, 'Good', 'Excellent')",
    requires: ['cibil_score'],
    resultType: 'text',
    rationale:
      'CIBIL bands. Scores of 0 or below are the bureau\'s no-history marker and are banded separately — a thin file is not a low score.',
  },
  {
    field: 'asset_classification',
    label: 'Asset Classification',
    formula: "BUCKET(dpd, 90, 'Standard', 180, 'Sub-Standard', 365, 'Doubtful', 'Loss')",
    requires: ['dpd'],
    resultType: 'text',
    rationale:
      'RBI-style classification from days past due: Standard up to 90 days, then Sub-Standard, Doubtful and Loss.',
  },
  {
    field: 'emi_amount',
    label: 'EMI',
    formula: 'EMI(disbursed_amount, interest_rate, tenure_months)',
    requires: ['disbursed_amount', 'interest_rate', 'tenure_months'],
    resultType: 'currency',
    rationale:
      'No EMI column in the file, so it is computed on a reducing balance from the disbursed amount, rate and tenure.',
  },
  {
    field: 'foir',
    label: 'FOIR %',
    formula: 'ROUND((COALESCE(existing_emi, 0) + emi_amount) / monthly_income * 100, 1)',
    requires: ['monthly_income', 'emi_amount'],
    optional: ['existing_emi'],
    resultType: 'number',
    rationale:
      'Fixed Obligation to Income Ratio: existing obligations plus this EMI, over net monthly income. Existing EMI is treated as zero when absent.',
  },
  {
    field: 'collection_efficiency',
    label: 'Efficiency %',
    formula: 'ROUND(amount_paid / emi_amount * 100, 1)',
    requires: ['amount_paid', 'emi_amount'],
    resultType: 'number',
    rationale: 'Collected against demand, per account.',
  },
  {
    field: 'variance_amount',
    label: 'Variance',
    formula: 'sanctioned_amount - disbursed_amount',
    requires: ['sanctioned_amount', 'disbursed_amount'],
    resultType: 'currency',
    rationale: 'Sanctioned value that did not convert into disbursement.',
  },
  {
    field: 'variance_pct',
    label: 'Variance %',
    formula: 'ROUND((sanctioned_amount - disbursed_amount) / sanctioned_amount * 100, 2)',
    requires: ['sanctioned_amount', 'disbursed_amount'],
    resultType: 'number',
    rationale: 'Shortfall as a share of the sanctioned amount.',
  },
  {
    field: 'provision_amount',
    label: 'Provision',
    formula:
      "ROUND(outstanding_amount * IF(dpd > 365, 1, IF(dpd > 180, 0.4, IF(dpd > 90, 0.15, 0.004))), 0)",
    requires: ['outstanding_amount', 'dpd'],
    resultType: 'currency',
    rationale:
      'Indicative provisioning at 0.4% Standard, 15% Sub-Standard, 40% Doubtful and 100% Loss. Rates are illustrative — confirm against your own policy before relying on the figure.',
  },
];

const BY_FIELD = new Map(RECIPES.map((r) => [r.field, r]));

export function recipeFor(field: string): DerivationRecipe | undefined {
  return BY_FIELD.get(field);
}

/**
 * Works out which of the wanted fields can be derived from the columns present,
 * and returns them in dependency order so each runs after its inputs exist.
 *
 * Resolution is iterative rather than a topological sort: recipes are few, and
 * a fixed point is reached in at most RECIPES.length passes.
 */
export function resolveDerivations(
  availableColumns: string[],
  wantedFields: string[],
): { resolved: DerivationRecipe[]; unresolved: Array<{ field: string; missing: string[] }> } {
  const have = new Set(availableColumns);
  const resolved: DerivationRecipe[] = [];
  const wanted = new Set(wantedFields.filter((f) => !have.has(f)));
  // Prerequisites get pulled into `wanted` during resolution. Remember what was
  // actually asked for, so a failure reports "foir could not be derived" rather
  // than also listing emi_amount, which the user never mentioned.
  const requested = new Set(wanted);

  let progress = true;
  while (progress) {
    progress = false;

    for (const field of [...wanted]) {
      const recipe = BY_FIELD.get(field);
      if (!recipe) continue;

      const missing = recipe.requires.filter((r) => !have.has(r));

      // A prerequisite may itself be derivable — pull it in first.
      if (missing.length > 0) {
        const derivableMissing = missing.filter((m) => BY_FIELD.has(m) && !wanted.has(m));
        if (derivableMissing.length > 0) {
          derivableMissing.forEach((m) => wanted.add(m));
          progress = true;
        }
        continue;
      }

      resolved.push(recipe);
      have.add(field);
      wanted.delete(field);
      progress = true;
    }
  }

  const unresolved = [...wanted]
    .filter((field) => requested.has(field))
    .map((field) => {
      const recipe = BY_FIELD.get(field);
      return {
        field,
        missing: recipe ? recipe.requires.filter((r) => !have.has(r)) : [],
      };
    });

  return { resolved, unresolved };
}

/** Applies recipes to a row, in order, so later ones can read earlier results. */
export function applyDerivations(
  row: Record<string, unknown>,
  recipes: DerivationRecipe[],
  now = new Date(),
): Record<string, unknown> {
  const out = { ...row };
  for (const recipe of recipes) {
    try {
      const value: FormulaValue = compileFormula(recipe.formula).run(out, now);
      out[recipe.field] = value;
    } catch {
      // A broken formula must not take the whole report with it; the field is
      // simply absent and shows as a gap.
      out[recipe.field] = null;
    }
  }
  return out;
}

/** Compiles once and reuses — applyDerivations per row would recompile per row. */
export function compileDerivations(recipes: DerivationRecipe[]) {
  const compiled = recipes.map((r) => ({ field: r.field, fn: compileFormula(r.formula) }));
  return (row: Record<string, unknown>, now = new Date()) => {
    const out = { ...row };
    for (const { field, fn } of compiled) {
      try { out[field] = fn.run(out, now); } catch { out[field] = null; }
    }
    return out;
  };
}
