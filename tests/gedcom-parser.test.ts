import { describe, expect, it } from 'vitest';
import { parseGedcom } from '../src/gedcom/parser.js';

describe('parseGedcom', () => {
  it('parses xref records, nested facts, and continuation lines', () => {
    const parsed = parseGedcom([
      '0 HEAD',
      '1 SOUR KinTrace Test',
      '0 @I1@ INDI',
      '1 NAME John /Smith/',
      '1 NOTE First line',
      '2 CONT second line',
      '2 CONC continued',
      '1 BIRT',
      '2 DATE 12 MAY 1901',
      '0 @F1@ FAM',
      '1 HUSB @I1@',
    ].join('\n'));

    expect(parsed.warnings).toEqual([]);
    expect(parsed.records).toHaveLength(3);
    const individual = parsed.records[1]!;
    expect(individual).toMatchObject({ level: 0, xref: '@I1@', tag: 'INDI', line: 3 });
    expect(individual.children.find((child) => child.tag === 'NAME')?.value).toBe('John /Smith/');
    expect(individual.children.find((child) => child.tag === 'NOTE')?.value).toBe(
      'First line\nsecond linecontinued',
    );
    expect(
      individual.children
        .find((child) => child.tag === 'BIRT')
        ?.children.find((child) => child.tag === 'DATE')?.value,
    ).toBe('12 MAY 1901');
  });

  it('warns on malformed lines and level jumps without dropping later records', () => {
    const parsed = parseGedcom([
      '0 @I1@ INDI',
      '2 DATE 1901',
      'bad line',
      '0 @I2@ INDI',
      '1 NAME Jane /Smith/',
    ].join('\n'));

    expect(parsed.records.map((record) => record.xref)).toEqual(['@I1@', '@I2@']);
    expect(parsed.warnings).toEqual([
      {
        line: 2,
        code: 'level_jump',
        message: 'Line level 2 has no parent at level 1.',
      },
      {
        line: 3,
        code: 'malformed_line',
        message: 'Could not parse GEDCOM line.',
      },
    ]);
  });
});
