import { describe, expect, it } from 'vitest';
import { MAX_ART_SHAPES, placeArt, type ArtShape } from '../src/library/art';
import { genericModules } from '../src/library/genericSeries';
import { MODULE_UNIT_MM, type ModuleDef } from '../src/library/types';

const modules = genericModules();
const FACE_HEIGHT_MM = 90;

/** The box a placed shape covers, ignoring the width of its line. */
function boxOf(shape: ArtShape): { x1: number; y1: number; x2: number; y2: number } {
  switch (shape.kind) {
    case 'line':
      return { x1: Math.min(shape.x1, shape.x2), y1: Math.min(shape.y1, shape.y2), x2: Math.max(shape.x1, shape.x2), y2: Math.max(shape.y1, shape.y2) };
    case 'rect':
      return { x1: shape.x, y1: shape.y, x2: shape.x + shape.width, y2: shape.y + shape.height };
    case 'ellipse':
      return { x1: shape.cx - shape.rx, y1: shape.cy - shape.ry, x2: shape.cx + shape.rx, y2: shape.cy + shape.ry };
    case 'polyline':
      return { x1: Math.min(...shape.points.map((p) => p[0])), y1: Math.min(...shape.points.map((p) => p[1])), x2: Math.max(...shape.points.map((p) => p[0])), y2: Math.max(...shape.points.map((p) => p[1])) };
    case 'text':
      return { x1: shape.x, y1: shape.y - shape.size / 2, x2: shape.x, y2: shape.y + shape.size / 2 };
  }
}

const widthsOf = (def: ModuleDef): number[] => [def.widthUnits, ...(def.resizable ? [def.resizable.minUnits, def.resizable.maxUnits] : [])];

describe('the faces of the bundled devices', () => {
  it('give every kind of device except a comb a face to tell it by', () => {
    const without = modules.filter((m) => !m.art).map((m) => m.kind);
    expect([...new Set(without)]).toEqual(['comb']);
  });

  it('are the same for devices of one series and differ between kinds, except an RCBO, which is told from an RCD by the colour of its band', () => {
    const artOf = (id: string) => JSON.stringify(modules.find((m) => m.id === id)?.art);
    expect(artOf('mcb-1p-c16')).toBe(artOf('mcb-1p-b10'));
    const faces = ['mcb-1p-c16', 'rcd-2p-40-30', 'main-switch-3p-63', 'contactor-3p-25-230', 'spd-t2-1p', 'kwh-1p-40', 'psu-24v-1a', 'vrelay-1p', 'n-bar-12', 'pe-bar-12', 'pen-split-12'].map(artOf);
    expect(new Set(faces).size).toBe(faces.length);
  });

  it('stay within the limits and inside the face at the base width of the device', () => {
    for (const def of modules) {
      expect(def.art?.length ?? 0).toBeLessThanOrEqual(MAX_ART_SHAPES);
      for (const shape of placeArt(def.art ?? [], def.widthUnits, def.widthUnits)) {
        const { x1, y1, x2, y2 } = boxOf(shape);
        expect([def.id, x1 >= -0.01, y1 >= -0.01, x2 <= def.widthUnits * MODULE_UNIT_MM + 0.01, y2 <= FACE_HEIGHT_MM + 0.01]).toEqual([def.id, true, true, true, true]);
      }
    }
  });

  it('keep what stands for the device inside the face at the narrowest and the widest copy too', () => {
    for (const def of modules.filter((m) => m.resizable && m.art)) {
      for (const units of widthsOf(def)) {
        for (const shape of placeArt(def.art!, def.widthUnits, units)) {
          if (shape.kind === 'text') continue;
          const { x1, x2 } = boxOf(shape);
          expect([def.id, units, x1 >= -0.01, x2 <= units * MODULE_UNIT_MM + 0.01]).toEqual([def.id, units, true, true]);
        }
      }
    }
  });

  it('give a bar the colour of its conductor and a screw for each unit', () => {
    const bar = modules.find((m) => m.id === 'n-bar-12')!;
    expect(bar.art?.some((s) => s.kind === 'rect' && s.fill === '#2f7de1' && s.anchor === 'stretch')).toBe(true);
    expect(placeArt(bar.art!, bar.widthUnits, 9).filter((s) => s.kind === 'ellipse' && s.cy === 7)).toHaveLength(9);
  });
});
