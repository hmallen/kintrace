export interface GedcomWarning {
  line?: number;
  code: string;
  message: string;
}

export interface GedcomNode {
  level: number;
  tag: string;
  line: number;
  xref?: string;
  value?: string;
  children: GedcomNode[];
}

export interface GedcomParseResult {
  records: GedcomNode[];
  warnings: GedcomWarning[];
}

const LINE_RE = /^(\d+)(?:\s+(@[^@]+@))?\s+([A-Za-z0-9_]+)(?:\s+(.*))?$/;

export function parseGedcom(text: string): GedcomParseResult {
  const records: GedcomNode[] = [];
  const warnings: GedcomWarning[] = [];
  const stack: GedcomNode[] = [];

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index]!;
    if (raw.trim() === '') continue;

    const match = LINE_RE.exec(raw);
    if (!match) {
      warnings.push({
        line: lineNumber,
        code: 'malformed_line',
        message: 'Could not parse GEDCOM line.',
      });
      continue;
    }

    const level = Number(match[1]);
    const xref = match[2];
    const tag = match[3]!.toUpperCase();
    const value = match[4];

    if ((tag === 'CONC' || tag === 'CONT') && level > 0) {
      const parent = stack[level - 1];
      if (parent) {
        parent.value = `${parent.value ?? ''}${tag === 'CONT' ? '\n' : ''}${value ?? ''}`;
      } else {
        warnings.push({
          line: lineNumber,
          code: 'dangling_continuation',
          message: `${tag} line has no preceding value to continue.`,
        });
      }
      continue;
    }

    const node: GedcomNode = {
      level,
      tag,
      line: lineNumber,
      children: [],
      ...(xref ? { xref } : {}),
      ...(value !== undefined ? { value } : {}),
    };

    if (level === 0) {
      records.push(node);
      stack.length = 0;
      stack[0] = node;
      continue;
    }

    const parent = stack[level - 1];
    if (!parent) {
      warnings.push({
        line: lineNumber,
        code: 'level_jump',
        message: `Line level ${level} has no parent at level ${level - 1}.`,
      });
      continue;
    }

    parent.children.push(node);
    stack.length = level;
    stack[level] = node;
  }

  return { records, warnings };
}
