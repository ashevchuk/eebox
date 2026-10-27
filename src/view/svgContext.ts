type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const FULL_TURN = Math.PI * 2;

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** Labels come from user files and links, so nothing from them reaches the SVG unescaped. */
const escapeXml = (text: string): string => text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

/** Splits `rgba(r, g, b, a)` into an opaque colour and its alpha, which SVG viewers treat more uniformly. */
function paint(color: string): { color: string; opacity: number } {
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(color);
  return rgba ? { color: `rgb(${rgba[1]},${rgba[2]},${rgba[3]})`, opacity: Number(rgba[4]) } : { color, opacity: 1 };
}

const TEXT_ANCHOR: Record<string, string> = { left: 'start', start: 'start', center: 'middle', right: 'end', end: 'end' };
const TEXT_BASELINE: Record<string, string> = {
  alphabetic: 'alphabetic',
  middle: 'central',
  top: 'hanging',
  hanging: 'hanging',
  bottom: 'text-after-edge',
  ideographic: 'text-after-edge',
};

interface State {
  matrix: Matrix;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  lineDash: number[];
}

/**
 * Records canvas drawing calls as SVG, so a view can be exported by running the very same `draw`
 * code that paints the screen. It implements only what the views use, and is meant to be cast to
 * `CanvasRenderingContext2D` at the call site.
 */
export class SvgContext {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  lineJoin = 'miter';
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  globalAlpha = 1;

  private matrix: Matrix = IDENTITY;
  private lineDash: number[] = [];
  private path: string[] = [];
  private readonly body: string[] = [];
  private readonly defs: string[] = [];
  private readonly saved: Array<{ state: State; openGroups: number }> = [];
  private openGroups = 0;
  private clips = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly measure: (text: string, font: string) => number,
    /** Ids are global in a page, so drawings that share one page need different prefixes. */
    private readonly idPrefix = '',
  ) {}

  save(): void {
    this.saved.push({ state: this.snapshot(), openGroups: this.openGroups });
  }

  restore(): void {
    const entry = this.saved.pop();
    if (!entry) return;
    Object.assign(this, entry.state);
    while (this.openGroups > entry.openGroups) this.closeGroup();
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
  }

  translate(x: number, y: number): void {
    this.matrix = multiply(this.matrix, [1, 0, 0, 1, x, y]);
  }

  scale(x: number, y: number): void {
    this.matrix = multiply(this.matrix, [x, 0, 0, y, 0, 0]);
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.matrix = multiply(this.matrix, [cos, sin, -sin, cos, 0, 0]);
  }

  setLineDash(segments: number[]): void {
    this.lineDash = [...segments];
  }

  beginPath(): void {
    this.path = [];
  }

  moveTo(x: number, y: number): void {
    this.path.push(`M${num(x)} ${num(y)}`);
  }

  lineTo(x: number, y: number): void {
    this.path.push(`L${num(x)} ${num(y)}`);
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.path.push(`M${num(x)} ${num(y)}h${num(width)}v${num(height)}h${num(-width)}Z`);
  }

  /** Clockwise arcs only, which is all the views draw. */
  arc(x: number, y: number, radius: number, start: number, end: number): void {
    this.ellipse(x, y, radius, radius, 0, start, end);
  }

  /** Clockwise and not turned, like `arc`. */
  ellipse(x: number, y: number, rx: number, ry: number, _rotation: number, start: number, end: number): void {
    const point = (angle: number) => `${num(x + rx * Math.cos(angle))} ${num(y + ry * Math.sin(angle))}`;
    const radii = `${num(rx)} ${num(ry)}`;
    const span = end - start;
    const command = this.path.length === 0 ? 'M' : 'L';
    if (span >= FULL_TURN - 1e-9) {
      const opposite = start + Math.PI;
      this.path.push(`${command}${point(start)}A${radii} 0 1 1 ${point(opposite)}A${radii} 0 1 1 ${point(start)}Z`);
      return;
    }
    this.path.push(`${command}${point(start)}A${radii} 0 ${span > Math.PI ? 1 : 0} 1 ${point(end)}`);
  }

  closePath(): void {
    this.path.push('Z');
  }

  fill(): void {
    this.emit(`<path d="${this.path.join('')}"${this.fillAttributes()}${this.common()}/>`);
  }

  stroke(): void {
    this.emit(`<path d="${this.path.join('')}"${this.strokeAttributes()}${this.common()}/>`);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.emit(`<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}"${this.fillAttributes()}${this.common()}/>`);
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.emit(`<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}"${this.strokeAttributes()}${this.common()}/>`);
  }

  /** Only rectangular clips are supported: the views clip text to a box. */
  clip(): void {
    const id = `${this.idPrefix}clip${++this.clips}`;
    this.defs.push(`<clipPath id="${id}"><path d="${this.path.join('')}"${this.transformAttribute()}/></clipPath>`);
    this.body.push(`<g clip-path="url(#${id})">`);
    this.openGroups++;
  }

  fillText(text: string, x: number, y: number): void {
    const font = /^(?:(?:bold|italic|normal|oblique)\s+)*(\d+(?:\.\d+)?)px\s+(.+)$/.exec(this.font);
    const size = font ? font[1] : '10';
    const family = font ? font[2] : 'sans-serif';
    const weight = /\bbold\b/.test(this.font) ? ' font-weight="bold"' : '';
    this.emit(
      `<text x="${num(x)}" y="${num(y)}" font-size="${size}" font-family="${escapeXml(family!)}"${weight}` +
        ` text-anchor="${TEXT_ANCHOR[this.textAlign] ?? 'start'}" dominant-baseline="${TEXT_BASELINE[this.textBaseline] ?? 'alphabetic'}"` +
        `${this.fillAttributes()}${this.common()}>${escapeXml(text)}</text>`,
    );
  }

  measureText(text: string): { width: number } {
    return { width: this.measure(text, this.font) };
  }

  toSvg(): string {
    while (this.openGroups > 0) this.closeGroup();
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${num(this.width)}" height="${num(this.height)}" viewBox="0 0 ${num(this.width)} ${num(this.height)}">` +
      `<defs>${this.defs.join('')}</defs>${this.body.join('')}</svg>\n`
    );
  }

  private snapshot(): State {
    return {
      matrix: this.matrix,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineJoin: this.lineJoin,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline,
      globalAlpha: this.globalAlpha,
      lineDash: this.lineDash,
    };
  }

  private closeGroup(): void {
    this.body.push('</g>');
    this.openGroups--;
  }

  private emit(element: string): void {
    this.body.push(element);
  }

  private transformAttribute(): string {
    const [a, b, c, d, e, f] = this.matrix;
    return ` transform="matrix(${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(e)} ${num(f)})"`;
  }

  private common(): string {
    return `${this.transformAttribute()}${this.globalAlpha < 1 ? ` opacity="${num(this.globalAlpha)}"` : ''}`;
  }

  private fillAttributes(): string {
    const { color, opacity } = paint(this.fillStyle);
    return ` fill="${escapeXml(color)}"${opacity < 1 ? ` fill-opacity="${num(opacity)}"` : ''} stroke="none"`;
  }

  private strokeAttributes(): string {
    const { color, opacity } = paint(this.strokeStyle);
    const dash = this.lineDash.length > 0 ? ` stroke-dasharray="${this.lineDash.map(num).join(' ')}"` : '';
    return (
      ` fill="none" stroke="${escapeXml(color)}"${opacity < 1 ? ` stroke-opacity="${num(opacity)}"` : ''}` +
      ` stroke-width="${num(this.lineWidth)}" stroke-linejoin="${this.lineJoin}"${dash}`
    );
  }
}
