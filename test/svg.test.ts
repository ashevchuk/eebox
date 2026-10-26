import { describe, expect, it } from 'vitest';
import { setPlacementLabel, setTerminalLabel } from '../src/layout/placement';
import { setPanelTitle, setRailLabel } from '../src/layout/panel';
import { takeOff } from '../src/layout/shelf';
import { nodeTerminalsLookup } from '../src/electrical/nodeTerminals';
import { PanelView } from '../src/ui/panelView';
import { SchematicView } from '../src/ui/schematicView';
import { Session } from '../src/ui/session';
import { SvgContext } from '../src/view/svgContext';
import { addNode, connect, emptySchematic, setWireLabel, syncModuleNodes } from '../src/schematic/model';
import { combAt, panelOf, place, resolve } from './fixtures';

const measure = (text: string, font: string) => text.length * (Number(/(\d+)px/.exec(font)?.[1] ?? 10) * 0.5);
const make = () => new SvgContext(200, 100, measure);

/** Every tag is closed in order, and no text or attribute carries a raw ampersand. */
function expectWellFormed(svg: string): void {
  const stack: string[] = [];
  for (const tag of svg.match(/<\/?[a-zA-Z][^>]*>/g) ?? []) {
    if (tag.startsWith('</')) expect(stack.pop()).toBe(tag.slice(2, -1));
    else if (!tag.endsWith('/>')) stack.push(/<([a-zA-Z]+)/.exec(tag)![1]!);
  }
  expect(stack).toEqual([]);
  expect(svg).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
}

describe('SvgContext primitives', () => {
  it('wraps the drawing in an svg of the given size', () => {
    const svg = make().toSvg();
    expect(svg).toContain('width="200" height="100" viewBox="0 0 200 100"');
    expectWellFormed(svg);
  });

  it('records a filled rectangle with its colour', () => {
    const ctx = make();
    ctx.fillStyle = '#14161d';
    ctx.fillRect(1, 2, 30, 40);
    expect(ctx.toSvg()).toContain('<rect x="1" y="2" width="30" height="40" fill="#14161d" stroke="none" transform="matrix(1 0 0 1 0 0)"/>');
  });

  it('splits rgba into a colour and an opacity', () => {
    const ctx = make();
    ctx.fillStyle = 'rgba(34, 197, 94, 0.55)';
    ctx.fillRect(0, 0, 1, 1);
    expect(ctx.toSvg()).toContain('fill="rgb(34,197,94)" fill-opacity="0.55"');
  });

  it('records a stroked rectangle and a stroked path with width, join and dash', () => {
    const ctx = make();
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.strokeRect(5, 6, 7, 8);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 0);
    ctx.lineTo(10, 10);
    ctx.stroke();
    const svg = ctx.toSvg();
    expect(svg).toContain('<rect x="5" y="6" width="7" height="8" fill="none" stroke="#f5c518" stroke-width="2" stroke-linejoin="round"');
    expect(svg).toContain('<path d="M0 0L10 0L10 10" fill="none" stroke="#f5c518" stroke-width="2" stroke-linejoin="round" stroke-dasharray="6 4"');
  });

  it('draws a full circle as two arcs and a partial arc as one', () => {
    const ctx = make();
    ctx.beginPath();
    ctx.arc(10, 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(10, 10, 5, 0, Math.PI / 2);
    ctx.stroke();
    const paths = ctx.toSvg().match(/<path d="([^"]+)"/g)!;
    expect(paths[0]!.match(/A/g)).toHaveLength(2);
    expect(paths[1]).toContain('A5 5 0 0 1 10 15');
  });

  it('records the rect path used for clipping', () => {
    const ctx = make();
    ctx.beginPath();
    ctx.rect(1, 2, 3, 4);
    ctx.fill();
    expect(ctx.toSvg()).toContain('d="M1 2h3v4h-3Z"');
  });

  it('applies the global alpha as opacity', () => {
    const ctx = make();
    ctx.globalAlpha = 0.35;
    ctx.fillRect(0, 0, 1, 1);
    expect(ctx.toSvg()).toContain('opacity="0.35"');
  });
});

describe('SvgContext transforms and state', () => {
  const matrixOf = (svg: string) =>
    /matrix\(([^)]+)\)/.exec(svg)![1]!.split(' ').map(Number);

  it('composes translate and scale in canvas order', () => {
    const ctx = make();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(10, 20);
    ctx.scale(2, 2);
    ctx.fillRect(0, 0, 1, 1);
    expect(matrixOf(ctx.toSvg())).toEqual([2, 0, 0, 2, 10, 20]);
  });

  it('rotates a quarter turn anticlockwise like the vertical labels', () => {
    const ctx = make();
    ctx.translate(5, 7);
    ctx.rotate(-Math.PI / 2);
    ctx.fillRect(0, 0, 1, 1);
    const [a, b, c, d, e, f] = matrixOf(ctx.toSvg());
    expect([a, b, c, d].map((v) => Math.round(v! * 1000) / 1000 + 0)).toEqual([0, -1, 1, 0]);
    expect([e, f]).toEqual([5, 7]);
  });

  it('restores the transform and the style that save stored', () => {
    const ctx = make();
    ctx.fillStyle = 'red';
    ctx.save();
    ctx.translate(100, 100);
    ctx.fillStyle = 'blue';
    ctx.restore();
    ctx.fillRect(0, 0, 1, 1);
    const svg = ctx.toSvg();
    expect(svg).toContain('fill="red"');
    expect(matrixOf(svg)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('ignores a restore without a save', () => {
    const ctx = make();
    expect(() => ctx.restore()).not.toThrow();
  });
});

describe('SvgContext clipping', () => {
  it('opens a group for a clip and closes it at the matching restore', () => {
    const ctx = make();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 10, 10);
    ctx.clip();
    ctx.fillRect(1, 1, 2, 2);
    ctx.restore();
    ctx.fillRect(50, 50, 2, 2);
    const svg = ctx.toSvg();
    expectWellFormed(svg);
    expect(svg).toMatch(/<clipPath id="clip1"><path d="M0 0h10v10h-10Z"/);
    expect(svg.indexOf('</g>')).toBeLessThan(svg.indexOf('x="50"'));
  });

  it('closes groups that were left open', () => {
    const ctx = make();
    ctx.beginPath();
    ctx.rect(0, 0, 1, 1);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(0, 0, 1, 1);
    ctx.clip();
    expectWellFormed(ctx.toSvg());
  });

  it('numbers clips so that they never collide', () => {
    const ctx = make();
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 1, 1);
      ctx.clip();
      ctx.restore();
    }
    expect(ctx.toSvg().match(/id="clip\d"/g)).toEqual(['id="clip1"', 'id="clip2"', 'id="clip3"']);
  });
});

describe('SvgContext text', () => {
  it('maps alignment, baseline, size, weight and family', () => {
    const ctx = make();
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Hall', 3, 4);
    expect(ctx.toSvg()).toContain(
      '<text x="3" y="4" font-size="14" font-family="sans-serif" font-weight="bold" text-anchor="middle" dominant-baseline="central"',
    );
  });

  it('uses canvas defaults when nothing was set', () => {
    const ctx = make();
    ctx.fillText('x', 0, 0);
    expect(ctx.toSvg()).toContain('text-anchor="start" dominant-baseline="alphabetic"');
  });

  it('escapes markup in text, so a hostile label cannot inject elements or attributes', () => {
    const ctx = make();
    ctx.fillText('<script>alert(1)</script> & "quotes" \'ticks\'', 0, 0);
    const svg = ctx.toSvg();
    expect(svg).not.toContain('<script');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; &apos;ticks&apos;');
    expectWellFormed(svg);
  });

  it('measures text with the measuring function for the current font', () => {
    const ctx = make();
    ctx.font = '8px sans-serif';
    expect(ctx.measureText('abcd').width).toBe(16);
  });
});

describe('the views drawn through SvgContext', () => {
  function sessionWithPanel(): Session {
    const session = new Session();
    session.libraries = [];
    const panel0 = panelOf(
      [place('p1', 'breaker16', 0, 0), place('p2', 'mcb3', 0, 4), place('p3', 'nbar', 0, 10)],
      [combAt('c1', 'comb1', 0, 0)],
      [24, 24],
    );
    const steps: Array<(p: typeof panel0) => typeof panel0> = [
      (p) => { const r = setPanelTitle(p, 'Flat <12> & co'); if (!r.ok) throw new Error(); return r.panel; },
      (p) => { const r = setRailLabel(p, 0, 'Final circuits'); if (!r.ok) throw new Error(); return r.panel; },
      (p) => { const r = setPlacementLabel(p, 'p1', 'Kitchen'); if (!r.ok) throw new Error(); return r.panel; },
      (p) => { const r = setTerminalLabel(p, 'p3', 'top:N1', 'Hall N'); if (!r.ok) throw new Error(); return r.panel; },
    ];
    const panel = steps.reduce((p, step) => step(p), panel0);
    let schematic = syncModuleNodes(emptySchematic(), panel, (r) => r.moduleId);
    schematic = addNode(schematic, { kind: 'source', label: 'Mains', x: 0, y: -150, conductors: ['L1', 'N'] }).schematic;
    const wired = connect(schematic, nodeTerminalsLookup(panel, resolve), { node: 'n4', terminal: 'bottom:L1' }, { node: 'n1', terminal: 'top:L' });
    if (!wired.ok) throw new Error(wired.error.kind);
    const labelled = setWireLabel(wired.schematic, 'w1', 'NYM 3x2.5');
    if (!labelled.ok) throw new Error(labelled.error.kind);
    session.reset({ panel, schematic: labelled.schematic });
    return session;
  }

  // Session.resolve reads libraries; give it the fixture modules through the snapshot instead.
  function exported(mode: 'panel' | 'schematic'): string {
    const session = sessionWithPanel();
    const original = session.resolve;
    (session as { resolve: typeof original }).resolve = resolve;
    const view = mode === 'panel' ? new PanelView(session) : new SchematicView(session);
    const svg = new SvgContext(900, 600, measure);
    view.draw(svg as unknown as CanvasRenderingContext2D, 900, 600, 1);
    return svg.toSvg();
  }

  it('exports the panel with its title, labels and terminals, well formed', () => {
    const svg = exported('panel');
    expectWellFormed(svg);
    expect(svg).toContain('Flat &lt;12&gt; &amp; co');
    expect(svg).toContain('Final circuits');
    expect(svg).toContain('>Kitchen<');
    expect(svg).not.toContain('<12>');
  });

  it('shortens a label that does not fit under its module, instead of running into the next row', () => {
    const session = sessionWithPanel();
    (session as { resolve: typeof resolve }).resolve = resolve;
    const labelled = setPlacementLabel(session.project.panel, 'p1', 'A very long circuit description');
    if (!labelled.ok) throw new Error(labelled.error.kind);
    session.commit({ ...session.project, panel: labelled.panel });
    const svg = new SvgContext(900, 600, measure);
    new PanelView(session).draw(svg as unknown as CanvasRenderingContext2D, 900, 600, 1);
    const out = svg.toSvg();
    expect(out).not.toContain('A very long circuit description');
    expect(out).toMatch(/>A very[^<]*…</);
  });

  it('exports the schematic with node, terminal and wire labels, well formed', () => {
    const svg = exported('schematic');
    expectWellFormed(svg);
    expect(svg).toContain('>Kitchen<');
    expect(svg).toContain('NYM 3x2.5');
    expect(svg).toContain('Hall N');
    expect(svg).toContain('Mains');
  });

  it('shows a shelved module on the schematic as being on the shelf', () => {
    const session = sessionWithPanel();
    (session as { resolve: typeof resolve }).resolve = resolve;
    const taken = takeOff(session.project.panel, 'p2');
    if (!taken.ok) throw new Error(taken.error.kind);
    session.commit({ ...session.project, panel: taken.panel });
    const svg = new SvgContext(900, 600, measure);
    new SchematicView(session).draw(svg as unknown as CanvasRenderingContext2D, 900, 600, 1);
    expect(svg.toSvg()).toContain('(on the shelf)');
  });
});

describe('SvgContext id prefix', () => {
  const clipped = (prefix?: string) => {
    const ctx = new SvgContext(100, 100, () => 0, prefix);
    ctx.beginPath();
    ctx.rect(0, 0, 10, 10);
    ctx.clip();
    return ctx.toSvg();
  };

  it('puts the prefix on the clip id and on the reference to it', () => {
    const svg = clipped('schematic-');
    expect(svg).toContain('<clipPath id="schematic-clip1">');
    expect(svg).toContain('clip-path="url(#schematic-clip1)"');
  });

  it('gives two drawings on one page ids that do not collide', () => {
    const ids = (svg: string) => svg.match(/id="[^"]+"/g);
    expect(ids(clipped('panel-'))).not.toEqual(ids(clipped('schematic-')));
  });

  it('keeps the plain ids without a prefix', () => {
    expect(clipped()).toContain('<clipPath id="clip1">');
  });
});
