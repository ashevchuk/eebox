import { describe, expect, it } from 'vitest';
import { MAX_ART_SHAPES, type ArtShape } from '../src/library/art';
import { genericModules } from '../src/library/genericSeries';
import { artToSvg } from '../src/library/svgExport';
import { importSvg } from '../src/library/svgImport';
import type { ModuleDef } from '../src/library/types';
import { parseXml } from '../src/library/xml';

const shapes: ArtShape[] = [
  { kind: 'rect', x: 2, y: 3, width: 10.5, height: 20, fill: '#112233', stroke: '#445566', strokeWidth: 0.4 },
  { kind: 'ellipse', cx: 20, cy: 30, rx: 4, ry: 2.5, fill: '#abcdef', strokeWidth: undefined, anchor: 'centre' },
  { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 12.25, stroke: '#000000', strokeWidth: 1.5, anchor: 'right' },
  { kind: 'polyline', points: [[1, 1], [5, 1], [3, 6]], closed: true, fill: '#cc0000', anchor: 'stretch' },
  { kind: 'polyline', points: [[1, 40], [5, 45], [9, 40]], stroke: '#003399', strokeWidth: 0.5 },
  { kind: 'path', d: 'M 2 60 C 2 70 12 70 12 60 Z', fill: '#00aa00', stroke: '#005500', strokeWidth: 0.3, anchor: 'tile', period: 1 },
  { kind: 'text', x: 17.5, y: 80, text: 'A<B> & "C"', size: 4.5, fill: '#222222', align: 'centre', bold: true },
  { kind: 'text', x: 3, y: 85, text: 'left', size: 3, fill: '#222222' },
  { kind: 'text', x: 30, y: 85, text: 'right', size: 3, fill: '#222222', align: 'right', anchor: 'right' },
];
const module = (art: ArtShape[], widthUnits = 2): ModuleDef => ({ id: 'm', kind: 'other', name: 'Test <module> & "co"', widthUnits, poles: 1, art });
const clean = (list: ArtShape[]) => JSON.parse(JSON.stringify(list)) as ArtShape[];

describe('the art of a module as an SVG', () => {
  it('is a document in millimetres the size of the face', () => {
    const svg = artToSvg(module(shapes, 3));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="52.5mm" height="90mm" viewBox="0 0 52.5 90">')).toBe(true);
    expect(svg.endsWith('</svg>\n')).toBe(true);
  });

  it('is well formed, with the name and the text escaped', () => {
    const parsed = parseXml(artToSvg(module(shapes)));
    expect(parsed.ok).toBe(true);
    expect(artToSvg(module(shapes))).toContain('<title>Test &lt;module&gt; &amp; &quot;co&quot;</title>');
    expect(artToSvg(module(shapes))).toContain('>A&lt;B&gt; &amp; &quot;C&quot;</text>');
    expect(artToSvg(module(shapes))).not.toContain('A<B>');
  });

  it('says how each shape follows the width, in attributes of its own', () => {
    const svg = artToSvg(module(shapes));
    expect(svg).toContain('data-anchor="centre"');
    expect(svg).toContain('data-anchor="stretch"');
    expect(svg).toContain('data-anchor="tile" data-period="1"');
    expect(svg.match(/data-anchor/g)).toHaveLength(5);
  });

  it('draws nothing where there is nothing, and a fill that is not there is none', () => {
    expect(artToSvg({ ...module([]), art: undefined })).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="35mm" height="90mm" viewBox="0 0 35 90">\n<title>Test &lt;module&gt; &amp; &quot;co&quot;</title>\n</svg>\n');
    expect(artToSvg(module([{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1, stroke: '#000000' }]))).toContain('fill="none" stroke="#000000"');
  });

  it('comes back as the same shapes when it is imported with the width it was exported at', () => {
    const def = module(shapes);
    const result = importSvg(artToSvg(def), { widthMm: 35, leftMm: 0, topMm: 0, anchor: 'left', room: MAX_ART_SHAPES });
    if (!result.ok) throw new Error(result.message);
    expect(result.notes).toEqual([]);
    expect(clean(result.shapes)).toEqual(clean(shapes.map((s) => (s.kind === 'ellipse' ? { ...s, strokeWidth: undefined } : s)).map((s) => ({ ...s, ...(s.stroke !== undefined && s.strokeWidth === undefined ? { strokeWidth: 0.5 } : {}) }))));
  });

  it('comes back from a module of another width onto a face of a different size, scaled and moved, with the anchors kept', () => {
    const def = module([{ kind: 'rect', x: 0, y: 10, width: 17.5, height: 10, fill: '#000000', anchor: 'stretch' }], 1);
    const result = importSvg(artToSvg(def), { widthMm: 35, leftMm: 5, topMm: 0, anchor: 'left', room: 32 });
    if (!result.ok) throw new Error(result.message);
    expect(result.shapes[0]).toMatchObject({ kind: 'rect', x: 5, y: 20, width: 35, height: 20, anchor: 'stretch' });
  });

  it('is read back for every bundled device with a face, shape for shape', () => {
    for (const def of genericModules().filter((m) => m.art)) {
      const width = def.widthUnits * 17.5;
      const result = importSvg(artToSvg(def), { widthMm: width, leftMm: 0, topMm: 0, anchor: 'left', room: MAX_ART_SHAPES });
      if (!result.ok) throw new Error(`${def.id}: ${result.message}`);
      expect([def.id, result.shapes.map((s) => s.kind)]).toEqual([def.id, def.art!.map((s) => s.kind)]);
    }
  });
});
