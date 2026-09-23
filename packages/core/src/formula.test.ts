import { describe, it, expect } from 'vitest';
import { compileFormula, checkFormula, FormulaError } from './formula';
import { resolveDerivations, applyDerivations, recipeFor, RECIPES } from './derive';
import { calculateEMI } from './emi';

const run = (src: string, row: Record<string, unknown> = {}, now?: Date) =>
  compileFormula(src).run(row, now);

const NOW = new Date('2026-09-23T00:00:00Z');

describe('formula — arithmetic', () => {
  it('honours precedence and parentheses', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('-5 + 2')).toBe(-3);
  });

  it('reads column values from the row', () => {
    expect(run('sanctioned_amount - disbursed_amount',
      { sanctioned_amount: 2550000, disbursed_amount: 2360000 })).toBe(190000);
  });

  it('returns null rather than a wrong number when an input is missing', () => {
    // The point of deriving is that gaps stay visible, not that they become 0.
    expect(run('a + b', { a: 10, b: null })).toBeNull();
    expect(run('a + b', { a: 10 })).toBeNull();
  });

  it('returns null on division by zero instead of Infinity', () => {
    expect(run('a / b', { a: 10, b: 0 })).toBeNull();
  });
});

describe('formula — safety', () => {
  it('cannot reach host objects or run arbitrary code', () => {
    // These formulas are user-edited and stored; anything eval-shaped would be
    // remote code execution the moment a dataset is shared.
    expect(() => compileFormula('process.exit(1)')).toThrow(FormulaError);
    expect(() => compileFormula('constructor.constructor("return 1")()')).toThrow(FormulaError);
    expect(() => compileFormula('globalThis')).not.toThrow();       // parses as a column ref…
    expect(run('globalThis', {})).toBeNull();                        // …which simply is not there
  });

  it('rejects malformed input with a readable message', () => {
    expect(checkFormula('2 +')).toBeTruthy();
    expect(checkFormula('ROUND(')).toBeTruthy();
    expect(checkFormula('"unterminated')).toBeTruthy();
    expect(checkFormula('NOPE(1)')).toBeNull();      // parses; fails only when run
    expect(() => run('NOPE(1)')).toThrow(/Unknown function/);
  });

  it('accepts a well-formed formula', () => {
    expect(checkFormula('ROUND((a + b) / c * 100, 1)')).toBeNull();
  });
});

describe('formula — functions', () => {
  it('YEARS_BETWEEN computes a whole-year age', () => {
    expect(run('YEARS_BETWEEN(date_of_birth, TODAY)', { date_of_birth: '1994-05-16' }, NOW)).toBe(32);
    // The day before a birthday is still the previous age.
    expect(run('YEARS_BETWEEN(date_of_birth, TODAY)', { date_of_birth: '1994-09-24' }, NOW)).toBe(31);
  });

  it('DAYS_BETWEEN measures a gap in days', () => {
    expect(run('DAYS_BETWEEN(a, b)', { a: '2026-09-01', b: '2026-09-23' })).toBe(22);
  });

  it('BUCKET returns the first label the value does not exceed', () => {
    const f = "BUCKET(dpd, 0, 'Current', 30, '1-30', 60, '31-60', 90, '61-90', '90+')";
    expect(run(f, { dpd: 0 })).toBe('Current');
    expect(run(f, { dpd: 1 })).toBe('1-30');
    expect(run(f, { dpd: 30 })).toBe('1-30');
    expect(run(f, { dpd: 31 })).toBe('31-60');
    expect(run(f, { dpd: 400 })).toBe('90+');
    expect(run(f, { dpd: null })).toBeNull();
  });

  it('EMI matches the reducing-balance formula', () => {
    // ₹1,00,000 at 12% over 12 months is the textbook ₹8,884.88.
    expect(run('EMI(p, r, n)', { p: 100000, r: 12, n: 12 })).toBeCloseTo(8884.88, 2);
  });

  it('COALESCE supplies a default without masking a real zero', () => {
    expect(run('COALESCE(a, 0)', { a: null })).toBe(0);
    expect(run('COALESCE(a, 99)', { a: 0 })).toBe(0);
  });

  it('IF branches on a comparison', () => {
    expect(run("IF(dpd > 90, 'NPA', 'Standard')", { dpd: 120 })).toBe('NPA');
    expect(run("IF(dpd > 90, 'NPA', 'Standard')", { dpd: 12 })).toBe('Standard');
  });
});

describe('derivation recipes', () => {
  it('derives age from a date of birth', () => {
    const row = applyDerivations({ date_of_birth: '1994-05-16' }, [recipeFor('age')!], NOW);
    expect(row.age).toBe(32);
  });

  it('bands a thin credit file separately from a low score', () => {
    const band = recipeFor('score_band')!;
    expect(applyDerivations({ cibil_score: -1 }, [band]).score_band).toBe('No History');
    expect(applyDerivations({ cibil_score: 0 }, [band]).score_band).toBe('No History');
    expect(applyDerivations({ cibil_score: 540 }, [band]).score_band).toBe('Poor');
    expect(applyDerivations({ cibil_score: 800 }, [band]).score_band).toBe('Excellent');
  });

  it('resolves a chain: age_band needs age, which needs date_of_birth', () => {
    const { resolved, unresolved } = resolveDerivations(['date_of_birth'], ['age_band']);
    expect(unresolved).toHaveLength(0);
    // age must be computed before age_band reads it.
    expect(resolved.map((r) => r.field)).toEqual(['age', 'age_band']);

    const row = applyDerivations({ date_of_birth: '1994-05-16' }, resolved, NOW);
    expect(row.age).toBe(32);
    expect(row.age_band).toBe('26-35');
  });

  it('resolves foir through emi_amount', () => {
    const { resolved } = resolveDerivations(
      ['disbursed_amount', 'interest_rate', 'tenure_months', 'monthly_income'],
      ['foir'],
    );
    expect(resolved.map((r) => r.field)).toEqual(['emi_amount', 'foir']);

    const row = applyDerivations(
      { disbursed_amount: 1800000, interest_rate: 9, tenure_months: 240, monthly_income: 100000 },
      resolved,
    );
    expect(row.emi_amount).toBeCloseTo(16195.07, 1);
    expect(row.foir).toBeCloseTo(16.2, 1);
    // Cross-check against the standalone EMI implementation.
    expect(row.emi_amount).toBeCloseTo(calculateEMI(1800000, 9, 240), 2);
  });

  it('reports what is missing when a field cannot be derived', () => {
    const { resolved, unresolved } = resolveDerivations(['branch', 'product'], ['age', 'foir']);
    expect(resolved).toHaveLength(0);
    expect(unresolved.map((u) => u.field).sort()).toEqual(['age', 'foir']);
    expect(unresolved.find((u) => u.field === 'age')!.missing).toContain('date_of_birth');
  });

  it('does not re-derive a column the file already has', () => {
    const { resolved } = resolveDerivations(['age', 'date_of_birth'], ['age']);
    expect(resolved).toHaveLength(0);
  });

  it('treats a missing optional input as zero without inventing the required ones', () => {
    const foir = recipeFor('foir')!;
    const withoutExisting = applyDerivations(
      { emi_amount: 20000, monthly_income: 100000 }, [foir],
    );
    expect(withoutExisting.foir).toBe(20);

    const withoutIncome = applyDerivations({ emi_amount: 20000 }, [foir]);
    expect(withoutIncome.foir).toBeNull();
  });

  it('every recipe is a well-formed formula that reads only its declared inputs', () => {
    for (const r of RECIPES) {
      expect(checkFormula(r.formula), `${r.field}: ${r.formula}`).toBeNull();

      const declared = new Set([...r.requires, ...(r.optional ?? [])]);
      for (const input of compileFormula(r.formula).inputs) {
        expect(declared.has(input), `${r.field} reads undeclared "${input}"`).toBe(true);
      }
    }
  });

  it('every recipe carries a rationale the user can read before approving', () => {
    for (const r of RECIPES) {
      expect(r.rationale.length, r.field).toBeGreaterThan(30);
    }
  });
});
