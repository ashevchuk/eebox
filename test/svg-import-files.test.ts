import { describe, expect, it } from 'vitest';
import { importSvg } from '../src/library/svgImport';

/** What editors write is not what a person types: namespaces, metadata, styles in attributes, nested groups with transforms. */
const INKSCAPE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->
<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:svg="http://www.w3.org/2000/svg"
     xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="20mm" height="40mm" viewBox="0 0 20 40" version="1.1" id="svg8">
  <defs id="defs2"><linearGradient id="g1"><stop offset="0" style="stop-color:#fff"/></linearGradient></defs>
  <sodipodi:namedview id="base" pagecolor="#ffffff" inkscape:zoom="2"/>
  <metadata id="metadata5"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><cc:Work rdf:about=""><dc:title/></cc:Work></rdf:RDF></metadata>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1" transform="translate(0,-257)">
    <g id="g20" transform="matrix(1,0,0,1,2,258)">
      <rect style="fill:#d1d5db;fill-opacity:1;stroke:#1f2937;stroke-width:0.5;stroke-linecap:round" id="rect10" width="16" height="30" x="0" y="0" ry="2" />
      <path style="fill:none;stroke:#cc0000;stroke-width:1.2px;stroke-linejoin:miter" d="m 8,6 v 10 l 4,6 z" id="path12" inkscape:connector-curvature="0" />
      <text xml:space="preserve" style="font-size:4px;line-height:1.25;font-family:sans-serif;font-weight:bold;text-anchor:middle;fill:#000000" x="8" y="28" id="text16"><tspan sodipodi:role="line" id="tspan14" x="8" y="28">QF1</tspan></text>
    </g>
  </g>
</svg>`;

describe('an SVG as an editor writes it', () => {
  it('is read through its namespaces, metadata and layers', () => {
    const result = importSvg(INKSCAPE, { widthMm: 20, leftMm: 0, topMm: 10, anchor: 'left', room: 32 });
    if (!result.ok) throw new Error(result.message);
    expect(result.shapes.map((s) => s.kind)).toEqual(['path', 'path', 'text']);
    expect(result.notes).toEqual([]);
  });

  it('puts every shape where the transforms of the layer and the group say', () => {
    const result = importSvg(INKSCAPE, { widthMm: 20, leftMm: 0, topMm: 10, anchor: 'left', room: 32 });
    if (!result.ok) throw new Error(result.message);
    const [body, line, text] = result.shapes;
    expect(body).toMatchObject({ fill: '#d1d5db', stroke: '#1f2937', strokeWidth: 0.5 });
    expect((body as { d: string }).d.startsWith('M 4 11')).toBe(true);
    expect(line).toMatchObject({ kind: 'path', d: 'M 10 17 L 10 27 L 14 33 Z', stroke: '#cc0000', strokeWidth: 1.2 });
    expect(text).toMatchObject({ kind: 'text', text: 'QF1', align: 'centre', bold: true, size: 4, fill: '#000000', x: 10 });
  });

  it('takes the millimetres of the width and height as a size and leaves the unit out of the scale', () => {
    const result = importSvg(INKSCAPE, { widthMm: 10, leftMm: 0, topMm: 0, anchor: 'left', room: 32 });
    expect(result.ok && result.heightMm).toBe(20);
  });
});
