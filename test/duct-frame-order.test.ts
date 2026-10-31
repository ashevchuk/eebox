import { describe, expect, it } from 'vitest';
import { PanelView } from '../src/ui/panelView';
import { Session } from '../src/ui/session';
import { SvgContext } from '../src/view/svgContext';
import { placementRect } from '../src/view/geometry';
import { panelOf, place, resolve, sizes } from './fixtures';

const measure = (text: string) => text.length * 5;

/** A module that stands on a duct: modules are drawn after ducts, so it would cover the edge of the duct's frame. */
function drawn(): { svg: string; moduleX: number } {
  const session = new Session();
  (session as { resolve: typeof resolve }).resolve = resolve;
  const base = panelOf([place('p1', 'breaker16', 0, 2)], [], [12]);
  const module = placementRect(base, sizes, base.placements[0]!);
  const duct = { id: 'd1', plate: base.plates[0]!.id, x: module.x - 40 - 40, y: module.y - 40 + 20, widthMm: 200, heightMm: 60 };
  const panel = { ...base, ducts: [duct] };
  session.commit({ ...session.project, panel });
  session.select({ ductId: 'd1' });
  const ctx = new SvgContext(900, 600, measure);
  const view = new PanelView(session);
  view.draw(ctx as unknown as CanvasRenderingContext2D, 900, 600, 1);
  return { svg: ctx.toSvg(), moduleX: module.x };
}

describe('the frame of a selected duct', () => {
  it('is drawn over a module that stands on the duct', () => {
    const { svg, moduleX } = drawn();
    const frame = svg.indexOf('stroke="#f5c518"');
    expect(frame).toBeGreaterThan(-1);
    const bodies = [...svg.matchAll(/<rect x="([\d.-]+)"/g)].filter((m) => Math.abs(Number(m[1]) - moduleX) < 0.01);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.index!).toBeLessThan(frame);
  });
});
