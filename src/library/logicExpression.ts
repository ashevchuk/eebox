export type Expression =
  | { op: 'name'; name: string }
  | { op: 'not'; arg: Expression }
  | { op: 'and' | 'or'; left: Expression; right: Expression };

export type ParsedExpression = { ok: true; expression: Expression; names: string[] } | { ok: false; message: string };

export const MAX_EXPRESSION_LENGTH = 200;

const TOKEN = /\s*([A-Za-z][A-Za-z0-9_]*|[!&|()])/y;

/** Reads `!`, `&`, `|` and parentheses over names; `!` binds tightest, then `&`, then `|`. */
export function parseExpression(text: string): ParsedExpression {
  if (text.length > MAX_EXPRESSION_LENGTH) return { ok: false, message: `must be at most ${MAX_EXPRESSION_LENGTH} characters` };
  const tokens: string[] = [];
  let position = 0;
  while (text.slice(position).trim() !== '') {
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(text);
    if (!match) return { ok: false, message: `unexpected character at ${position + 1}` };
    tokens.push(match[1]!);
    position = TOKEN.lastIndex;
  }
  let index = 0;
  const names = new Set<string>();

  const fail = (message: string): never => {
    throw new Error(message);
  };
  const primary = (): Expression => {
    const token = tokens[index++];
    if (token === undefined) return fail('the expression ends too early');
    if (token === '!') return { op: 'not', arg: primary() };
    if (token === '(') {
      const inner = or();
      if (tokens[index++] !== ')') return fail('a parenthesis is not closed');
      return inner;
    }
    if (/^[A-Za-z]/.test(token)) {
      names.add(token);
      return { op: 'name', name: token };
    }
    return fail(`unexpected "${token}"`);
  };
  const and = (): Expression => {
    let left = primary();
    while (tokens[index] === '&') {
      index++;
      left = { op: 'and', left, right: primary() };
    }
    return left;
  };
  function or(): Expression {
    let left = and();
    while (tokens[index] === '|') {
      index++;
      left = { op: 'or', left, right: and() };
    }
    return left;
  }

  try {
    const expression = or();
    if (index < tokens.length) return { ok: false, message: `unexpected "${tokens[index]}"` };
    return { ok: true, expression, names: [...names] };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function evaluateExpression(expression: Expression, value: (name: string) => boolean): boolean {
  switch (expression.op) {
    case 'name':
      return value(expression.name);
    case 'not':
      return !evaluateExpression(expression.arg, value);
    case 'and':
      return evaluateExpression(expression.left, value) && evaluateExpression(expression.right, value);
    case 'or':
      return evaluateExpression(expression.left, value) || evaluateExpression(expression.right, value);
  }
}
