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

  it('strips a foil marker that trails a parenthesised set and collector number', () => {
    // The decoration sits AFTER the collector number in real exports, and the
    // set-info pattern is anchored at end-of-string, so the foil marker has to
    // come off first or the whole "(PLC) 26" stays glued to the name.
    expect(asLine(parseLine('1 Mesa Enchantress (PLC) 26 *F*', 1, 'main'))).toMatchObject({
      name: 'Mesa Enchantress',
      setCode: 'PLC',
    });
  });

  it('strips a foil marker with a promo collector suffix', () => {
    expect(asLine(parseLine('1 Anguished Unmaking (PSOI) 242p *F*', 1, 'main'))).toMatchObject({
      name: 'Anguished Unmaking',
      setCode: 'PSOI',
    });
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

describe('quantity marker must be distinct from the card name', () => {
  /*
   * A single permissive `\s*[xX]\s*` pattern read "1 Xenagos, God of Revels"
   * as quantity 1 times "enagos, God of Revels", silently corrupting all 27
   * Commander-legal cards whose name begins with X.
   */
  it.each([
    ['1 Xenagos, God of Revels', 1, 'Xenagos, God of Revels'],
    ['1 Xathrid Necromancer', 1, 'Xathrid Necromancer'],
    ['2 Xenagos, the Reveler', 2, 'Xenagos, the Reveler'],
    ['1 Xantid Swarm', 1, 'Xantid Swarm'],
    ['1 Xantcha, Sleeper Agent', 1, 'Xantcha, Sleeper Agent'],
    ['1 Xanathar, Guild Kingpin', 1, 'Xanathar, Guild Kingpin'],
    ["1 Xander's Lounge", 1, "Xander's Lounge"],
    ['1 Xanthic Statue', 1, 'Xanthic Statue'],
  ])('keeps the leading X in %s', (line, quantity, name) => {
    expect(asLine(parseLine(line, 1, 'main'))).toMatchObject({ quantity, name });
  });

  it.each([
    ['1x Sol Ring', 1, 'Sol Ring'],
    ['4x Lightning Bolt', 4, 'Lightning Bolt'],
    ['1 x Sol Ring', 1, 'Sol Ring'],
    ['4 X Lightning Bolt', 4, 'Lightning Bolt'],
    ['2 x Forest', 2, 'Forest'],
  ])('still reads the multiplier form %s', (line, quantity, name) => {
    expect(asLine(parseLine(line, 1, 'main'))).toMatchObject({ quantity, name });
  });

  it('cannot read an X-leading name as a spaced multiplier', () => {
    // The spaced form requires whitespace on BOTH sides of the x; a card
    // name's X is followed by more letters, never a space.
    expect(asLine(parseLine('1 Xenagos', 1, 'main'))).toMatchObject({
      quantity: 1,
      name: 'Xenagos',
    });
  });

  it('keeps a year-leading name intact while honouring an explicit x', () => {
    expect(asLine(parseLine('1996 World Champion', 1, 'main'))).toMatchObject({
      quantity: 1,
      name: '1996 World Champion',
    });
    expect(asLine(parseLine('1996x Foo', 1, 'main'))).toMatchObject({
      quantity: 1996,
      name: 'Foo',
    });
  });
});

describe('a blank line closes an explicit Commander section', () => {
  /*
   * MTGO, Arena and several deck sites terminate the commander block with a
   * blank line rather than a `Deck` header. Without this, the whole remaining
   * list parsed as commanders.
   */
  const sections = (text: string) =>
    parseDecklist(text).entries.map((e) => [e.section, e.name] as const);

  it('returns to the mainboard after the blank line', () => {
    expect(
      sections('Commander\n1 Xenagos, God of Revels\n\n1 Sol Ring\n1 Arcane Signet\n'),
    ).toEqual([
      ['commander', 'Xenagos, God of Revels'],
      ['main', 'Sol Ring'],
      ['main', 'Arcane Signet'],
    ]);
  });

  it('preserves contiguous commanders before the blank line', () => {
    // Partner and background pairs must survive.
    expect(
      sections('Commander\n1 Tymna the Weaver\n1 Kraum, Ludevic’s Opus\n\n1 Sol Ring\n'),
    ).toEqual([
      ['commander', 'Tymna the Weaver'],
      ['commander', 'Kraum, Ludevic’s Opus'],
      ['main', 'Sol Ring'],
    ]);
  });

  it('still honours an explicit Deck header', () => {
    expect(sections('Commander\n1 Xenagos, God of Revels\n\nDeck\n1 Sol Ring\n')).toEqual([
      ['commander', 'Xenagos, God of Revels'],
      ['main', 'Sol Ring'],
    ]);
  });

  it('does not treat a blank line before any commander as a terminator', () => {
    // A blank line straight after the header leaves the section open.
    expect(sections('Commander\n\n1 Xenagos, God of Revels\n')).toEqual([
      ['commander', 'Xenagos, God of Revels'],
    ]);
  });

  it('leaves incidental blank lines inside the mainboard alone', () => {
    /*
     * A blank line is NOT globally equivalent to a Deck header: mainboard
     * lists routinely carry blank lines between groups, and those must not
     * change the active section.
     */
    expect(sections('1 Sol Ring\n\n1 Arcane Signet\n\n1 Command Tower\n')).toEqual([
      ['main', 'Sol Ring'],
      ['main', 'Arcane Signet'],
      ['main', 'Command Tower'],
    ]);
  });

  it('does not resurrect the commander section on a later blank line', () => {
    expect(
      sections('Commander\n1 Xenagos, God of Revels\n\n1 Sol Ring\n\n1 Forest\n'),
    ).toEqual([
      ['commander', 'Xenagos, God of Revels'],
      ['main', 'Sol Ring'],
      ['main', 'Forest'],
    ]);
  });

  it('keeps a sideboard section open across a blank line', () => {
    // Only the commander section is closed this way.
    expect(sections('Sideboard\n1 Sol Ring\n\n1 Forest\n')).toEqual([
      ['sideboard', 'Sol Ring'],
      ['sideboard', 'Forest'],
    ]);
  });
});
