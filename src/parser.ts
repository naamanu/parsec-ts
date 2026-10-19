/**
 * A tiny, purely functional parser combinator library.
 *
 * Every exported function is referentially transparent: same arguments, same
 * result, no observable side effects, and failures are returned as values
 * rather than thrown. A few combinators (`seq`, `alt`, `many`, `manyTill`,
 * `regex`, `lazy`) use loops or local mutable state internally, because
 * JavaScript has no tail-call elimination and recursion would overflow the
 * stack on long inputs. That state never escapes the call that created it.
 */

/** The furthest position a parse failed at, and what was expected there. */
export type Failure = { readonly pos: number; readonly expected: readonly string[] };

/**
 * Outcome of running a parser at a position. A success also carries the
 * furthest failure seen along the way (e.g. the last attempt of `many`), so
 * errors reported later can say everything that would have been accepted.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly pos: number; readonly failure?: Failure }
  | { readonly ok: false; readonly failure: Failure; readonly fatal?: true };

type Failed = Extract<Result<never>, { ok: false }>;

/** A parser is a pure function from (input, position) to a Result. */
export type Parser<T> = (input: string, pos: number) => Result<T>;

/** Failure from `parse`, with a human-friendly location. */
export type ParseFailure = {
  readonly expected: readonly string[];
  /** What was actually at `pos`: a quoted character, or "end of input". */
  readonly found: string;
  /** Offset in UTF-16 code units, as used by `input.slice`. */
  readonly pos: number;
  /** 1-based; `\n`, `\r\n` and `\r` each end a line. */
  readonly line: number;
  /** 1-based, counted in Unicode code points so an emoji is one column. */
  readonly column: number;
};

/** Outcome of `parse`: the value, or a located failure. */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ParseFailure };

const success = <T>(value: T, pos: number, failure?: Failure): Result<T> =>
  failure ? { ok: true, value, pos, failure } : { ok: true, value, pos };

const failure = (expected: readonly string[], pos: number): Result<never> =>
  ({ ok: false, failure: { pos, expected } });

/** A failure with new details that keeps `r`'s fatality (see `cut`). */
const failWith = (r: Failed, failure: Failure): Failed =>
  r.fatal ? { ok: false, failure, fatal: true } : { ok: false, failure };

/** Keep the furthest failure; at the same position, combine what was expected. */
function merge(a: Failure | undefined, b: Failure): Failure;
function merge(a: Failure | undefined, b: Failure | undefined): Failure | undefined;
function merge(a: Failure | undefined, b: Failure | undefined): Failure | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.pos !== b.pos) return a.pos > b.pos ? a : b;
  return { pos: a.pos, expected: [...new Set([...a.expected, ...b.expected])] };
}

// Primitives

/** Consume nothing and return `value`. */
export const succeed = <T>(value: T): Parser<T> => (_, pos) => success(value, pos);

/** Consume nothing and fail, reporting `expected`. */
export const fail = (expected: string): Parser<never> => (_, pos) => failure([expected], pos);

/** Match the literal string `s`. */
export const str = (s: string): Parser<string> => (input, pos) =>
  input.startsWith(s, pos) ? success(s, pos + s.length) : failure([JSON.stringify(s)], pos);

/**
 * Match a regular expression at the current position. The `g` and `y` flags
 * are ignored. `^`, `$` and lookbehind see the whole input.
 */
export const regex = (re: RegExp, name = String(re)): Parser<string> => {
  // Private to this parser. `lastIndex` is set right before every `exec`, so no
  // state carries over between calls.
  const sticky = new RegExp(re.source, re.flags.replace(/[gy]/g, "") + "y");
  return (input, pos) => {
    sticky.lastIndex = pos;
    const m = sticky.exec(input);
    return m ? success(m[0], pos + m[0].length) : failure([name], pos);
  };
};

/** Match one Unicode code point that satisfies `pred`. */
export const satisfy = (pred: (char: string) => boolean, name: string): Parser<string> => (input, pos) => {
  const cp = input.codePointAt(pos);
  if (cp === undefined) return failure([name], pos);
  const char = String.fromCodePoint(cp);
  return pred(char) ? success(char, pos + char.length) : failure([name], pos);
};

/** Match any one code point. Fails only at end of input. */
export const anyChar: Parser<string> = satisfy(() => true, "any character");

/** Match one character from `chars`. */
export const oneOf = (chars: string): Parser<string> => {
  const set = new Set(chars);
  return satisfy((c) => set.has(c), `one of ${JSON.stringify(chars)}`);
};

/** Match one character not in `chars` (fails at end of input). */
export const noneOf = (chars: string): Parser<string> => {
  const set = new Set(chars);
  return satisfy((c) => !set.has(c), `none of ${JSON.stringify(chars)}`);
};

/** Match the end of input. */
export const eof: Parser<null> = (input, pos) =>
  pos === input.length ? success(null, pos) : failure(["end of input"], pos);

/** The current offset into the input, consuming nothing. */
export const position: Parser<number> = (_, pos) => success(pos, pos);

// Combinators

/** A parsed value with the half-open range `[start, end)` of input it came from. */
export type Span<T> = { readonly value: T; readonly start: number; readonly end: number };

/** Run `p`, recording the input offsets it consumed. */
export const withSpan = <T>(p: Parser<T>): Parser<Span<T>> => (input, start) => {
  const r = p(input, start);
  return r.ok ? success({ value: r.value, start, end: r.pos }, r.pos, r.failure) : r;
};

/** Transform the value of `p` with `f`. */
export const map = <A, B>(p: Parser<A>, f: (a: A) => B): Parser<B> => (input, pos) => {
  const r = p(input, pos);
  return r.ok ? success(f(r.value), r.pos, r.failure) : r;
};

/** Monadic bind: run `p`, then the parser that `f` builds from its value. */
export const chain = <A, B>(p: Parser<A>, f: (a: A) => Parser<B>): Parser<B> => (input, pos) => {
  const r = p(input, pos);
  if (!r.ok) return r;
  const q = f(r.value)(input, r.pos);
  return q.ok ? success(q.value, q.pos, merge(r.failure, q.failure)) : failWith(q, merge(r.failure, q.failure));
};

/** The tuple of values produced by `seq(...ps)`. */
export type SeqValues<Ps extends readonly Parser<any>[]> = {
  [K in keyof Ps]: Ps[K] extends Parser<infer T> ? T : never;
};

/** Run parsers in order, collecting every value into a tuple. */
export const seq = <Ps extends readonly Parser<any>[]>(...ps: Ps): Parser<SeqValues<Ps>> => (input, start) => {
  const values: unknown[] = [];
  let pos = start;
  let fail: Failure | undefined;
  for (const p of ps) {
    const r = p(input, pos);
    if (!r.ok) return failWith(r, merge(fail, r.failure));
    fail = merge(fail, r.failure);
    values.push(r.value);
    pos = r.pos;
  }
  return success(values as unknown as SeqValues<Ps>, pos, fail);
};

// The combinators below are written directly rather than composed from
// `map`/`seq`, so each one costs a single stack frame. That keeps deeply
// nested grammars well clear of the JavaScript call-stack limit.

/** Run `a` then `b`, keeping the value of `a`. */
export const left = <A>(a: Parser<A>, b: Parser<unknown>): Parser<A> => (input, pos) => {
  const ra = a(input, pos);
  if (!ra.ok) return ra;
  const rb = b(input, ra.pos);
  if (!rb.ok) return failWith(rb, merge(ra.failure, rb.failure));
  return success(ra.value, rb.pos, merge(ra.failure, rb.failure));
};

/** Run `a` then `b`, keeping the value of `b`. */
export const right = <B>(a: Parser<unknown>, b: Parser<B>): Parser<B> => (input, pos) => {
  const ra = a(input, pos);
  if (!ra.ok) return ra;
  const rb = b(input, ra.pos);
  if (!rb.ok) return failWith(rb, merge(ra.failure, rb.failure));
  return success(rb.value, rb.pos, merge(ra.failure, rb.failure));
};

/** Run `open`, `p`, `close` in order, keeping the value of `p`. */
export const between = <T>(open: Parser<unknown>, p: Parser<T>, close: Parser<unknown>): Parser<T> =>
  (input, pos) => {
    const ro = open(input, pos);
    if (!ro.ok) return ro;
    const rp = p(input, ro.pos);
    if (!rp.ok) return failWith(rp, merge(ro.failure, rp.failure));
    const fail = merge(ro.failure, rp.failure);
    const rc = close(input, rp.pos);
    if (!rc.ok) return failWith(rc, merge(fail, rc.failure));
    return success(rp.value, rc.pos, merge(fail, rc.failure));
  };

/**
 * Ordered choice with backtracking. Failures of every tried alternative are
 * merged. A fatal failure (see `cut`) stops the search immediately.
 */
export const alt = <Ts extends readonly unknown[]>(
  ...ps: { [K in keyof Ts]: Parser<Ts[K]> }
): Parser<Ts[number]> => (input, pos) => {
  let fail: Failure | undefined;
  for (const p of ps as readonly Parser<Ts[number]>[]) {
    const r = p(input, pos);
    fail = merge(fail, r.failure);
    if (r.ok) return success(r.value, r.pos, fail);
    if (r.fatal) return failWith(r, merge(fail, r.failure));
  }
  return { ok: false, failure: fail ?? { pos, expected: [] } };
};

/**
 * Report `name` as the expectation when `p` fails without consuming input,
 * replacing whatever `p` itself would have reported there.
 */
export const label = <T>(p: Parser<T>, name: string): Parser<T> => (input, pos) => {
  const relabel = (f: Failure): Failure => (f.pos === pos ? { pos, expected: [name] } : f);
  const r = p(input, pos);
  if (!r.ok) return failWith(r, relabel(r.failure));
  return success(r.value, r.pos, r.failure && relabel(r.failure));
};

/**
 * Commit to `p`: if it fails, the failure is fatal, so enclosing `alt`,
 * `many`, `optional`, `sepBy`, etc. propagate it rather than backtracking.
 * Place it after the part of a grammar that identifies a construct, e.g.
 * `right(keyword("let"), cut(binding))`.
 */
export const cut = <T>(p: Parser<T>): Parser<T> => (input, pos) => {
  const r = p(input, pos);
  return r.ok || r.fatal ? r : { ok: false, failure: r.failure, fatal: true };
};

/** Undo `cut` inside `p`: its fatal failures become ordinary, backtrackable ones. */
export const attempt = <T>(p: Parser<T>): Parser<T> => (input, pos) => {
  const r = p(input, pos);
  return r.ok || !r.fatal ? r : { ok: false, failure: r.failure };
};

/** Run `p` without consuming input. */
export const lookahead = <T>(p: Parser<T>): Parser<T> => (input, pos) => {
  const r = p(input, pos);
  return r.ok ? success(r.value, pos) : r;
};

/**
 * Succeed without consuming input when `p` fails (fatally or not); fail with
 * `expected` when it succeeds.
 */
export const not = (p: Parser<unknown>, expected = "something else"): Parser<null> => (input, pos) =>
  p(input, pos).ok ? failure([expected], pos) : success(null, pos);

/**
 * Zero or more repetitions. Stops on failure, or if `p` succeeds without
 * consuming input (so it can't loop forever).
 */
export const many = <T>(p: Parser<T>): Parser<readonly T[]> => (input, start) => {
  const values: T[] = [];
  let pos = start;
  let fail: Failure | undefined;
  for (;;) {
    const r = p(input, pos);
    fail = merge(fail, r.failure);
    if (!r.ok && r.fatal) return failWith(r, merge(fail, r.failure));
    if (!r.ok || r.pos === pos) return success(values, pos, fail);
    values.push(r.value);
    pos = r.pos;
  }
};

/** One or more repetitions of `p`. */
export const many1 = <T>(p: Parser<T>): Parser<readonly T[]> => {
  const rest = many(p);
  return (input, pos) => {
    const r = p(input, pos);
    if (!r.ok) return r;
    const rs = rest(input, r.pos);
    if (!rs.ok) return rs;
    return success([r.value, ...rs.value], rs.pos, merge(r.failure, rs.failure));
  };
};

/** Repeat `p` until `end` succeeds; `end` is consumed but its value dropped. */
export const manyTill = <T>(p: Parser<T>, end: Parser<unknown>): Parser<readonly T[]> => (input, start) => {
  const values: T[] = [];
  let pos = start;
  let fail: Failure | undefined;
  for (;;) {
    const e = end(input, pos);
    fail = merge(fail, e.failure);
    if (e.ok) return success(values, e.pos, fail);
    if (e.fatal) return failWith(e, merge(fail, e.failure));
    const r = p(input, pos);
    if (!r.ok) return failWith(r, merge(fail, r.failure));
    if (r.pos === pos) return { ok: false, failure: merge(fail, e.failure) }; // no progress: report what `end` wanted
    fail = merge(fail, r.failure);
    values.push(r.value);
    pos = r.pos;
  }
};

/** `p`, or `fallback` (default `null`) without consuming input if `p` fails. */
export function optional<T>(p: Parser<T>): Parser<T | null>;
export function optional<T, D>(p: Parser<T>, fallback: D): Parser<T | D>;
export function optional<T, D>(p: Parser<T>, fallback: D | null = null): Parser<T | D | null> {
  return (input, pos) => {
    const r = p(input, pos);
    return r.ok || r.fatal ? r : success(fallback, pos, r.failure);
  };
}

/** Exactly `n` repetitions of `p`. */
export const count = <T>(n: number, p: Parser<T>): Parser<readonly T[]> => (input, start) => {
  const values: T[] = [];
  let pos = start;
  let fail: Failure | undefined;
  for (let i = 0; i < n; i++) {
    const r = p(input, pos);
    if (!r.ok) return failWith(r, merge(fail, r.failure));
    fail = merge(fail, r.failure);
    values.push(r.value);
    pos = r.pos;
  }
  return success(values, pos, fail);
};

/** The object produced by `struct(shape)`. */
export type StructFields<S extends Readonly<Record<string, Parser<any>>>> = {
  readonly [K in keyof S]: S[K] extends Parser<infer T> ? T : never;
};

/**
 * Run each field's parser in key order, collecting the values into an object
 * with the same keys: `struct({ name: ident, _: symbol("="), value: expr })`.
 */
export const struct = <S extends Readonly<Record<string, Parser<any>>>>(shape: S): Parser<StructFields<S>> => {
  const fields = Object.entries(shape);
  return (input, start) => {
    const entries: [string, unknown][] = [];
    let pos = start;
    let fail: Failure | undefined;
    for (const [key, p] of fields) {
      const r = p(input, pos);
      if (!r.ok) return failWith(r, merge(fail, r.failure));
      fail = merge(fail, r.failure);
      entries.push([key, r.value]);
      pos = r.pos;
    }
    return success(Object.fromEntries(entries) as StructFields<S>, pos, fail);
  };
};

type Separated<T, S> = { ok: true; values: T[]; seps: S[]; pos: number; fail: Failure | undefined } | Failed;

/**
 * Continue `item (sep item)*` after a first item has already been parsed.
 * A `sep` not followed by an `item` is left unconsumed, unless `trailing`.
 */
const separated = <T, S>(
  item: Parser<T>, sep: Parser<S>, trailing: boolean,
  input: string, first: T, start: number, firstFail: Failure | undefined,
): Separated<T, S> => {
  const values = [first];
  const seps: S[] = [];
  let pos = start;
  let fail = firstFail;
  for (;;) {
    const s = sep(input, pos);
    fail = merge(fail, s.failure);
    if (!s.ok) return s.fatal ? failWith(s, merge(fail, s.failure)) : { ok: true, values, seps, pos, fail };
    const r = item(input, s.pos);
    fail = merge(fail, r.failure);
    if (!r.ok) return r.fatal ? failWith(r, merge(fail, r.failure)) : { ok: true, values, seps, pos: trailing ? s.pos : pos, fail };
    if (r.pos === pos) return { ok: true, values, seps, pos, fail }; // no progress
    values.push(r.value);
    seps.push(s.value);
    pos = r.pos;
  }
};

const sepList = <T>(p: Parser<T>, sep: Parser<unknown>, allowEmpty: boolean, trailing: boolean): Parser<readonly T[]> =>
  (input, pos) => {
    const r = p(input, pos);
    if (!r.ok) return allowEmpty && !r.fatal ? success([], pos, r.failure) : r;
    const s = separated(p, sep, trailing, input, r.value, r.pos, r.failure);
    return s.ok ? success(s.values, s.pos, s.fail) : s;
  };

/** One or more `p`, separated by `sep`. */
export const sepBy1 = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> => sepList(p, sep, false, false);

/** Zero or more `p`, separated by `sep`. A trailing `sep` is not consumed. */
export const sepBy = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> => sepList(p, sep, true, false);

/** Like `sepBy`, but allows a trailing separator after at least one item. */
export const sepEndBy = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> => sepList(p, sep, true, true);

/**
 * Defer construction so parsers can be mutually recursive. The factory runs
 * once, on first use; since it must be pure, the caching is unobservable.
 */
export const lazy = <T>(f: () => Parser<T>): Parser<T> => {
  let cached: Parser<T> | undefined;
  return (input, pos) => (cached ??= f())(input, pos);
};

/** Left-associative chain: `term (op term)*`, folded left. */
export const chainl1 = <T>(term: Parser<T>, op: Parser<(a: T, b: T) => T>): Parser<T> => (input, pos) => {
  const r = term(input, pos);
  if (!r.ok) return r;
  const s = separated(term, op, false, input, r.value, r.pos, r.failure);
  if (!s.ok) return s;
  const { values, seps, pos: end, fail } = s;
  return success(values.slice(1).reduce((acc, v, i) => seps[i]!(acc, v), values[0]!), end, fail);
};

/** Right-associative chain: `term (op term)*`, folded right. */
export const chainr1 = <T>(term: Parser<T>, op: Parser<(a: T, b: T) => T>): Parser<T> => (input, pos) => {
  const r = term(input, pos);
  if (!r.ok) return r;
  const s = separated(term, op, false, input, r.value, r.pos, r.failure);
  if (!s.ok) return s;
  const { values, seps, pos: end, fail } = s;
  const last = values[values.length - 1]!;
  return success(values.slice(0, -1).reduceRight((acc, v, i) => seps[i]!(v, acc), last), end, fail);
};

// Lexing helpers

/** Zero or more whitespace characters (`\s*`). */
export const whitespace: Parser<string> = regex(/\s*/, "whitespace");

/** Run `p`, then skip trailing whitespace (or whatever `ws` matches). */
export const lexeme = <T>(p: Parser<T>, ws: Parser<unknown> = whitespace): Parser<T> => left(p, ws);

/** Match the literal `s`, then skip trailing whitespace. */
export const symbol = (s: string, ws: Parser<unknown> = whitespace): Parser<string> => lexeme(str(s), ws);

// Running

const locate = (input: string, pos: number): { line: number; column: number } => {
  const lines = input.slice(0, pos).split(/\r\n|\r|\n/);
  return { line: lines.length, column: [...lines[lines.length - 1]!].length + 1 };
};

const describeAt = (input: string, pos: number): string => {
  const cp = input.codePointAt(pos);
  return cp === undefined ? "end of input" : JSON.stringify(String.fromCodePoint(cp));
};

/** Parse the whole input. Never throws; failures are returned as values. */
export const parse = <T>(p: Parser<T>, input: string): ParseResult<T> => {
  const r = left(p, eof)(input, 0);
  if (r.ok) return { ok: true, value: r.value };
  const { pos, expected } = r.failure;
  return { ok: false, error: { expected, found: describeAt(input, pos), pos, ...locate(input, pos) } };
};

const orList = (xs: readonly string[]): string =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

/** Render a failure as `Parse error at line L, column C: unexpected X, expected A, B or C`. */
export const formatFailure = (e: ParseFailure): string =>
  `Parse error at line ${e.line}, column ${e.column}: unexpected ${e.found}` +
  (e.expected.length ? `, expected ${orList(e.expected)}` : "");
