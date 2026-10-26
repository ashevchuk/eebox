export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(
    private value: T,
    private readonly limit = 100,
  ) {}

  get current(): T {
    return this.value;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(next: T): void {
    this.past.push(this.value);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.value = next;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.value);
    this.value = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.value);
    this.value = next;
    return true;
  }

  reset(value: T): void {
    this.past = [];
    this.future = [];
    this.value = value;
  }
}
