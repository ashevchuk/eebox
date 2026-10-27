import { TOUR_STEPS, type TourStep } from './tour';

/** A card at the foot of the stage that walks through `TOUR_STEPS`, pointing at the part of the page each step is about. */
export class TourView {
  private index = 0;
  private pointed: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onStep: (step: TourStep) => void,
    private readonly onEnd: () => void,
  ) {
    root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  start(): void {
    this.index = 0;
    this.show();
  }

  end(): void {
    this.point(null);
    this.root.hidden = true;
    this.onEnd();
  }

  private point(element: HTMLElement | null): void {
    this.pointed?.classList.remove('tour-target');
    this.pointed = element;
    element?.classList.add('tour-target');
  }

  private show(): void {
    const step = TOUR_STEPS[this.index]!;
    this.onStep(step);
    this.point(document.getElementById(step.target));
    const last = this.index === TOUR_STEPS.length - 1;
    const title = document.createElement('strong');
    title.textContent = `${this.index + 1} of ${TOUR_STEPS.length}: ${step.title}`;
    const text = document.createElement('p');
    text.textContent = step.text;
    const actions = document.createElement('div');
    actions.className = 'tour-actions';
    const button = (label: string, run: () => void, primary = false) => {
      const el = document.createElement('button');
      el.textContent = label;
      if (primary) el.className = 'primary';
      el.addEventListener('click', run);
      return el;
    };
    actions.append(
      button('Skip', () => this.end()),
      ...(this.index > 0 ? [button('Back', () => this.go(-1))] : []),
      button(last ? 'Done' : 'Next', () => (last ? this.end() : this.go(1)), true),
    );
    this.root.replaceChildren(title, text, actions);
    this.root.hidden = false;
  }

  private go(by: number): void {
    this.index = Math.min(TOUR_STEPS.length - 1, Math.max(0, this.index + by));
    this.show();
  }
}
