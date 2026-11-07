import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import type { Panel, Sizes } from '../src/layout/placement';
import { DIN_MODULE_HEIGHT_MM, MODULE_UNIT_MM } from '../src/library/types';
import { COMB_HEIGHT, COMB_OVERHANG, FRAME_PADDING, RAIL_HEIGHT, combRect, levelLabelStart, moduleRect, placementRect, printArea, railAtPoint, railRect, rowRect, snapToSlot } from '../src/view/geometry';

const AXIS_X_MM = 300;
const TOP_Y_MM = 60;
const sizes: Sizes = { widthOf: () => 2, heightOf: () => DIN_MODULE_HEIGHT_MM };

/** One horizontal row of 12 units, and a vertical rail of 10 units beside it. */
function panelWithVerticalRail(): Panel {
  const base = createPanel([12]);
  return { ...base, rails: [...base.rails, { plate: base.rails[0]!.plate, orientation: 'vertical', x: AXIS_X_MM, y: TOP_Y_MM, lengthUnits: 10 }] };
}

describe('a vertical rail', () => {
  it('is a bar that runs down from its top end, centred on its axis', () => {
    const bar = railRect(panelWithVerticalRail(), 1);
    expect(bar).toEqual({ x: FRAME_PADDING + AXIS_X_MM - RAIL_HEIGHT / 2, y: FRAME_PADDING + TOP_Y_MM, width: RAIL_HEIGHT, height: 10 * MODULE_UNIT_MM });
  });

  it('holds modules turned a quarter turn: the width runs down the rail and the height across it', () => {
    const panel = panelWithVerticalRail();
    const body = moduleRect(panel, 1, 3, 2, DIN_MODULE_HEIGHT_MM);
    const bar = railRect(panel, 1);
    expect(body).toEqual({ x: bar.x + bar.width / 2 - DIN_MODULE_HEIGHT_MM / 2, y: bar.y + 3 * MODULE_UNIT_MM, width: DIN_MODULE_HEIGHT_MM, height: 2 * MODULE_UNIT_MM });
  });

  it('finds the placed module through its rail', () => {
    const panel = { ...panelWithVerticalRail(), placements: [{ id: 'p1', module: { libraryId: 'l', moduleId: 'm' }, rail: 1, slot: 1 }] };
    expect(placementRect(panel, sizes, panel.placements[0]!)).toEqual(moduleRect(panel, 1, 1, 2, DIN_MODULE_HEIGHT_MM));
  });

  it('puts a comb of top terminals on the right of the modules and one of bottom terminals on the left', () => {
    const panel = panelWithVerticalRail();
    const body = moduleRect(panel, 1, 0, 4, DIN_MODULE_HEIGHT_MM);
    const top = combRect(panel, sizes, 1, 0, 4, 'top');
    const bottom = combRect(panel, sizes, 1, 0, 4, 'bottom');
    expect(top).toEqual({ x: body.x + body.width - (COMB_HEIGHT - COMB_OVERHANG), y: body.y, width: COMB_HEIGHT, height: body.height });
    expect(bottom).toEqual({ x: body.x - COMB_OVERHANG, y: body.y, width: COMB_HEIGHT, height: body.height });
  });

  it('is found by a point on its bar', () => {
    const panel = panelWithVerticalRail();
    const bar = railRect(panel, 1);
    expect(railAtPoint(panel, { x: bar.x + 5, y: bar.y + 40 })).toBe(1);
    expect(railAtPoint(panel, { x: bar.x + bar.width + 20, y: bar.y + 40 })).toBeUndefined();
  });

  it('has a body as tall as its tallest module, across the rail', () => {
    const panel = panelWithVerticalRail();
    const body = rowRect(panel, sizes, 1);
    const bar = railRect(panel, 1);
    expect(body).toEqual({ x: bar.x + bar.width / 2 - DIN_MODULE_HEIGHT_MM / 2, y: bar.y, width: DIN_MODULE_HEIGHT_MM, height: bar.height });
  });
});

describe('dropping on a vertical rail', () => {
  it('takes the slot from the height of the point, not from its x', () => {
    const panel = panelWithVerticalRail();
    const bar = railRect(panel, 1);
    const at = { x: bar.x + bar.width / 2 + 3, y: bar.y + 4.5 * MODULE_UNIT_MM };
    expect(snapToSlot(panel, at, 1, 0.5)).toEqual({ rail: 1, slot: 4 });
  });

  it('keeps the module inside the rail at the far end', () => {
    const panel = panelWithVerticalRail();
    const bar = railRect(panel, 1);
    const at = { x: bar.x + bar.width / 2, y: bar.y + bar.height + 30 };
    expect(snapToSlot(panel, at, 2, 1)).toEqual({ rail: 1, slot: 8 });
  });

  it('goes to a rail only when it is accepted, so a device that cannot stand on a vertical rail stays off it', () => {
    const panel = panelWithVerticalRail();
    const bar = railRect(panel, 1);
    const at = { x: bar.x + bar.width / 2, y: bar.y + 9 * MODULE_UNIT_MM };
    expect(snapToSlot(panel, at, 1, 0.5, [], (rail) => rail === 0)).toBeNull();
    expect(snapToSlot(panel, at, 1, 0.5, [], () => true)?.rail).toBe(1);
  });

  it('still chooses the horizontal row for a point near it', () => {
    const panel = panelWithVerticalRail();
    const bar = railRect(panel, 0);
    expect(snapToSlot(panel, { x: bar.x + 3.5 * MODULE_UNIT_MM, y: bar.y + RAIL_HEIGHT / 2 }, 1, 0.5)).toEqual({ rail: 0, slot: 3 });
  });
});

describe('the label of a module on a vertical rail', () => {
  const combOf = (side: 'top' | 'bottom') => () => ({ widthUnits: 6, side });
  const withComb = (): Panel => ({ ...panelWithVerticalRail(), combs: [{ id: 'c1', module: { libraryId: 'l', moduleId: 'comb' }, rail: 1, slot: 0 }] });

  it('starts at the right edge of the module when no comb is over it', () => {
    const panel = panelWithVerticalRail();
    const body = moduleRect(panel, 1, 0, 2, DIN_MODULE_HEIGHT_MM);
    expect(levelLabelStart(panel, sizes, combOf('top'), body, 1)).toBe(body.x + body.width);
  });

  it('starts after a comb of top terminals that lies over the module, and ignores one of bottom terminals or on other modules', () => {
    const panel = withComb();
    const body = moduleRect(panel, 1, 0, 2, DIN_MODULE_HEIGHT_MM);
    const comb = combRect(panel, sizes, 1, 0, 6, 'top');
    expect(levelLabelStart(panel, sizes, combOf('top'), body, 1)).toBe(comb.x + comb.width);
    expect(levelLabelStart(panel, sizes, combOf('bottom'), body, 1)).toBe(body.x + body.width);
    const farBody = moduleRect(panel, 1, 8, 2, DIN_MODULE_HEIGHT_MM);
    expect(levelLabelStart(panel, sizes, combOf('top'), farBody, 1)).toBe(farBody.x + farBody.width);
  });
});

describe('the full-size print of a vertical rail', () => {
  const measure = (text: string) => text.length * 4;
  const COMB_LABEL = 'Phases of the supply side';
  const labelled = (): Panel => {
    const base = panelWithVerticalRail();
    return {
      ...base,
      plates: base.plates.map((plate) => ({ ...plate, widthMm: 600 })),
      rails: base.rails.map((r, i) => (i === 1 ? { ...r, label: 'Bars' } : r)),
      placements: [{ id: 'p1', module: { libraryId: 'l', moduleId: 'm' }, rail: 1, slot: 0, label: 'Neutral' }],
    };
  };

  it('covers the bar, the module with its label to the right, and the label of the row above the rail', () => {
    const panel = labelled();
    const { bounds, rects } = printArea(panel, sizes, () => undefined, measure);
    const bar = railRect(panel, 1);
    const body = placementRect(panel, sizes, panel.placements[0]!);
    expect(bounds.minX).toBeLessThanOrEqual(bar.x);
    expect(bounds.maxX).toBeGreaterThanOrEqual(body.x + body.width + measure('Neutral'));
    expect(bounds.minY).toBeLessThan(bar.y);
    expect(rects.some((r) => r.y + r.height <= bar.y && r.x < bar.x + bar.width && bar.x < r.x + r.width)).toBe(true);
  });

  it('starts the label of the module after a comb over it', () => {
    const panel = { ...labelled(), combs: [{ id: 'c1', module: { libraryId: 'l', moduleId: 'comb' }, rail: 1, slot: 0 }] };
    const info = () => ({ widthUnits: 6, side: 'top' as const });
    const comb = combRect(panel, sizes, 1, 0, 6, 'top');
    const { rects } = printArea(panel, sizes, info, measure);
    expect(rects.some((r) => r.x === comb.x + comb.width && r.width > 0 && r.height === 10)).toBe(true);
  });

  it('covers the label of a comb on the vertical rail, on the side of its terminals', () => {
    const base = labelled();
    const comb = (side: 'top' | 'bottom') => ({ ...base, combs: [{ id: 'c1', module: { libraryId: 'l', moduleId: 'comb' }, rail: 1, slot: 0, label: COMB_LABEL }] });
    for (const side of ['top', 'bottom'] as const) {
      const panel = comb(side);
      const strip = combRect(panel, sizes, 1, 0, 6, side);
      const { bounds } = printArea(panel, sizes, () => ({ widthUnits: 6, side }), measure);
      if (side === 'top') expect(bounds.maxX).toBeGreaterThanOrEqual(strip.x + strip.width + measure(COMB_LABEL));
      else expect(bounds.minX).toBeLessThanOrEqual(strip.x - measure(COMB_LABEL));
    }
  });
});
