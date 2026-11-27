import { describe, expect, it } from 'vitest';
import raw from '../libraries/generic-iec.json?raw';
import type { Library, ModuleDef } from '../src/library/types';
import { MODULE_UNIT_MM } from '../src/library/types';
import { REF_HEIGHT_MM, REF_CENTRE_Y_MM, refStickerSpot } from '../src/view/refSticker';

const modules = (JSON.parse(raw) as Library).modules;
const spot = (def: ModuleDef) => refStickerSpot(def, def.widthUnits, def.widthUnits * MODULE_UNIT_MM, def.heightMm, 8);

describe('where the designation sticker stands', () => {
  it('stands under the rating, in the middle, on every bundled device, covering none of its face drawing', () => {
    for (const def of modules.filter((m) => m.kind !== 'busbar' && m.kind !== 'comb' && m.kind !== 'terminal')) {
      for (const width of [5, 8, 12]) expect(refStickerSpot(def, def.widthUnits, def.widthUnits * MODULE_UNIT_MM, def.heightMm, width), `${def.id} ${width}`).toEqual({ x: (def.widthUnits * MODULE_UNIT_MM) / 2, y: REF_CENTRE_Y_MM, covers: false });
    }
  });

  it('moves aside, then down, on a face that is drawn on under the rating', () => {
    const base: ModuleDef = { id: 'x', kind: 'other', name: 'X', widthUnits: 2, heightMm: 90, mounting: 'rail', poles: 1, terminals: [{ name: 'L', conductor: 'L', side: 'top' }] };
    const middle = refStickerSpot({ ...base, art: [{ kind: 'rect', x: 14, y: 26, width: 7, height: 10, fill: '#000000' }] }, 2, 35, 90, 8);
    expect(middle).toMatchObject({ y: REF_CENTRE_Y_MM, covers: false });
    expect(middle.x).not.toBe(17.5);
    const across = refStickerSpot({ ...base, art: [{ kind: 'rect', x: 1, y: 26, width: 33, height: 10, fill: '#000000' }] }, 2, 35, 90, 8);
    expect(across).toEqual({ x: 17.5, y: 75, covers: false });
  });

  it('takes the row of the bottom terminals on a module that has none, when the rest is drawn on', () => {
    const def: ModuleDef = {
      id: 'x', kind: 'other', name: 'X', widthUnits: 1, heightMm: 90, mounting: 'rail', poles: 1,
      terminals: [{ name: 'L', conductor: 'L', side: 'top' }],
      art: [26, 70].map((y) => ({ kind: 'rect' as const, x: 0, y, width: 17.5, height: 10, fill: '#000000' })),
    };
    const lamp = spot(def);
    expect(lamp).toEqual({ x: 8.75, y: 84, covers: false });
    expect(lamp.y + REF_HEIGHT_MM / 2).toBeLessThanOrEqual(90);
  });

  it('keeps the first place when the whole face is drawn on, and says it covers it', () => {
    const def: ModuleDef = { id: 'x', kind: 'other', name: 'X', widthUnits: 1, heightMm: 90, mounting: 'rail', poles: 1, art: Array.from({ length: 9 }, (_, i) => ({ kind: 'rect' as const, x: 0, y: i * 10, width: 17.5, height: 9.5, fill: '#000000' })) };
    expect(spot(def)).toEqual({ x: 8.75, y: REF_CENTRE_Y_MM, covers: true });
  });
});
