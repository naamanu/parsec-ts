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
  | { readonly ok: false; readonly failure: Failure };

/** A parser is a pure function from (input, position) to a Result. */
export type Parser<T> = (input: string, pos: number) => Result<T>;

/** Failure from `parse`, with a human-friendly location. */
export type ParseFailure = {
  readonly expected: readonly string[];
  /** What was actually at `pos`: a quoted character, or "end of input". */
  readonly found: string;
  readonly pos: number;
  readonly line: number;
  readonly column: number;
};

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ParseFailure };

const success = <T>(value: T, pos: number, failure?: Failure): Result<T> =>
  failure ? { ok: true, value, pos, failure } : { ok: true, value, pos };

const failure = (expected: readonly string[], pos: number): Result<never> =>
  ({ ok: false, failure: { pos, expected } });

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

export const succeed = <T>(value: T): Parser<T> => (_, pos) => success(value, pos);

export const fail = (expected: string): Parser<never> => (_, pos) => failure([expected], pos);

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

export const anyChar: Parser<string> = satisfy(() => true, "any character");

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

export const map = <A, B>(p: Parser<A>, f: (a: A) => B): Parser<B> => (input, pos) => {
  const r = p(input, pos);
  return r.ok ? success(f(r.value), r.pos, r.failure) : r;
};

/** Monadic bind: run `p`, then the parser that `f` builds from its value. */
export const chain = <A, B>(p: Parser<A>, f: (a: A) => Parser<B>): Parser<B> => (input, pos) => {
  const r = p(input, pos);
  if (!r.ok) return r;
  const q = f(r.value)(input, r.pos);
  return q.ok ? success(q.value, q.pos, merge(r.failure, q.failure)) : { ok: false, failure: merge(r.failure, q.failure) };
};

type Values<Ps extends readonly Parser<any>[]> = {
  [K in keyof Ps]: Ps[K] extends Parser<infer T> ? T : never;
};

/** Run parsers in order, collecting every value into a tuple. */
export const seq = <Ps extends readonly Parser<any>[]>(...ps: Ps): Parser<Values<Ps>> => (input, start) => {
  const values: unknown[] = [];
  let pos = start;
  let fail: Failure | undefined;
  for (const p of ps) {
    const r = p(input, pos);
    if (!r.ok) return { ok: false, failure: merge(fail, r.failure) };
    fail = merge(fail, r.failure);
    values.push(r.value);
    pos = r.pos;
  }
  return success(values as unknown as Values<Ps>, pos, fail);
};

/** Run `a` then `b`, keeping the value of `a`. */
export const left = <A>(a: Parser<A>, b: Parser<unknown>): Parser<A> => map(seq(a, b), ([v]) => v);

/** Run `a` then `b`, keeping the value of `b`. */
export const right = <B>(a: Parser<unknown>, b: Parser<B>): Parser<B> => map(seq(a, b), ([, v]) => v);

/** Ordered choice with backtracking. Failures of every tried alternative are merged. */
export const alt = <Ts extends readonly unknown[]>(
  ...ps: { [K in keyof Ts]: Parser<Ts[K]> }
): Parser<Ts[number]> => (input, pos) => {
  let fail: Failure | undefined;
  for (const p of ps as readonly Parser<Ts[number]>[]) {
    const r = p(input, pos);
    fail = merge(fail, r.failure);
    if (r.ok) return success(r.value, r.pos, fail);
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
  if (!r.ok) return { ok: false, failure: relabel(r.failure) };
  return success(r.value, r.pos, r.failure && relabel(r.failure));
};

/** Run `p` without consuming input. */
export const lookahead = <T>(p: Parser<T>): Parser<T> => (input, pos) => {
  const r = p(input, pos);
  return r.ok ? success(r.value, pos) : r;
};

/** Succeed without consuming input when `p` fails; fail with `expected` when it succeeds. */
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
    if (!r.ok || r.pos === pos) return success(values, pos, fail);
    values.push(r.value);
    pos = r.pos;
  }
};

export const many1 = <T>(p: Parser<T>): Parser<readonly T[]> =>
  map(seq(p, many(p)), ([first, rest]) => [first, ...rest]);

/** Repeat `p` until `end` succeeds; `end` is consumed but its value dropped. */
export const manyTill = <T>(p: Parser<T>, end: Parser<unknown>): Parser<readonly T[]> => (input, start) => {
  const values: T[] = [];
  let pos = start;
  let fail: Failure | undefined;
  for (;;) {
    const e = end(input, pos);
    fail = merge(fail, e.failure);
    if (e.ok) return success(values, e.pos, fail);
    const r = p(input, pos);
    if (!r.ok) return { ok: false, failure: merge(fail, r.failure) };
    if (r.pos === pos) return { ok: false, failure: merge(fail, e.failure) }; // no progress: report what `end` wanted
    fail = merge(fail, r.failure);
    values.push(r.value);
    pos = r.pos;
  }
};

export const optional = <T>(p: Parser<T>): Parser<T | null> => alt(p, succeed(null));

export const sepBy1 = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> =>
  map(seq(p, many(right(sep, p))), ([first, rest]) => [first, ...rest]);

export const sepBy = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> =>
  alt(sepBy1(p, sep), succeed<readonly T[]>([]));

/** Like `sepBy`, but allows a trailing separator. */
export const sepEndBy = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> =>
  left(sepBy(p, sep), optional(sep));

export const between = <T>(open: Parser<unknown>, p: Parser<T>, close: Parser<unknown>): Parser<T> =>
  right(open, left(p, close));

/**
 * Defer construction so parsers can be mutually recursive. The factory runs
 * once, on first use; since it must be pure, the caching is unobservable.
 */
export const lazy = <T>(f: () => Parser<T>): Parser<T> => {
  let cached: Parser<T> | undefined;
  return (input, pos) => (cached ??= f())(input, pos);
};

/** Left-associative chain: `term (op term)*`, folded left. */
export const chainl1 = <T>(term: Parser<T>, op: Parser<(a: T, b: T) => T>): Parser<T> =>
  map(seq(term, many(seq(op, term))), ([first, rest]) =>
    rest.reduce((acc, [f, b]) => f(acc, b), first),
  );

/** Right-associative chain: `term (op term)*`, folded right. */
export const chainr1 = <T>(term: Parser<T>, op: Parser<(a: T, b: T) => T>): Parser<T> =>
  map(seq(term, many(seq(op, term))), ([first, rest]) => {
    const values = [first, ...rest.map(([, v]) => v)];
    return values.slice(0, -1).reduceRight((acc, v, i) => rest[i]![0](v, acc), values[values.length - 1]!);
  });

// Running

const locate = (input: string, pos: number): { line: number; column: number } => {
  const lines = input.slice(0, pos).split("\n");
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
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

export const formatFailure = (e: ParseFailure): string =>
  `Parse error at line ${e.line}, column ${e.column}: unexpected ${e.found}` +
  (e.expected.length ? `, expected ${orList(e.expected)}` : "");
