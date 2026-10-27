export const MIN_PANEL_PX = 180;
const MAX_PANEL_PX = 640;
/** What a side panel leaves for the drawing, however wide the panels are asked to be. */
const MIN_STAGE_PX = 360;
export const KEY_STEP_PX = 16;

/** A wanted width, brought into what the panel and the window allow; `other` is the width of the panel on the other side. */
export function clampPanelWidth(wanted: number, windowWidth: number, other: number): number {
  const room = windowWidth - other - MIN_STAGE_PX;
  const largest = Math.max(MIN_PANEL_PX, Math.min(MAX_PANEL_PX, room));
  return Math.round(Math.min(largest, Math.max(MIN_PANEL_PX, wanted)));
}

export interface ResizableSide {
  handle: HTMLElement;
  panel: HTMLElement;
  /** `left` panels grow when the handle moves right, `right` panels when it moves left. */
  side: 'left' | 'right';
  cssVariable: string;
  storageKey: string;
  defaultPx: number;
  /** The width of the panel on the other side, 0 when it is hidden. */
  otherWidth: () => number;
}

/** Makes the handle drag (or step, with the arrow keys) the width of its panel and keeps the width. */
export function makeResizable(options: ResizableSide): void {
  const { handle, panel, side, cssVariable, storageKey, defaultPx, otherWidth } = options;
  const apply = (px: number) => document.documentElement.style.setProperty(cssVariable, `${px}px`);
  const set = (wanted: number, keep: boolean) => {
    const width = clampPanelWidth(wanted, window.innerWidth, otherWidth());
    apply(width);
    if (!keep) return;
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      // The width then holds for this visit only.
    }
  };
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0) set(stored, false);
  } catch {
    // No stored width.
  }
  const widthAt = (clientX: number) => (side === 'left' ? clientX - panel.getBoundingClientRect().left : panel.getBoundingClientRect().right - clientX);
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (dragging) set(widthAt(e.clientX), false);
  });
  // Whichever of these ends the gesture first wins; the browser may release the capture before or without a pointerup.
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    set(panel.getBoundingClientRect().width, true);
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('dblclick', () => set(defaultPx, true));
  handle.addEventListener('keydown', (e) => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    set(panel.getBoundingClientRect().width + (e.key === grow ? KEY_STEP_PX : -KEY_STEP_PX), true);
  });
}
