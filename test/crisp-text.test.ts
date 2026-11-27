import { describe, expect, it } from 'vitest';
import { crispText } from '../src/view/crispText';

/** A context that records what it is asked, with a font whose letters are 0.6 of its size wide. */
function fake() {
  const calls: string[] = [];
  let scale = 1;
  const stack: Array<{ font: string; scale: number }> = [];
  const ctx = {
    font: '10px sans',
    fillText: (text: string, x: number, y: number, maxWidth?: number) => void calls.push(`fill ${text} ${x},${y} font=${ctx.font} scale=${scale}${maxWidth === undefined ? '' : ` max=${maxWidth}`}`),
    measureText: (text: string) => ({ width: text.length * 0.6 * Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)![1]) }) as TextMetrics,
    save: () => void stack.push({ font: ctx.font, scale }),
    restore: () => {
      const top = stack.pop()!;
      ctx.font = top.font;
      scale = top.scale;
    },
    translate: (x: number, y: number) => void calls.push(`translate ${x},${y}`),
    scale: (k: number) => void (scale *= k),
  };
  return { ctx, calls };
}

describe('crisp text', () => {
  it('draws small text ten times larger at a tenth of the scale, where it stood, and leaves the font as it was', () => {
    const { ctx, calls } = fake();
    crispText(ctx);
    ctx.font = 'bold 5px eebox-sans';
    ctx.fillText('QS1', 3, 4, 20);
    expect(calls).toEqual(['translate 3,4', 'fill QS1 0,0 font=bold 50px eebox-sans scale=0.1 max=200']);
    expect(ctx.font).toBe('bold 5px eebox-sans');
  });

  it('measures small text at the large size and scales the width back', () => {
    const { ctx } = fake();
    crispText(ctx);
    ctx.font = '8px x';
    expect(ctx.measureText('abcd').width).toBeCloseTo(4 * 0.6 * 8);
    expect(ctx.font).toBe('8px x');
  });

  it('leaves text of 16 px and more, and fonts without a pixel size, as they are', () => {
    const { ctx, calls } = fake();
    crispText(ctx);
    ctx.font = '16px x';
    ctx.fillText('big', 1, 2);
    ctx.font = '1em x';
    ctx.fillText('em', 1, 2);
    expect(calls).toEqual(['fill big 1,2 font=16px x scale=1', 'fill em 1,2 font=1em x scale=1']);
  });
});

describe('crisp text on a context asked for every frame', () => {
  it('wraps a context once, however often it is asked', () => {
    const { ctx, calls } = fake();
    crispText(crispText(crispText(ctx)));
    ctx.font = '5px x';
    ctx.fillText('a', 0, 0);
    expect(calls).toEqual(['translate 0,0', 'fill a 0,0 font=50px x scale=0.1']);
  });
});
