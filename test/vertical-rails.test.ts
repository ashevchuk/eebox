import { describe, expect, it } from 'vitest';
import { createPanel } from '../src/layout/panel';
import type { Panel, Sizes } from '../src/layout/placement';
import { DIN_MODULE_HEIGHT_MM, MODULE_UNIT_MM } from '../src/library/types';
import { COMB_HEIGHT, COMB_OVERHANG, FRAME_PADDING, RAIL_HEIGHT, combRect, moduleRect, placementRect, railAtPoint, railRect, rowRect, snapToSlot } from '../src/view/geometry';

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
