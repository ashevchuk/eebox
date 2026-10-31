import { describe, expect, it } from 'vitest';
import { placementRect } from '../src/view/geometry';
import { PanelView } from '../src/ui/panelView';
import { Session } from '../src/ui/session';
import { SvgContext } from '../src/view/svgContext';
import { panelOf, place, resolve, sizes } from './fixtures';

const measure = (text: string) => text.length * 5;

/** Two modules side by side: the first is drawn before the second, which stands against its right edge. */
function drawn(selectedId: string): { svg: string; panelRects: ReturnType<typeof placementRect>[] } {
  const session = new Session();
  (session as { resolve: typeof resolve }).resolve = resolve;
  const panel = panelOf([place('p1', 'breaker16', 0, 2), place('p2', 'breaker16', 0, 3)], [], [12]);
  session.commit({ ...session.project, panel });
  session.select({ placementId: selectedId });
  const ctx = new SvgContext(900, 600, measure);
  new PanelView(session).draw(ctx as unknown as CanvasRenderingContext2D, 900, 600, 1);
  return { svg: ctx.toSvg(), panelRects: panel.placements.map((p) => placementRect(panel, sizes, p)) };
}

const SELECTION = 'stroke="#f5c518"';

describe('the frame of a selected module', () => {
  it('is drawn over the module that stands against it, even when that one is drawn later', () => {
    const { svg, panelRects } = drawn('p1');
    const frame = svg.indexOf(SELECTION);
    expect(frame).toBeGreaterThan(-1);
    const neighbour = panelRects[1]!;
    const bodies = [...svg.matchAll(/<rect x="([\d.-]+)"/g)].filter((m) => Math.abs(Number(m[1]) - neighbour.x) < 0.01);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.index!).toBeLessThan(frame);
  });

  it('is not drawn for a module that is not selected', () => {
    expect(drawn('p1').svg.split(SELECTION).length).toBe(2);
  });
});
