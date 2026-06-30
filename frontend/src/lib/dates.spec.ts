import { describe, expect, it } from 'vitest';
import { formatLocalDate } from './dates';

describe('formatLocalDate', () => {
  it('does not shift the calendar day through UTC conversion', () => {
    expect(formatLocalDate(new Date(2026, 0, 2, 23, 30))).toBe('2026-01-02');
  });
});
