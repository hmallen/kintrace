import { describe, it, expect } from 'vitest';
import { normalizeFuzzyDate } from '../src/dates.js';

describe('normalizeFuzzyDate', () => {
  it('passes exact dates through', () => {
    expect(normalizeFuzzyDate({ start: '1943-06-12', precision: 'exact' })).toEqual({
      start: '1943-06-12', end: '1943-06-12', precision: 'exact',
    });
  });
  it('expands a year to a full-year range', () => {
    expect(normalizeFuzzyDate({ start: '1943-01-01', precision: 'year' })).toEqual({
      start: '1943-01-01', end: '1943-12-31', precision: 'year',
    });
  });
  it('expands a month to a month range', () => {
    expect(normalizeFuzzyDate({ start: '1943-06-01', precision: 'month' })).toEqual({
      start: '1943-06-01', end: '1943-06-30', precision: 'month',
    });
  });
  it('expands a decade to a 10-year range', () => {
    expect(normalizeFuzzyDate({ start: '1940-01-01', precision: 'decade' })).toEqual({
      start: '1940-01-01', end: '1949-12-31', precision: 'decade',
    });
  });
  it('keeps an explicit end date', () => {
    expect(normalizeFuzzyDate({ start: '1943-01-01', end: '1945-12-31', precision: 'year' })).toEqual({
      start: '1943-01-01', end: '1945-12-31', precision: 'year',
    });
  });
  it('returns unknown for garbage', () => {
    expect(normalizeFuzzyDate({ start: 'circa the war', precision: 'exact' })).toEqual({
      start: null, end: null, precision: 'unknown',
    });
    expect(normalizeFuzzyDate({})).toEqual({ start: null, end: null, precision: 'unknown' });
  });
});
