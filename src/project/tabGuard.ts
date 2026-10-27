import { AUTOSAVE_KEY } from './autosave';

/**
 * Tells when another tab of the same browser writes the autosave. The autosave is one entry for the whole site, so
 * two tabs would overwrite each other's work without a word; while a conflict stands this tab does not write.
 */
export class TabGuard {
  private lastWritten: string | null = null;
  private conflicting = false;

  /** What this tab has put in the store, so that its own writes are not taken for somebody else's. */
  wrote(text: string | null): void {
    this.lastWritten = text;
  }

  get conflict(): boolean {
    return this.conflicting;
  }

  /** A `storage` event; true when it starts a conflict. Clearing the store is not a conflict: there is nothing to lose. */
  seen(key: string | null, newValue: string | null): boolean {
    if (key !== AUTOSAVE_KEY || newValue === null || newValue === this.lastWritten) return false;
    const starts = !this.conflicting;
    this.conflicting = true;
    return starts;
  }

  /** The person has chosen which version stands. */
  resolve(): void {
    this.conflicting = false;
  }
}
