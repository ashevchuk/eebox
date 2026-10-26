import { FieldsView } from './fieldsView';
import { applyAction, applyEdit, inspect, type InspectContext } from './inspector';
import type { Session } from './session';

/** Shows what `inspect` describes for the selection and sends every edit through `applyEdit`. */
export class InspectorView {
  private readonly fields: FieldsView;

  constructor(
    container: HTMLElement,
    private readonly session: Session,
    private readonly confirm: (message: string) => Promise<boolean>,
  ) {
    this.fields = new FieldsView(container, {
      onEdit: (key, raw) => void this.edit(key, raw),
      onAction: (action) => void this.act(action.key),
    });
    session.subscribe(() => this.refresh(false));
    this.refresh(false);
  }

  /** True while one of its fields has the focus. */
  owns(element: Element | null): boolean {
    return this.fields.owns(element);
  }

  private context(): InspectContext {
    const { project, selection, mode, resolve, snapshot, libraryResolve, cableSettings } = this.session;
    return { project, selection, mode, resolve, snapshot, fromLibraries: libraryResolve, cableSettings };
  }

  /** `force` also rewrites the field being typed in, to revert an edit that was refused. */
  refresh(force: boolean): void {
    this.fields.render(inspect(this.context()), force);
  }

  private async act(key: string): Promise<void> {
    let result = applyAction(this.context(), key);
    if (!result.ok && result.needsConfirm) {
      if (!(await this.confirm(result.needsConfirm.message))) return;
      result = applyAction(this.context(), key, { confirmed: true });
    }
    if (!result.ok) {
      this.session.notify(result.message, true);
      return;
    }
    this.commit(result);
  }

  private commit(result: Extract<ReturnType<typeof applyEdit>, { ok: true }>): void {
    this.session.commit(result.project, result.snapshot);
    if (result.selection) this.session.select(result.selection);
    if (result.message) this.session.notify(result.message);
  }

  private async edit(key: string, raw: string | string[]): Promise<void> {
    let result = applyEdit(this.context(), key, raw);
    if (!result.ok && result.needsConfirm) {
      if (!(await this.confirm(result.needsConfirm.message))) {
        this.refresh(true);
        return;
      }
      result = applyEdit(this.context(), key, raw, { confirmed: true });
    }
    if (result.ok) {
      this.commit(result);
      return;
    }
    this.session.notify(result.message, true);
    this.refresh(true);
  }
}
