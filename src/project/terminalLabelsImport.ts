import type { Resolve } from '../electrical/context';
import { terminalsOf } from '../electrical/terminals';
import { normalizeLabel } from '../layout/labels';
import type { Panel, Placement } from '../layout/placement';
import { parseCsv } from '../library/csvImport';
import type { Project } from '../project';

/** At most this many terminal labels on one module; the project file refuses more. */
export const MAX_TERMINAL_LABELS_PER_MODULE = 64;
/** How many skipped rows are told one by one. */
export const SKIPPED_SHOWN = 5;

export type TerminalLabelsImport =
  | { ok: true; panel: Panel; set: number; cleared: number; skipped: string[] }
  | { ok: false; error: string };

const COLUMNS = ['device', 'terminal', 'label'] as const;

/**
 * Reads a table of `Device`, `Terminal` and `Label` and sets the label of that terminal of every module that
 * has that label or name; a blank label takes the terminal's label away. A terminal is named by its name, such as
 * DI3, or by its id, such as top:L1, which is needed when a module has the same name on both sides. Rows that
 * do not fit are skipped, with the reason, and the rest are applied. The columns after the third are ignored,
 * so the file written by *Inputs and outputs (CSV)* can be filled in and read back.
 */
export function importTerminalLabels(text: string, project: Project, resolve: Resolve): TerminalLabelsImport {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ''));
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  const columns = COLUMNS.map((name) => header.indexOf(name));
  if (columns.some((index) => index < 0)) return { ok: false, error: 'The first row must name the columns Device, Terminal and Label.' };
  const [deviceAt, terminalAt, labelAt] = columns as [number, number, number];

  const labels = new Map<string, Record<string, string>>(project.panel.placements.map((p) => [p.id, { ...p.terminalLabels }]));
  const skipped: string[] = [];
  let set = 0;
  let cleared = 0;

  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const device = (row[deviceAt] ?? '').trim();
    const terminal = (row[terminalAt] ?? '').trim();
    const parsed = normalizeLabel(row[labelAt] ?? '');
    if (device === '' || terminal === '') return void skipped.push(`row ${line}: the device and the terminal must be given`);
    if (!parsed.ok) return void skipped.push(`row ${line}: "${(row[labelAt] ?? '').trim()}" cannot be a label`);

    const matching = project.panel.placements.filter((p) => (p.label ?? resolve(p.module)?.name) === device);
    if (matching.length === 0) return void skipped.push(`row ${line}: there is no module called ${device}`);

    for (const placement of matching) {
      const def = resolve(placement.module);
      if (!def) continue;
      const terminals = terminalsOf(def, placement.widthUnits ?? def.widthUnits);
      const byName = terminals.filter((t) => t.name === terminal);
      const found = byName.length === 1 ? byName[0] : byName.length === 0 ? terminals.find((t) => t.id === terminal) : undefined;
      if (byName.length > 1) return void skipped.push(`row ${line}: ${device} has several terminals called ${terminal}; write top:${terminal} or bottom:${terminal}`);
      if (!found) return void skipped.push(`row ${line}: ${device} has no terminal ${terminal}`);
      const own = labels.get(placement.id)!;
      if (parsed.label === undefined) {
        if (own[found.id] !== undefined) cleared += 1;
        delete own[found.id];
      } else {
        if (own[found.id] === undefined && Object.keys(own).length >= MAX_TERMINAL_LABELS_PER_MODULE) return void skipped.push(`row ${line}: ${device} cannot have more than ${MAX_TERMINAL_LABELS_PER_MODULE} terminal labels`);
        own[found.id] = parsed.label;
        set += 1;
      }
    }
  });

  const placements = project.panel.placements.map((p): Placement => {
    const own = labels.get(p.id)!;
    const { terminalLabels: _previous, ...rest } = p;
    return Object.keys(own).length === 0 ? rest : { ...rest, terminalLabels: own };
  });
  return { ok: true, panel: { ...project.panel, placements }, set, cleared, skipped };
}
