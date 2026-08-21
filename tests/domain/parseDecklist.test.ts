import { describe, expect, it } from 'vitest';
import { detectSectionHeader, parseDecklist, parseLine } from '@/domain/parseDecklist';
import type { ParseError, ParsedLine } from '@/domain/types';

const asLine = (v: ParsedLine | ParseError | null): ParsedLine => {
  if (!v || 'reason' in v) throw new Error(`expected a parsed line, got ${JSON.stringify(v)}`);
  return v;
};
const asError = (v: ParsedLine | ParseError | null): ParseError => {
  if (!v || !('reason' in v)) throw new Error(`expected an error, got ${JSON.stringify(v)}`);
  return v;
};

describe('parseLine quantity forms', () => {
  it('parses "1 Sol Ring"', () => {
    const l = asLine(parseLine('1 Sol Ring', 1, 'main'));
    expect(l).toMatchObject({ quantity: 1, name: 'Sol Ring', section: 'main' });
  });

  it('parses "4x Lightning Bolt"', () => {
    expect(asLine(parseLine('4x Lightning Bolt', 1, 'main'))).toMatchObject({
      quantity: 4,
      name: 'Lightning Bolt',
    });
  });

  it('parses "2 x Forest"', () => {
    expect(asLine(parseLine('2 x Forest', 1, 'main'))).toMatchObject({
      quantity: 2,
      name: 'Forest',
    });
  });

  it('defaults a bare name to quantity 1', () => {
    expect(asLine(parseLine('Sol Ring', 1, 'main'))).toMatchObject({
      quantity: 1,
      name: 'Sol Ring',
    });
  });

  it('keeps numbers that belong to the card name', () => {
    expect(asLine(parseLine('1 Borrowing 100,000 Arrows', 1, 'main'))).toMatchObject({
      quantity: 1,
      name: 'Borrowing 100,000 Arrows',
    });
  });
});

describe('parseLine set codes', () => {
  it('strips a bracketed set code', () => {
    expect(asLine(parseLine('1 Sol Ring [LTC]', 1, 'main'))).toMatchObject({
      name: 'Sol Ring',
      setCode: 'LTC',
    });
  });

  it('strips a parenthesised set code and collector number', () => {
    expect(asLine(parseLine('1 Sol Ring (ltc) 123', 1, 'main'))).toMatchObject({
      name: 'Sol Ring',
      setCode: 'LTC',
    });
  });

  it('strips foil markers', () => {
    expect(asLine(parseLine('1 Sol Ring [LTC] *F*', 1, 'main')).name).toBe('Sol Ring');
  });

  it('does not mistake a parenthesised name for a set code', () => {
    // No set code here; the whole thing is the name.
    expect(asLine(parseLine('1 Erase (Not the Urza Legacy One)', 1, 'main')).name).toBe(
      'Erase (Not the Urza Legacy One)',
    );
  });
});

describe('parseLine comments and junk', () => {
  it.each(['', '   ', '// a comment', '# another'])('ignores %j', (raw) => {
    expect(parseLine(raw, 1, 'main')).toBeNull();
  });

  it('reports a line with no letters as an error', () => {
    expect(asError(parseLine('12345', 1, 'main')).reason).toMatch(/letters/i);
  });

  it('rejects a zero quantity', () => {
    expect(asError(parseLine('0 Sol Ring', 1, 'main')).reason).toMatch(/greater than zero/i);
  });
});

describe('detectSectionHeader', () => {
  it.each([
    ['Commander:', 'commander'],
    ['COMMANDER', 'commander'],
    ['Commander (1)', 'commander'],
    ['Sideboard', 'sideboard'],
    ['Deck', 'main'],
    ['Mainboard', 'main'],
  ])('detects %j', (raw, expected) => {
    expect(detectSectionHeader(raw)).toBe(expected);
  });

  it('does not treat a card line as a header', () => {
    expect(detectSectionHeader('1 Sol Ring')).toBeNull();
  });
});

describe('parseDecklist', () => {
  it('tracks sections across a list', () => {
    const { entries } = parseDecklist(
      [
        'Commander:',
        "1 Atraxa, Praetors' Voice",
        '',
        'Deck',
        '1 Sol Ring',
        '1 Cultivate',
        'Sideboard',
        '1 Arcane Signet',
      ].join('\n'),
    );
    expect(entries.map((e) => [e.name, e.section])).toEqual([
      ["Atraxa, Praetors' Voice", 'commander'],
      ['Sol Ring', 'main'],
      ['Cultivate', 'main'],
      ['Arcane Signet', 'sideboard'],
    ]);
  });

  it('supports an inline Commander: tag for one line only', () => {
    const { entries } = parseDecklist(
      ['1 Commander: Atraxa, Praetors\' Voice', '1 Sol Ring'].join('\n'),
    );
    expect(entries.map((e) => e.section)).toEqual(['commander', 'main']);
    expect(entries[0]?.name).toBe("Atraxa, Praetors' Voice");
  });

  it('handles CRLF line endings', () => {
    const { entries, errors } = parseDecklist('1 Sol Ring\r\n1 Cultivate\r\n');
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring', 'Cultivate']);
  });

  it('records line numbers and collects errors without throwing', () => {
    const { entries, errors } = parseDecklist(['1 Sol Ring', '99999', '1 Cultivate'].join('\n'));
    expect(entries).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.lineNumber).toBe(2);
    expect(entries[1]?.lineNumber).toBe(3);
  });

  it('parses the plain 100-line format from the brief', () => {
    const { entries, errors } = parseDecklist(
      ["1 Atraxa, Praetors' Voice", '1 Sol Ring', '1 Arcane Signet', '1 Cultivate'].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.section === 'main')).toBe(true);
  });
});

describe('parseLine junk that superficially looks like a name', () => {
  it.each(['@@@ junk line', '!!! hello', '--- notes ---', '>>> deck below'])(
    'rejects %j rather than treating it as a card',
    (raw) => {
      const result = parseLine(raw, 1, 'main');
      expect(asError(result).reason).toMatch(/does not look like a card name/i);
    },
  );

  it.each([
    'Bösium Strip',
    'Ratchet, Field Medic',
    "Urza's Saga",
    '1996 World Champion',
    'Borrowing 100,000 Arrows',
    'Ach! Hans, Run!',
  ])('still accepts the real card name %j', (name) => {
    const line = asLine(parseLine(name, 1, 'main'));
    expect(line.name).toBe(name);
  });
});
