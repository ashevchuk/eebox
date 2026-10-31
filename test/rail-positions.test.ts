import { describe, expect, it } from 'vitest';
import { FIRST_RAIL_Y_MM } from '../src/layout/limits';
import { createPanel, setRailPosition } from '../src/layout/panel';
import type { Panel } from '../src/layout/placement';
import { MODULE_UNIT_MM } from '../src/library/types';
import { diffProjects } from '../src/project/diff';
import { buildProjectFile, parseProjectJson } from '../src/project/file';
import { emptySchematic } from '../src/schematic/model';
import {
  FRAME_PADDING,
  ROW_MARGIN,
  frameRect,
  labelRoom,
  moduleRect,
  railAtPoint,
  railCenterY,
  railRect,
  rowLabelX,
  snapToSlot,
} from '../src/view/geometry';
import { DEFAULT_PLATE_ID } from '../src/layout/plates';
import { fitPlate } from '../src/view/plateFit';
import { resolve, sizes } from './fixtures';

const GAP_MM = 40;
const unwrap = (result: ReturnType<typeof setRailPosition>): Panel => {
  if (!result.ok) throw new Error(result.error);
  return result.panel;
};

/** Two rails of 6 units in one row, the second one 40 mm to the right of the first. */
const sideBySide = (): Panel => {
  const panel = createPanel([6, 6]);
  return unwrap(setRailPosition(panel, 1, 6 * MODULE_UNIT_MM + GAP_MM, FIRST_RAIL_Y_MM));
};

describe('rails with their own position', () => {
  it('draws a rail where its x and y put it', () => {
    const panel = unwrap(setRailPosition(createPanel([6]), 0, 30, 200));
    expect(railRect(panel, 0)).toMatchObject({ x: FRAME_PADDING + 30, width: 6 * MODULE_UNIT_MM });
    expect(railCenterY(panel, 0)).toBe(FRAME_PADDING + 200);
  });

  it('starts the modules of a rail at the left end of that rail', () => {
    const panel = sideBySide();
    expect(moduleRect(panel, 1, 2, 1, 90).x).toBe(railRect(panel, 1).x + 2 * MODULE_UNIT_MM);
  });

  it('fits a plate to the farthest end of a rail and the lowest rail', () => {
    const fitted = fitPlate(sideBySide(), DEFAULT_PLATE_ID, sizes);
    if (!fitted.ok) throw new Error(fitted.error);
    expect(frameRect(fitted.panel).width).toBe(12 * MODULE_UNIT_MM + GAP_MM + 2 * FRAME_PADDING);
    expect(frameRect(fitted.panel).height).toBe(FRAME_PADDING + FIRST_RAIL_Y_MM + ROW_MARGIN + FRAME_PADDING);
  });

  it('puts the label of a row in the margin to the left of that row', () => {
    const panel = sideBySide();
    expect(rowLabelX(panel, 1)).toBe(railRect(panel, 1).x - FRAME_PADDING / 2);
  });
});

describe('rails standing side by side', () => {
  it('finds the rail under the pointer, not the first one in the row', () => {
    const panel = sideBySide();
    const second = railRect(panel, 1);
    expect(railAtPoint(panel, { x: second.x + 10, y: railCenterY(panel, 1) })).toBe(1);
  });

  it('snaps a drop to the rail it is over', () => {
    const panel = sideBySide();
    const second = railRect(panel, 1);
    expect(snapToSlot(panel, { x: second.x + 3 * MODULE_UNIT_MM, y: railCenterY(panel, 1) }, 1, 0)).toEqual({ rail: 1, slot: 3 });
  });

  it('gives a drop past the end of the last rail to that rail, clamped inward', () => {
    const panel = sideBySide();
    const second = railRect(panel, 1);
    expect(snapToSlot(panel, { x: second.x + second.width + 200, y: railCenterY(panel, 1) }, 2, 0)).toEqual({ rail: 1, slot: 4 });
  });

  it('does not let a rail below take room from a label that stands beside it', () => {
    const stacked = createPanel([6, 6]);
    const beside = sideBySide();
    expect(labelRoom(beside, 0, 90)).toBeGreaterThan(labelRoom(stacked, 0, 90));
  });
});

describe('rails in a project file', () => {
  it('keep their position and label through saving and loading', () => {
    const panel = unwrap(setRailPosition(createPanel([6, 6]), 1, 150, 300));
    const labelled: Panel = { ...panel, rails: panel.rails.map((r, i) => (i === 1 ? { ...r, label: 'Door' } : r)) };
    const file = buildProjectFile({ panel: labelled, schematic: emptySchematic() }, resolve);
    const parsed = parseProjectJson(JSON.stringify(file));
    expect(parsed.ok && parsed.file.project.panel.rails).toEqual(labelled.rails);
  });
});

describe('comparing rail positions', () => {
  it('reports a row that moved', () => {
    const before = buildProjectFile({ panel: createPanel([6]), schematic: emptySchematic() }, resolve);
    const moved = unwrap(setRailPosition(createPanel([6]), 0, 25, 180));
    const after = buildProjectFile({ panel: moved, schematic: emptySchematic() }, resolve);
    const lines = diffProjects(before, after).map((d) => `${d.area}/${d.kind}: ${d.text}`);
    expect(lines).toContain(`rows/changed: row 1: position 0, ${FIRST_RAIL_Y_MM} → 25, 180 mm`);
  });
});
