import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import { placeArt } from '../src/library/art';
import { terminalsOf } from '../src/electrical/terminals';
import { MODULE_UNIT_MM, type Library, type ModuleDef } from '../src/library/types';
import { boundsOf } from '../src/ui/artEditor';

const PIN_RADIUS_MM = 2.4;
const CLEARANCE_MM = 0.8;
const TOP_PIN_Y_MM = 7;
const BOTTOM_PIN_Y_MM = 84;
const PIN_SPACING_MM = 5;

/** The bars carry a screw head under every terminal on purpose. */
const SCREWS_UNDER_TERMINALS = new Set(['busbar']);

const library = JSON.parse(raw) as Library;

const widthsOf = (def: ModuleDef): number[] =>
  def.resizable ? [...new Set([def.resizable.minUnits, def.widthUnits, def.resizable.maxUnits, Math.round((def.resizable.minUnits + def.resizable.maxUnits) / 2)])] : [def.widthUnits];

const pinsAt = (def: ModuleDef, width: number) => {
  const terminals = terminalsOf(def, width);
  return terminals.map((t) => {
    const sharing = terminals.filter((u) => u.side === t.side && u.unit === t.unit);
    const offset = (sharing.indexOf(t) - (sharing.length - 1) / 2) * PIN_SPACING_MM;
    return { id: t.id, x: (t.unit + 0.5) * MODULE_UNIT_MM + offset, y: t.side === 'top' ? TOP_PIN_Y_MM : BOTTOM_PIN_Y_MM };
  });
};

describe('the faces of the bundled devices', () => {
  it('keep every mark off the terminals, at every width a device can be made', () => {
    let checked = 0;
    const touching: string[] = [];
    for (const def of library.modules) {
      if (!def.art || SCREWS_UNDER_TERMINALS.has(def.kind)) continue;
      for (const width of widthsOf(def)) {
        const pins = pinsAt(def, width);
        for (const shape of placeArt(def.art, def.widthUnits, width)) {
          if (shape.kind === 'text' || (shape.kind === 'rect' && shape.width > 10)) continue;
          checked++;
          const box = boundsOf(shape);
          for (const pin of pins) {
            const gap = Math.hypot(Math.max(box.x1 - pin.x, 0, pin.x - box.x2), Math.max(box.y1 - pin.y, 0, pin.y - box.y2));
            if (gap < PIN_RADIUS_MM + CLEARANCE_MM) touching.push(`${def.id} at ${width} units: ${shape.kind} reaches ${pin.id}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(touching).toEqual([]);
  });
});
