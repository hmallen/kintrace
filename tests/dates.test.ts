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

  it('snaps a mid-year start to the full-year range', () => {
    expect(normalizeFuzzyDate({ start: '1943-06-15', precision: 'year' })).toEqual({
      start: '1943-01-01', end: '1943-12-31', precision: 'year',
    });
  });

  it('snaps a mid-month start to the full-month range', () => {
    expect(normalizeFuzzyDate({ start: '1943-06-15', precision: 'month' })).toEqual({
      start: '1943-06-01', end: '1943-06-30', precision: 'month',
    });
  });

  it('snaps a mid-decade start to the full-decade range', () => {
    expect(normalizeFuzzyDate({ start: '1945-06-15', precision: 'decade' })).toEqual({
      start: '1940-01-01', end: '1949-12-31', precision: 'decade',
    });
  });

  it('returns unknown for a month outside 1-12', () => {
    expect(normalizeFuzzyDate({ start: '1943-13-01', precision: 'exact' })).toEqual({
      start: null, end: null, precision: 'unknown',
    });
  });

  it('returns unknown for a day that does not exist in the month', () => {
    expect(normalizeFuzzyDate({ start: '1943-02-30', precision: 'exact' })).toEqual({
      start: null, end: null, precision: 'unknown',
    });
  });

  it('accepts a leap day as a valid exact date', () => {
    expect(normalizeFuzzyDate({ start: '2024-02-29', precision: 'exact' })).toEqual({
      start: '2024-02-29', end: '2024-02-29', precision: 'exact',
    });
  });

  it('ignores an invalid explicit end and falls back to single-date expansion', () => {
    expect(normalizeFuzzyDate({ start: '1943-06-01', end: '1943-02-31', precision: 'month' })).toEqual({
      start: '1943-06-01', end: '1943-06-30', precision: 'month',
    });
  });

  it('ignores a calendar-valid explicit end that is earlier than start, falling back to single-date expansion', () => {
    expect(normalizeFuzzyDate({ start: '1945-01-01', end: '1943-01-01', precision: 'year' })).toEqual({
      start: '1945-01-01', end: '1945-12-31', precision: 'year',
    });
  });
});
