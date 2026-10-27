import { describe, expect, it } from 'vitest';
import { MIN_PANEL_PX, clampPanelWidth } from '../src/ui/panelResize';

describe('panel width', () => {
  it('keeps a width that is allowed', () => {
    expect(clampPanelWidth(300, 1600, 270)).toBe(300);
  });

  it('does not let a panel get narrower than the minimum', () => {
    expect(clampPanelWidth(20, 1600, 270)).toBe(MIN_PANEL_PX);
  });

  it('does not let a panel grow past the largest', () => {
    expect(clampPanelWidth(5000, 4000, 270)).toBe(640);
  });

  it('leaves room for the drawing beside the other panel', () => {
    expect(clampPanelWidth(900, 1200, 300)).toBe(540);
  });

  it('keeps the minimum even in a window too narrow for everything', () => {
    expect(clampPanelWidth(400, 500, 300)).toBe(MIN_PANEL_PX);
  });

  it('rounds to whole pixels', () => {
    expect(clampPanelWidth(300.6, 1600, 270)).toBe(301);
  });
});
