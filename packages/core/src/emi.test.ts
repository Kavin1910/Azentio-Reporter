import { describe, it, expect } from 'vitest';
import {
  calculateEMI, calculateFOIR, maxEligibleEMI, maxEligiblePrincipal, totalInterest,
} from './emi';

describe('calculateEMI', () => {
  it('matches the standard reducing-balance result', () => {
    // ₹1,00,000 at 12% for 12 months is a textbook case: EMI ₹8,884.88.
    expect(calculateEMI(100000, 12, 12)).toBeCloseTo(8884.88, 2);
  });

  it('falls back to straight division at zero interest', () => {
    // The closed form divides by zero when r === 0.
    expect(calculateEMI(120000, 0, 12)).toBe(10000);
  });

  it('returns zero for degenerate inputs', () => {
    expect(calculateEMI(0, 9, 240)).toBe(0);
    expect(calculateEMI(100000, 9, 0)).toBe(0);
  });

  it('lowers the EMI as tenure lengthens', () => {
    const short = calculateEMI(1800000, 9.05, 120);
    const long = calculateEMI(1800000, 9.05, 240);
    expect(long).toBeLessThan(short);
  });
});

describe('calculateFOIR', () => {
  it('counts existing and proposed obligations together', () => {
    expect(calculateFOIR(100000, 10000, 30000)).toBe(40);
  });

  it('treats zero income as fully committed rather than dividing by zero', () => {
    expect(calculateFOIR(0, 0, 5000)).toBe(100);
  });
});

describe('maxEligibleEMI', () => {
  it('is the policy cap less existing obligations', () => {
    expect(maxEligibleEMI(100000, 10000)).toBe(40000);
  });

  it('never goes negative when existing EMI already breaches the cap', () => {
    expect(maxEligibleEMI(100000, 90000)).toBe(0);
  });
});

describe('maxEligiblePrincipal', () => {
  it('round-trips against calculateEMI', () => {
    const principal = maxEligiblePrincipal(100000, 10000, 9, 240);
    // Borrowing exactly that much should consume exactly the headroom.
    expect(calculateEMI(principal, 9, 240)).toBeCloseTo(40000, 2);
  });

  it('is zero when there is no headroom', () => {
    expect(maxEligiblePrincipal(50000, 30000, 9, 240)).toBe(0);
  });
});

describe('totalInterest', () => {
  it('is the excess of total repayment over principal', () => {
    expect(totalInterest(100000, 12, 12)).toBeCloseTo(8884.88 * 12 - 100000, 1);
  });
});
