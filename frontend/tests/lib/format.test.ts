import { describe, it, expect } from 'vitest';
import { formatDate, formatPercent } from '../../src/lib/format';

describe('formatDate', () => {
  it('returns an em-dash when the value is null', () => {
    expect(formatDate(null)).toBe('—');
  });

  it('returns an em-dash when the value is undefined', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('returns a string for a valid ISO date', () => {
    const result = formatDate('2026-01-15T12:34:56Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('—');
  });
});

describe('formatPercent', () => {
  it('returns an em-dash for null', () => {
    expect(formatPercent(null)).toBe('—');
  });

  it('returns an em-dash for undefined', () => {
    expect(formatPercent(undefined)).toBe('—');
  });

  it('rounds 0.5 to 50%', () => {
    expect(formatPercent(0.5)).toBe('50%');
  });

  it('rounds 0.876 to 88%', () => {
    expect(formatPercent(0.876)).toBe('88%');
  });

  it('returns 0% for zero (not em-dash, since 0 != null)', () => {
    expect(formatPercent(0)).toBe('0%');
  });
});
