import { describe, expect, test } from 'bun:test';

// Inline the formula so the test has no cross-package import dependency.
function computeReputation(accountAgeDays: number, netVotes: number): number {
  const ageBonus = Math.min(accountAgeDays, 365);
  const voteBonus = Math.log10(Math.max(1, netVotes + 1)) * 100;
  return Math.round((ageBonus + voteBonus) * 10) / 10;
}

function weightedThreadScore(base: number, reputation: number, weight = 5): number {
  return base + Math.log10(Math.max(1, reputation + 1)) * weight;
}

describe('weightedThreadScore', () => {
  test('zero reputation yields base unchanged', () => {
    expect(weightedThreadScore(10, 0)).toBe(10);
  });

  test('negative reputation clamped to 0 bonus', () => {
    expect(weightedThreadScore(10, -50)).toBe(10);
  });

  test('high reputation lifts the base by log10(rep+1) * weight', () => {
    // rep = 999 → log10(1000) * 5 = 15
    expect(weightedThreadScore(20, 999)).toBeCloseTo(35, 5);
  });

  test('weight override scales the bonus', () => {
    expect(weightedThreadScore(0, 999, 10)).toBeCloseTo(30, 5);
  });

  test('rep = 9 yields exactly log10(10)*5 = 5 bonus', () => {
    expect(weightedThreadScore(0, 9)).toBeCloseTo(5, 5);
  });
});

describe('computeReputation', () => {
  test('0 age + 0 votes yields 0', () => {
    expect(computeReputation(0, 0)).toBe(0);
  });

  test('1 year + 0 votes yields 365', () => {
    expect(computeReputation(365, 0)).toBe(365);
  });

  test('0 age + 10 votes yields ~104.1', () => {
    const result = computeReputation(0, 10);
    // log10(11) * 100 = 104.13... rounded to 1 dp = 104.1
    expect(result).toBeCloseTo(104.1, 1);
  });

  test('age is capped at 365 for inputs > 365', () => {
    const at365 = computeReputation(365, 0);
    const at1000 = computeReputation(1000, 0);
    expect(at365).toBe(at1000);
  });

  test('negative net_votes clamped via max(1, netVotes+1)', () => {
    // netVotes = -5 → max(1, -4) = 1 → log10(1)*100 = 0
    expect(computeReputation(0, -5)).toBe(0);
    // netVotes = -1 → max(1, 0) = 1 → log10(1)*100 = 0
    expect(computeReputation(0, -1)).toBe(0);
  });
});
