import { isStoredLabel, normalizeLabel } from './labels';
import type { Panel } from './placement';

/** Where a project stands in a review, in the order it usually goes. */
export const STATUSES = ['draft', 'for review', 'changes requested', 'approved'] as const;
export type Status = (typeof STATUSES)[number];

/** What a drawing is passed on with: which version it is, whose it is and what the people who got it decided. */
export interface ProjectInfo {
  revision?: string;
  author?: string;
  date?: string;
  approver?: string;
  status?: Status;
  notes?: string;
}

export const INFO_LABELS = {
  revision: 'Revision',
  author: 'Author',
  date: 'Date',
  status: 'Status',
  approver: 'Approved by',
  notes: 'Notes',
} as const satisfies Record<keyof ProjectInfo, string>;

export const INFO_KEYS = Object.keys(INFO_LABELS) as Array<keyof ProjectInfo>;
export const MAX_NOTES_CHARS = 2000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** The notes may run over several lines, but hold no other control characters. */
export const isNotes = (text: unknown): text is string => typeof text === 'string' && text.length >= 1 && text.length <= MAX_NOTES_CHARS && !CONTROL.test(text);

/** Why a stored `info` is not one, or null. */
export function infoCheck(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'must be an object';
  for (const [key, item] of Object.entries(value)) {
    if (!(INFO_KEYS as string[]).includes(key)) return `${key}: unknown field`;
    if (key === 'status' ? !(STATUSES as readonly unknown[]).includes(item) : key === 'notes' ? !isNotes(item) : !isStoredLabel(item)) {
      return `${key}: ${key === 'status' ? `must be one of ${STATUSES.join(', ')}` : key === 'notes' ? `must be 1 to ${MAX_NOTES_CHARS} characters` : 'must be a label of 1 to 60 characters'}`;
    }
  }
  return null;
}

export type InfoError = 'unknown-field' | 'invalid-value';
export type InfoResult = { ok: true; panel: Panel } | { ok: false; error: InfoError };

/** Sets one field from what was typed; empty text clears it, and a panel with nothing left has no `info`. */
export function setInfoField(panel: Panel, key: string, raw: string): InfoResult {
  if (!(INFO_KEYS as string[]).includes(key)) return { ok: false, error: 'unknown-field' };
  const field = key as keyof ProjectInfo;
  const text = field === 'notes' ? raw.replace(/\r\n?/g, '\n').trim() : raw.trim();
  let value: string | undefined;
  if (text === '') value = undefined;
  else if (field === 'status') {
    if (!(STATUSES as readonly string[]).includes(text)) return { ok: false, error: 'invalid-value' };
    value = text;
  } else if (field === 'notes') {
    if (!isNotes(text)) return { ok: false, error: 'invalid-value' };
    value = text;
  } else {
    const label = normalizeLabel(text);
    if (!label.ok) return { ok: false, error: 'invalid-value' };
    value = label.label;
  }
  const { info: _previous, ...rest } = panel;
  const next: ProjectInfo = { ...(panel.info ?? {}) };
  if (value === undefined) delete next[field];
  else (next as Record<string, string>)[field] = value;
  return { ok: true, panel: Object.keys(next).length === 0 ? rest : { ...rest, info: next } };
}

/** The fields that are stated, in the order of a title block, as label and text. */
export function infoRows(info: ProjectInfo | undefined): Array<[string, string]> {
  const order: Array<keyof ProjectInfo> = ['revision', 'date', 'author', 'status', 'approver', 'notes'];
  return order.flatMap((key): Array<[string, string]> => (info?.[key] ? [[INFO_LABELS[key], info[key]!]] : []));
}

/** Revision and status as a short line for a list or a stamp; empty when neither is given. */
export function stampOf(info: ProjectInfo | undefined): string {
  return [info?.revision ? `rev ${info.revision}` : '', info?.status ?? ''].filter(Boolean).join(' · ');
}
