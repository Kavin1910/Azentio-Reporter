/**
 * EMI and affordability maths.
 *
 * FOIR (Fixed Obligation to Income Ratio) is the ratio Indian lenders actually
 * underwrite against: all fixed monthly obligations, including the proposed EMI,
 * over net monthly income. Most retail policies cap it between 50% and 60%.
 */

export const FOIR_POLICY_CAP = 50;

/**
 * Standard reducing-balance EMI.
 *   EMI = P · r · (1+r)^n / ((1+r)^n − 1)
 * where r is the monthly rate and n the tenure in months.
 */
export function calculateEMI(
  principal: number,
  annualRatePercent: number,
  tenureMonths: number,
): number {
  if (principal <= 0 || tenureMonths <= 0) return 0;

  const r = annualRatePercent / 12 / 100;
  // A zero-interest product would divide by zero in the formula below.
  if (r === 0) return principal / tenureMonths;

  const growth = Math.pow(1 + r, tenureMonths);
  return (principal * r * growth) / (growth - 1);
}

/** All fixed obligations including the proposed EMI, as a % of net income. */
export function calculateFOIR(
  monthlyIncome: number,
  existingEMI: number,
  proposedEMI: number,
): number {
  if (monthlyIncome <= 0) return 100;
  return ((existingEMI + proposedEMI) / monthlyIncome) * 100;
}

/** Headroom left under the policy cap, after existing obligations. */
export function maxEligibleEMI(
  monthlyIncome: number,
  existingEMI: number,
  foirCap: number = FOIR_POLICY_CAP,
): number {
  return Math.max(0, (monthlyIncome * foirCap) / 100 - existingEMI);
}

/** Largest principal that keeps FOIR within the cap, at the given rate/tenure. */
export function maxEligiblePrincipal(
  monthlyIncome: number,
  existingEMI: number,
  annualRatePercent: number,
  tenureMonths: number,
  foirCap: number = FOIR_POLICY_CAP,
): number {
  const emiHeadroom = maxEligibleEMI(monthlyIncome, existingEMI, foirCap);
  if (emiHeadroom <= 0 || tenureMonths <= 0) return 0;

  const r = annualRatePercent / 12 / 100;
  if (r === 0) return emiHeadroom * tenureMonths;

  const growth = Math.pow(1 + r, tenureMonths);
  return (emiHeadroom * (growth - 1)) / (r * growth);
}

export function totalInterest(
  principal: number,
  annualRatePercent: number,
  tenureMonths: number,
): number {
  return calculateEMI(principal, annualRatePercent, tenureMonths) * tenureMonths - principal;
}
