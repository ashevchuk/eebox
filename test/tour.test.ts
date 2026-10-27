import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import { TOUR_STEPS } from '../src/ui/tour';

describe('the tour', () => {
  it('has steps that say what they are about', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(4);
    for (const step of TOUR_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.text.trim().length).toBeGreaterThan(20);
    }
    expect(new Set(TOUR_STEPS.map((s) => s.title)).size).toBe(TOUR_STEPS.length);
  });

  it('points only at elements that are on the page', () => {
    for (const step of TOUR_STEPS) expect(indexHtml, `#${step.target} in index.html`).toContain(`id="${step.target}"`);
  });
});
