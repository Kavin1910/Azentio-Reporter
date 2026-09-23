/**
 * A small, safe expression language for derived fields.
 *
 * Why not `eval` or `new Function`: these formulas are edited by users and
 * stored in the database, so anything that can run arbitrary JavaScript is a
 * remote code execution hole the moment two people share a dataset. This
 * evaluator understands arithmetic, comparisons, a fixed set of functions and
 * column references — and nothing else. There is no property access, no call
 * into host objects, no loops.
 *
 * Grammar:
 *   expr    := comparison
 *   cmp     := sum (('<'|'>'|'<='|'>='|'=='|'!=') sum)?
 *   sum     := product (('+'|'-') product)*
 *   product := unary (('*'|'/'|'%') unary)*
 *   unary   := '-'? primary
 *   primary := number | string | identifier | call | '(' expr ')'
 */

export type FormulaValue = number | string | boolean | null;

// ---------------------------------------------------------------- tokenizer

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    if (/\s/.test(c)) { i++; continue; }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const raw = src.slice(i, j);
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new FormulaError(`Not a number: ${raw}`);
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== quote) { s += src[j]; j++; }
      if (j >= src.length) throw new FormulaError('Unterminated string.');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%()<>,'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '=') { out.push({ t: 'op', v: '==' }); i++; continue; }

    throw new FormulaError(`Unexpected character: ${c}`);
  }

  out.push({ t: 'eof' });
  return out;
}

// -------------------------------------------------------------------- AST

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; name: string }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'neg'; e: Node }
  | { k: 'call'; name: string; args: Node[] };

export class FormulaError extends Error {}

function parse(tokens: Token[]): Node {
  let pos = 0;
  const peek = () => tokens[pos]!;
  const eat = (v: string) => {
    const tk = peek();
    if (tk.t !== 'op' || tk.v !== v) throw new FormulaError(`Expected "${v}".`);
    pos++;
  };

  function primary(): Node {
    const tk = peek();

    if (tk.t === 'num') { pos++; return { k: 'num', v: tk.v }; }
    if (tk.t === 'str') { pos++; return { k: 'str', v: tk.v }; }

    if (tk.t === 'id') {
      pos++;
      const next = peek();
      if (next.t === 'op' && next.v === '(') {
        pos++;
        const args: Node[] = [];
        if (!(peek().t === 'op' && (peek() as any).v === ')')) {
          args.push(expr());
          while (peek().t === 'op' && (peek() as any).v === ',') { pos++; args.push(expr()); }
        }
        eat(')');
        return { k: 'call', name: tk.v.toUpperCase(), args };
      }
      return { k: 'ref', name: tk.v };
    }

    if (tk.t === 'op' && tk.v === '(') { pos++; const e = expr(); eat(')'); return e; }

    throw new FormulaError('Unexpected end of formula.');
  }

  function unary(): Node {
    const tk = peek();
    if (tk.t === 'op' && tk.v === '-') { pos++; return { k: 'neg', e: unary() }; }
    return primary();
  }

  function product(): Node {
    let left = unary();
    while (peek().t === 'op' && ['*', '/', '%'].includes((peek() as any).v)) {
      const op = (peek() as any).v; pos++;
      left = { k: 'bin', op, l: left, r: unary() };
    }
    return left;
  }

  function sum(): Node {
    let left = product();
    while (peek().t === 'op' && ['+', '-'].includes((peek() as any).v)) {
      const op = (peek() as any).v; pos++;
      left = { k: 'bin', op, l: left, r: product() };
    }
    return left;
  }

  function expr(): Node {
    let left = sum();
    while (peek().t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes((peek() as any).v)) {
      const op = (peek() as any).v; pos++;
      left = { k: 'bin', op, l: left, r: sum() };
    }
    return left;
  }

  const root = expr();
  if (peek().t !== 'eof') throw new FormulaError('Unexpected text after the end of the formula.');
  return root;
}

// -------------------------------------------------------------- evaluation

const toNum = (v: FormulaValue): number | null => {
  if (v === null || v === '' || typeof v === 'boolean') return typeof v === 'boolean' ? (v ? 1 : 0) : null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toDate = (v: FormulaValue): Date | null => {
  if (v === null) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

const MS_PER_DAY = 86400000;
/** Mean Gregorian year. Using 365 drifts a whole year by age ~80. */
const DAYS_PER_YEAR = 365.2425;

type Fn = (args: FormulaValue[], now: Date) => FormulaValue;

const FUNCTIONS: Record<string, Fn> = {
  TODAY: (_a, now) => now.toISOString().slice(0, 10),

  YEARS_BETWEEN: (a, now) => {
    const from = toDate(a[0] ?? null);
    const to = a.length > 1 ? toDate(a[1] ?? null) : now;
    if (!from || !to) return null;
    return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY / DAYS_PER_YEAR);
  },

  DAYS_BETWEEN: (a, now) => {
    const from = toDate(a[0] ?? null);
    const to = a.length > 1 ? toDate(a[1] ?? null) : now;
    if (!from || !to) return null;
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
  },

  ROUND: (a) => {
    const n = toNum(a[0] ?? null);
    if (n === null) return null;
    const places = toNum(a[1] ?? 0) ?? 0;
    const f = Math.pow(10, places);
    return Math.round(n * f) / f;
  },

  ABS: (a) => { const n = toNum(a[0] ?? null); return n === null ? null : Math.abs(n); },

  MIN: (a) => {
    const ns = a.map(toNum).filter((n): n is number => n !== null);
    return ns.length ? Math.min(...ns) : null;
  },
  MAX: (a) => {
    const ns = a.map(toNum).filter((n): n is number => n !== null);
    return ns.length ? Math.max(...ns) : null;
  },

  COALESCE: (a) => a.find((v) => v !== null && v !== '') ?? null,

  IF: (a) => (truthy(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),

  /**
   * BUCKET(value, edge1, label1, edge2, label2, ..., fallbackLabel)
   * Returns the first label whose edge the value does not exceed.
   * Used for dpd_bucket, age_band and score_band.
   */
  BUCKET: (a) => {
    const n = toNum(a[0] ?? null);
    if (n === null) return null;
    for (let i = 1; i + 1 < a.length; i += 2) {
      const edge = toNum(a[i] ?? null);
      if (edge !== null && n <= edge) return a[i + 1] ?? null;
    }
    return a[a.length - 1] ?? null;
  },

  /** Standard reducing-balance EMI: EMI(principal, annualRatePercent, months). */
  EMI: (a) => {
    const p = toNum(a[0] ?? null), rate = toNum(a[1] ?? null), n = toNum(a[2] ?? null);
    if (p === null || rate === null || n === null || p <= 0 || n <= 0) return null;
    const r = rate / 12 / 100;
    if (r === 0) return Math.round((p / n) * 100) / 100;
    const g = Math.pow(1 + r, n);
    return Math.round(((p * r * g) / (g - 1)) * 100) / 100;
  },

  UPPER: (a) => (a[0] === null || a[0] === undefined ? null : String(a[0]).toUpperCase()),
  LOWER: (a) => (a[0] === null || a[0] === undefined ? null : String(a[0]).toLowerCase()),
  TRIM:  (a) => (a[0] === null || a[0] === undefined ? null : String(a[0]).trim()),
};

function truthy(v: FormulaValue): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v !== '';
}

function evaluate(node: Node, row: Record<string, unknown>, now: Date): FormulaValue {
  switch (node.k) {
    case 'num': return node.v;
    case 'str': return node.v;

    case 'ref': {
      // Bare TODAY without parentheses reads naturally in a formula.
      if (node.name.toUpperCase() === 'TODAY') return now.toISOString().slice(0, 10);
      const v = row[node.name];
      if (v === undefined || v === null) return null;
      if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
      return String(v);
    }

    case 'neg': {
      const n = toNum(evaluate(node.e, row, now));
      return n === null ? null : -n;
    }

    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`Unknown function: ${node.name}`);
      return fn(node.args.map((a) => evaluate(a, row, now)), now);
    }

    case 'bin': {
      const l = evaluate(node.l, row, now);
      const r = evaluate(node.r, row, now);

      if (['==', '!='].includes(node.op)) {
        const eq = String(l) === String(r);
        return node.op === '==' ? eq : !eq;
      }

      const ln = toNum(l), rn = toNum(r);
      // A null input yields a null result rather than a wrong number — the
      // whole point of deriving is that gaps stay visible.
      if (ln === null || rn === null) return null;

      switch (node.op) {
        case '+': return ln + rn;
        case '-': return ln - rn;
        case '*': return ln * rn;
        case '/': return rn === 0 ? null : ln / rn;
        case '%': return rn === 0 ? null : ln % rn;
        case '<': return ln < rn;
        case '>': return ln > rn;
        case '<=': return ln <= rn;
        case '>=': return ln >= rn;
        default: throw new FormulaError(`Unknown operator: ${node.op}`);
      }
    }
  }
}

// ------------------------------------------------------------------ public

export interface CompiledFormula {
  run: (row: Record<string, unknown>, now?: Date) => FormulaValue;
  /** Column names the formula reads — used to check a mapping can satisfy it. */
  inputs: string[];
}

export function compileFormula(source: string): CompiledFormula {
  const ast = parse(tokenize(source));

  const inputs = new Set<string>();
  (function walk(n: Node) {
    if (n.k === 'ref' && n.name.toUpperCase() !== 'TODAY') inputs.add(n.name);
    else if (n.k === 'bin') { walk(n.l); walk(n.r); }
    else if (n.k === 'neg') walk(n.e);
    else if (n.k === 'call') n.args.forEach(walk);
  })(ast);

  return {
    inputs: [...inputs],
    run: (row, now = new Date()) => evaluate(ast, row, now),
  };
}

/** Validates without running. Returns null when the formula is well-formed. */
export function checkFormula(source: string): string | null {
  try {
    compileFormula(source);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid formula.';
  }
}
