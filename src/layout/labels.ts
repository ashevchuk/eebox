import { MAX_LABEL_LENGTH } from './limits';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** A stored label is already trimmed, not empty, short, and free of control characters. */
export function isStoredLabel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LABEL_LENGTH &&
    value === value.trim() &&
    !CONTROL_CHARACTERS.test(value)
  );
}

/** Turns what the user typed into what is stored: empty text clears the label. */
export function normalizeLabel(text: string): { ok: true; label: string | undefined } | { ok: false } {
  const label = text.trim();
  if (label === '') return { ok: true, label: undefined };
  return isStoredLabel(label) ? { ok: true, label } : { ok: false };
}
