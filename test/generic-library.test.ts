import { describe, expect, it } from 'vitest';
import libraryText from '../libraries/generic-iec.json?raw';
import { genericEnclosures, genericLibraryText, genericModules } from '../src/library/genericSeries';
import { terminalsOf } from '../src/electrical/terminals';
import { parseLibraryJson } from '../src/library/validate';

const parsed = parseLibraryJson(libraryText);
if (!parsed.ok) throw new Error(`the bundled library is invalid: ${JSON.stringify(parsed.errors)}`);
const library = parsed.library;
const byId = new Map(library.modules.map((m) => [m.id, m]));

/** Ids of the very first bundled library: projects and links may still refer to them. */
const ORIGINAL_MODULE_IDS = [
  'mcb-1p-b10', 'mcb-1p-c16', 'mcb-2p-c25', 'mcb-3p-c32', 'rcd-2p-40-30', 'rcd-4p-63-30',
  'rcbo-1pn-c16-30', 'main-switch-3p-63', 'contactor-3p-25-230', 'n-bar-12', 'pe-bar-12',
  'comb-3ph-12', 'comb-1ph-12', 'comb-lpn-12',
];

describe('the bundled library', () => {
  it('is exactly what the generator writes; run `npm run gen:library` after changing the series', () => {
    expect(libraryText).toBe(genericLibraryText());
  });

  it('is valid and has metadata that says where the numbers come from', () => {
    expect(library.version).toBe('20');
    expect(library.description).toMatch(/not taken from any manufacturer/);
  });

  it('keeps every id of the first version, with the same kind and name', () => {
    const original: Record<string, [string, string]> = {
      'mcb-1p-b10': ['breaker', 'MCB 1P B10'],
      'mcb-3p-c32': ['breaker', 'MCB 3P C32'],
      'rcd-2p-40-30': ['rcd', 'RCD 2P 40A 30mA'],
      'rcbo-1pn-c16-30': ['rcbo', 'RCBO 1P+N C16 30mA'],
      'main-switch-3p-63': ['switch', 'Main switch 3P 63A'],
      'contactor-3p-25-230': ['contactor', 'Contactor 3P 25A, 230V coil'],
      'n-bar-12': ['busbar', 'Neutral bar 12 terminals'],
      'comb-lpn-12': ['comb', 'Comb L+N, 12 units'],
    };
    for (const id of ORIGINAL_MODULE_IDS) expect(byId.has(id)).toBe(true);
    for (const [id, [kind, name]] of Object.entries(original)) expect(byId.get(id)).toMatchObject({ kind, name });
    for (const id of ['enc-1x12', 'enc-2x18', 'enc-3x24']) {
      expect(library.enclosures.some((e) => e.id === id)).toBe(true);
    }
  });

  it('has unique ids and the number of items the series define', () => {
    expect(new Set(library.modules.map((m) => m.id)).size).toBe(library.modules.length);
    expect(library.modules).toHaveLength(genericModules().length);
    expect(library.enclosures).toHaveLength(genericEnclosures().length);
    expect(library.modules.length).toBeGreaterThan(200);
  });

  it('holds no manufacturer data: no part numbers, no vendor, no link', () => {
    expect(library.modules.some((m) => m.sku !== undefined)).toBe(false);
    expect(library.vendor).toBeUndefined();
    expect(library.url).toBeUndefined();
  });

  it('uses only the standard rating series', () => {
    const ratings = (kind: string) => new Set(library.modules.filter((m) => m.kind === kind).map((m) => m.ratedCurrentA));
    expect([...ratings('breaker')].sort((a, b) => a! - b!)).toEqual([6, 10, 13, 16, 20, 25, 32, 40, 50, 63]);
    expect([...ratings('rcd')].sort((a, b) => a! - b!)).toEqual([25, 40, 63, 80, 100]);
    expect([...new Set(library.modules.filter((m) => m.residualCurrentMa).map((m) => m.residualCurrentMa))].sort((a, b) => a! - b!)).toEqual([30, 100, 300]);
    expect([...new Set(library.modules.filter((m) => m.kind === 'breaker').map((m) => m.curve))].sort()).toEqual(['B', 'C', 'D']);
  });

  it('gives each device a name and an id that agree with its fields', () => {
    for (const m of library.modules.filter((x) => x.kind === 'breaker')) {
      expect(m.id).toBe(`mcb-${m.poles}p-${m.curve!.toLowerCase()}${m.ratedCurrentA}`);
      expect(m.name).toBe(`MCB ${m.poles}P ${m.curve}${m.ratedCurrentA}`);
      expect(m.widthUnits).toBe(m.poles);
    }
    for (const m of library.modules.filter((x) => x.kind === 'rcd')) {
      expect(m.id).toBe(`rcd-${m.poles}p-${m.ratedCurrentA}-${m.residualCurrentMa}`);
      expect(m.widthUnits).toBe(m.poles);
    }
  });

  it('covers every pole count with the conductors people expect', () => {
    const conductors = (id: string) => terminalsOf(byId.get(id)!).filter((t) => t.side === 'top').map((t) => t.conductor);
    expect(conductors('mcb-1p-c16')).toEqual(['L']);
    expect(conductors('mcb-2p-c16')).toEqual(['L', 'N']);
    expect(conductors('mcb-3p-c16')).toEqual(['L1', 'L2', 'L3']);
    expect(conductors('mcb-4p-c16')).toEqual(['L1', 'L2', 'L3', 'N']);
    expect(conductors('rcbo-1pn-c16-30')).toEqual(['L', 'N']);
  });

  it('lets bars and combs be resized, except the bars of fixed width, and gives combs the patterns of the devices they serve', () => {
    const fixedWidthBars = ['n', 'pe', 'pen', 'l', 'l1', 'l2', 'l3'].flatMap((id) => [10, 12, 16].flatMap((count) => [`${id}-side-${count}-right`, `${id}-side-${count}-left`]));
    for (const m of library.modules.filter((x) => (x.kind === 'busbar' || x.kind === 'comb') && !fixedWidthBars.includes(x.id))) {
      expect(m.resizable).toBeDefined();
    }
    for (const id of fixedWidthBars) {
      expect(byId.get(id)?.resizable).toBeUndefined();
      expect(byId.get(id)?.terminals).toHaveLength(Number(/-side-(\d+)-/.exec(id)![1]));
    }
    expect(byId.get('comb-3phn-12')?.comb?.pattern).toEqual(['L1', 'L2', 'L3', 'N']);
  });

  it('offers enclosures from one to five rows', () => {
    const rows = new Set(library.enclosures.map((e) => e.railLengthsUnits.length));
    expect([...rows].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(library.enclosures.every((e) => new Set(e.railLengthsUnits).size === 1)).toBe(true);
  });
});

describe('widths of a placed copy', () => {
  it('lets relays, meters, power supplies and changeover switches vary, within a range that holds the default', () => {
    for (const m of library.modules.filter((x) => ['relay', 'meter', 'psu'].includes(x.kind) || x.id.startsWith('changeover-'))) {
      expect(m.resizable, m.id).toBeDefined();
      expect(m.widthUnits, m.id).toBeGreaterThanOrEqual(m.resizable!.minUnits);
      expect(m.widthUnits, m.id).toBeLessThanOrEqual(m.resizable!.maxUnits);
    }
  });

  it('keeps protective devices and contactors at the width of their poles', () => {
    for (const m of library.modules.filter((x) => ['breaker', 'rcd', 'rcbo', 'contactor'].includes(x.kind))) {
      expect(m.resizable, m.id).toBeUndefined();
    }
  });
});

describe('devices with control circuits', () => {
  const terminals = (id: string) => byId.get(id)!.terminals!;
  const sideOf = (id: string, name: string) => terminals(id).find((t) => t.name === name)?.side;
  const contactsOf = (id: string) => terminals(id).filter((t) => t.conductor === 'C');

  it('gives every monitoring relay a change-over contact on the bottom and its supply on top', () => {
    for (const id of ['vrelay-1p', 'vrelay-3pn', 'phase-relay-3p', 'phase-relay-3pn']) {
      expect(contactsOf(id).map((t) => `${t.name}:${t.side}`), id).toEqual(['11:bottom', '12:bottom', '14:bottom']);
      expect(terminals(id).filter((t) => t.conductor !== 'C').every((t) => t.side === 'top'), id).toBe(true);
    }
  });

  it('switches a lighting load from the top to the bottom and keeps a twilight sensor on control terminals', () => {
    for (const id of ['impulse-relay-1p', 'stair-timer-1p', 'twilight-switch-1p', 'time-switch-1p']) {
      expect(byId.get(id)?.ratedCurrentA, id).toBe(16);
      expect(terminals(id).some((t) => t.side === 'top' && t.conductor === 'L'), id).toBe(true);
      expect(terminals(id).some((t) => t.side === 'bottom' && t.conductor === 'L'), id).toBe(true);
    }
    expect(contactsOf('twilight-switch-1p').map((t) => t.name)).toEqual(['S1', 'S2']);
  });

  it('lets a power supply feed from L and N and give plus and minus of 24 V', () => {
    for (const id of ['psu-24v-1a', 'psu-24v-2a5']) {
      expect(terminals(id).filter((t) => t.side === 'bottom').map((t) => t.conductor), id).toEqual(['DCP', 'DCN']);
      expect(terminals(id).filter((t) => t.side === 'top').map((t) => t.conductor), id).toEqual(['L', 'N']);
    }
  });

  it('gives a changeover switch two supply inputs of the same conductors and one output, never joined inside', () => {
    for (const id of ['changeover-2p-40', 'changeover-2p-63', 'changeover-4p-63', 'changeover-4p-100']) {
      const def = byId.get(id)!;
      const topTerminals = terminals(id).filter((t) => t.side === 'top');
      const output = terminals(id).filter((t) => t.side === 'bottom').map((t) => t.conductor);
      expect(topTerminals.map((t) => t.conductor), id).toEqual([...output, ...output]);
      expect(terminals(id).some((t) => t.net !== undefined), id).toBe(false);
      expect(def.kind).toBe('switch');
    }
    expect(sideOf('changeover-4p-63', 'L1a')).toBe('top');
    expect(sideOf('changeover-4p-63', 'L1b')).toBe('top');
    expect(sideOf('changeover-4p-63', 'L1')).toBe('bottom');
  });

  it('gives the transfer controller sensing inputs for both supplies and dry contacts for the contactors and a generator', () => {
    expect(contactsOf('ats-controller-3pn').map((t) => t.name)).toEqual(['CA1', 'CA2', 'CB1', 'CB2', 'GS1', 'GS2']);
    expect(terminals('ats-controller-3pn').filter((t) => t.side === 'top')).toHaveLength(8);
  });
});

describe('the narrow bars with a column of terminals', () => {
  const CONDUCTORS = { n: 'N', pe: 'PE', pen: 'PEN', l: 'L', l1: 'L1', l2: 'L2', l3: 'L3' } as const;
  const SIZES = [{ count: 10, heightMm: 60 }, { count: 12, heightMm: 72 }, { count: 16, heightMm: 88 }];
  const BARS = Object.entries(CONDUCTORS).flatMap(([id, conductor]) =>
    SIZES.flatMap(({ count, heightMm }) => [
      [`${id}-side-${count}-right`, conductor, 'top', count, heightMm],
      [`${id}-side-${count}-left`, conductor, 'bottom', count, heightMm],
    ] as const),
  );

  it.each(BARS)('%s is as narrow as a real bar, stands its terminals of %s on the %s side down its height, joined into one net', (id, conductor, side, count, heightMm) => {
    const def = byId.get(id)!;
    expect(def.widthUnits).toBe(0.7);
    expect(def.heightMm).toBe(heightMm);
    expect(def.sideTerminals).toBe(true);
    const terminals = terminalsOf(def);
    expect(terminals).toHaveLength(count);
    expect(terminals.every((t) => t.side === side && t.conductor === conductor && t.net === conductor)).toBe(true);
    const pitch = heightMm / 17.5 / count;
    const spacing = terminals.slice(1).map((t, i) => t.unit - terminals[i]!.unit);
    for (const step of spacing) expect(step).toBeCloseTo(pitch, 2);
    expect(terminals[0]!.unit).toBeCloseTo(pitch / 2, 2);
    expect(terminals.at(-1)!.unit).toBeCloseTo(heightMm / 17.5 - pitch / 2, 2);
    expect(new Set(terminals.map((t) => t.id)).size).toBe(count);
  });

  it.each(BARS)('%s draws one screw head under each terminal, on the side of the terminals', (id, _conductor, side, count) => {
    const def = byId.get(id)!;
    const heads = def.art!.filter((s) => s.kind === 'ellipse');
    expect(heads).toHaveLength(count);
    const widthMm = def.widthUnits * 17.5;
    const expectedX = side === 'top' ? widthMm - 4 : 4;
    for (const head of heads) expect(head.kind === 'ellipse' && head.cx).toBeCloseTo(expectedX, 3);
    const ys = heads.map((s) => (s.kind === 'ellipse' ? s.cy : 0));
    expect(ys).toEqual(terminalsOf(def).map((t) => t.unit * 17.5).map((y) => expect.closeTo(y, 3)));
  });

  it('have a band down the side away from the terminals: blue for the neutral, green for the earth and a neutral one for every phase', () => {
    const band = (id: string) => byId.get(id)!.art!.find((s) => s.kind === 'rect')!;
    expect(band('n-side-16-right')).toMatchObject({ fill: '#2f7de1', x: 1.5 });
    expect(band('n-side-16-left')).toMatchObject({ fill: '#2f7de1', x: 12.25 - 1.5 - 3 });
    expect(band('pe-side-12-right')).toMatchObject({ fill: '#2f9e44' });
    for (const id of ['l-side-10-right', 'l1-side-12-right', 'l2-side-16-left', 'l3-side-16-left']) expect(band(id), id).toMatchObject({ fill: '#a8a29e' });
  });
});
