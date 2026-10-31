import { inspect, type InspectContext } from './inspector';
import { selectedIds, selectedNodes, selectedWires } from './selection';

export interface MenuItem {
  /** What to do: `action:<key>` is an action of the inspector, `button:<id>` presses a button of the page, the rest are commands. */
  key: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
}
export type MenuEntry = MenuItem | 'separator';

export interface MenuContext extends InspectContext {
  canUndo: boolean;
  canRedo: boolean;
  hasClipboard: boolean;
}

/** Inspector actions that the Delete item already covers. */
const COVERED_BY_DELETE = new Set(['removeDuct']);

/** Only things worth doing to nodes that are chosen together, taken from the Nodes menu of the page. */
const NODE_GROUP_BUTTONS: ReadonlyArray<MenuItem> = [
  { key: 'button:chain-selected', label: 'Chain the selected nodes' },
  { key: 'button:feed-from-first', label: 'Feed the others from the first' },
  { key: 'button:align-left', label: 'Align left' },
  { key: 'button:align-centre', label: 'Align centre' },
  { key: 'button:align-right', label: 'Align right' },
];

const command = (key: string, label: string, shortcut?: string, disabled = false): MenuItem => ({ key, label, ...(shortcut ? { shortcut } : {}), ...(disabled ? { disabled } : {}) });

/** Joins the groups of items with one separator between them, leaving out the empty ones. */
function grouped(groups: ReadonlyArray<readonly MenuItem[]>): MenuEntry[] {
  return groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? [...g] : ['separator' as const, ...g]));
}

/**
 * What the context menu offers for what is selected in the view that is on: the actions of the inspector for
 * it, the commands that also have a key, and Undo and Redo last. The menu names no operation that the page
 * cannot already do; it makes them easy to find.
 */
export function contextMenuEntries(ctx: MenuContext): MenuEntry[] {
  const actions = inspect(ctx).actions.filter((a) => !COVERED_BY_DELETE.has(a.key)).map((a) => command(`action:${a.key}`, a.label));
  const undo = [command('undo', 'Undo', 'Ctrl+Z', !ctx.canUndo), command('redo', 'Redo', 'Ctrl+Shift+Z', !ctx.canRedo)];
  const { selection } = ctx;

  if (ctx.mode === 'panel') {
    const chosen = selectedIds(selection);
    const count = chosen.placements.length + chosen.combs.length + chosen.ducts.length;
    if (count > 0) {
      return grouped([actions, [command('copy', 'Copy', 'Ctrl+C'), command('duplicate', 'Duplicate', 'Ctrl+D')], [command('delete', 'Delete', 'Del')], undo]);
    }
    if (selection.rail !== undefined) return grouped([[command('duplicate-row', 'Duplicate the row')], undo]);
    if (selection.annotationId !== undefined) return grouped([actions, undo]);
    return grouped([[command('paste', 'Paste', 'Ctrl+V', !ctx.hasClipboard), command('select-all', 'Select all', 'Ctrl+A'), command('button:fit', 'Fit to the window')], undo]);
  }

  const nodes = selectedNodes(selection).length;
  const wires = selectedWires(selection).length;
  if (nodes > 0 || wires > 0) {
    return grouped([actions, nodes > 1 ? NODE_GROUP_BUTTONS : [], [command('delete', 'Delete', 'Del')], undo]);
  }
  if (selection.annotationId !== undefined) return grouped([actions, undo]);
  return grouped([[command('select-all', 'Select all', 'Ctrl+A'), command('button:sync-modules', 'Sync modules'), command('button:number-wires', 'Number the wires…'), command('button:fit', 'Fit to the window')], undo]);
}
