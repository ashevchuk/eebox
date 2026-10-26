import { MODULE_UNIT_MM, type ModuleDef, type ModuleKind } from '../library/types';
import type { ModuleRef, Panel } from '../layout/placement';
import type { Camera } from './Camera';
import { frameRect, moduleRect, railRect, type Rect } from './geometry';

export interface Ghost {
  module: ModuleDef;
  rail: number;
  slot: number;
  valid: boolean;
}

export interface Scene {
  panel: Panel;
  resolve: (ref: ModuleRef) => ModuleDef | undefined;
  selection: string | null;
  /** Placement currently being dragged; drawn dimmed at its old position. */
  movingId: string | null;
  ghost: Ghost | null;
}

export const LEVER_COLORS: Record<ModuleKind, string> = {
  breaker: '#2563eb',
  rcd: '#16a34a',
  rcbo: '#0d9488',
  contactor: '#9333ea',
  spd: '#dc2626',
  meter: '#475569',
  psu: '#ca8a04',
  terminal: '#78716c',
  switch: '#ea580c',
  relay: '#7c3aed',
  other: '#64748b',
};

const COLORS = {
  background: '#0b0c10',
  frame: '#2a2f3b',
  frameFill: '#14161d',
  rail: '#9aa1b3',
  body: '#e5e7eb',
  text: '#14161d',
  missing: '#7f1d1d',
  selection: '#f5c518',
  ghostOk: 'rgba(34, 197, 94, 0.55)',
  ghostBad: 'rgba(239, 68, 68, 0.55)',
};

function fillRect(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.width, r.height);
}

function drawLabel(ctx: CanvasRenderingContext2D, def: ModuleDef, r: Rect): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rating = def.ratedCurrentA === undefined ? '' : `${def.curve ?? ''}${def.ratedCurrentA}`;
  if (rating) {
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText(rating, r.x + r.width / 2, r.y + 22);
  }
  ctx.translate(r.x + r.width / 2, r.y + r.height / 2 + 12);
  ctx.rotate(-Math.PI / 2);
  ctx.font = '6px sans-serif';
  ctx.fillText(def.name, 0, 0);
  ctx.restore();
}

function drawModule(
  ctx: CanvasRenderingContext2D,
  def: ModuleDef | undefined,
  rail: number,
  slot: number,
): void {
  const r = moduleRect(rail, slot, def?.widthUnits ?? 1);
  if (!def) {
    fillRect(ctx, r, COLORS.missing);
    return;
  }
  fillRect(ctx, r, COLORS.body);
  fillRect(ctx, { ...r, height: 14 }, LEVER_COLORS[def.kind]);
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 0.6;
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  drawLabel(ctx, def, r);
}

export function render(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  scene: Scene,
  viewportW: number,
  viewportH: number,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, viewportW, viewportH);

  ctx.translate(viewportW / 2 - camera.x * camera.scale, viewportH / 2 - camera.y * camera.scale);
  ctx.scale(camera.scale, camera.scale);

  const { panel } = scene;
  const frame = frameRect(panel);
  fillRect(ctx, frame, COLORS.frameFill);
  ctx.strokeStyle = COLORS.frame;
  ctx.lineWidth = 2;
  ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

  panel.railLengthsUnits.forEach((_length, rail) => {
    const r = railRect(panel, rail);
    fillRect(ctx, r, COLORS.rail);
    ctx.fillStyle = COLORS.frameFill;
    for (let unit = 0; unit < r.width / MODULE_UNIT_MM; unit++) {
      ctx.fillRect(r.x + unit * MODULE_UNIT_MM + MODULE_UNIT_MM / 2 - 3, r.y + r.height / 2 - 1.5, 6, 3);
    }
  });

  for (const placement of panel.placements) {
    ctx.globalAlpha = placement.id === scene.movingId ? 0.35 : 1;
    drawModule(ctx, scene.resolve(placement.module), placement.rail, placement.slot);
    if (placement.id === scene.selection) {
      const r = moduleRect(placement.rail, placement.slot, scene.resolve(placement.module)?.widthUnits ?? 1);
      ctx.strokeStyle = COLORS.selection;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
    }
  }
  ctx.globalAlpha = 1;

  if (scene.ghost) {
    const { module, rail, slot, valid } = scene.ghost;
    fillRect(ctx, moduleRect(rail, slot, module.widthUnits), valid ? COLORS.ghostOk : COLORS.ghostBad);
  }
}
