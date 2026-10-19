import {
  failure, failWith, merge, success,
  type AnyParser, type Failed, type Failure, type Input, type Parser, type ParserInput, type ParserValue,
} from "./core.ts";

// Input-independent primitives

/** Consume nothing and return `value`. */
export const succeed = <T>(value: T): AnyParser<T> => (_, pos) => success(value, pos);

/** Consume nothing and fail, reporting `expected`. */
export const fail = (expected: string): AnyParser<never> => (_, pos) => failure([expected], pos);

/** Match the end of input. */
export const eof: AnyParser<null> = (input, pos) =>
  pos === (input as Input).length ? success(null, pos) : failure(["end of input"], pos);

/** The current offset into the input, consuming nothing. */
export const position: AnyParser<number> = (_, pos) => success(pos, pos);

// Combinators

/** A parsed value with the half-open range `[start, end)` of input it came from. */
export type Span<T> = { readonly value: T; readonly start: number; readonly end: number };

/** Run `p`, recording the input offsets it consumed. */
export const withSpan = <T, I = string>(p: Parser<T, I>): Parser<Span<T>, I> => (input, start) => {
  const r = p(input, start);
  return r.ok ? success({ value: r.value, start, end: r.pos }, r.pos, r.failure) : r;
};

/** Transform the value of `p` with `f`. */
export const map = <A, B, I = string>(p: Parser<A, I>, f: (a: A) => B): Parser<B, I> => (input, pos) => {
  const r = p(input, pos);
  return r.ok ? success(f(r.value), r.pos, r.failure) : r;
};

/** Monadic bind: run `p`, then the parser that `f` builds from its value. */
export const chain = <A, B, I = string>(p: Parser<A, I>, f: (a: A) => Parser<B, I>): Parser<B, I> =>
  (input, pos) => {
    const r = p(input, pos);
    if (!r.ok) return r;
    const q = f(r.value)(input, r.pos);
    return q.ok ? success(q.value, q.pos, merge(r.failure, q.failure)) : failWith(q, merge(r.failure, q.failure));
  };

/** The tuple of values produced by `seq(...ps)`. */
export type SeqValues<Ps extends readonly Parser<any, any>[]> = { [K in keyof Ps]: ParserValue<Ps[K]> };

/** Run parsers in order, collecting every value into a tuple. */
export const seq = <Ps extends readonly Parser<any, any>[]>(...ps: Ps): Parser<SeqValues<Ps>, ParserInput<Ps[number]>> =>
  (input, start) => {
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
export const left = <A, I = string>(a: Parser<A, I>, b: Parser<unknown, I>): Parser<A, I> => (input, pos) => {
  const ra = a(input, pos);
  if (!ra.ok) return ra;
  const rb = b(input, ra.pos);
  if (!rb.ok) return failWith(rb, merge(ra.failure, rb.failure));
  return success(ra.value, rb.pos, merge(ra.failure, rb.failure));
};

/** Run `a` then `b`, keeping the value of `b`. */
export const right = <B, I = string>(a: Parser<unknown, I>, b: Parser<B, I>): Parser<B, I> => (input, pos) => {
  const ra = a(input, pos);
  if (!ra.ok) return ra;
  const rb = b(input, ra.pos);
  if (!rb.ok) return failWith(rb, merge(ra.failure, rb.failure));
  return success(rb.value, rb.pos, merge(ra.failure, rb.failure));
};

/** Run `open`, `p`, `close` in order, keeping the value of `p`. */
export const between = <T, I = string>(open: Parser<unknown, I>, p: Parser<T, I>, close: Parser<unknown, I>): Parser<T, I> =>
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
export const alt = <Ps extends readonly Parser<any, any>[]>(
  ...ps: Ps
): Parser<ParserValue<Ps[number]>, ParserInput<Ps[number]>> => (input, pos) => {
  let fail: Failure | undefined;
  for (const p of ps) {
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
export const label = <T, I = string>(p: Parser<T, I>, name: string): Parser<T, I> => (input, pos) => {
  const relabel = (f: Failure): Failure => (f.pos === pos ? { pos, expected: [name] } : f);
  const r = p(input, pos);
  if (!r.ok) return failWith(r, relabel(r.failure));
  return success(r.value, r.pos, r.failure && relabel(r.failure));
};

/**
 * Record that failures inside `p` happened while parsing `name`, so errors
 * can say where in the grammar they occurred: `context("object", obj)` gives
 * `... expected ":" (in object key, in object)`. Unlike `label`, it keeps what
 * `p` expected.
 *
 * Only failures after `p` has consumed input count as "inside": if `p` fails
 * at its start, it was never entered (that's what `label` is for).
 */
export const context = <T, I = string>(name: string, p: Parser<T, I>): Parser<T, I> => (input, pos) => {
  const within = (f: Failure): Failure => (f.pos > pos ? { ...f, context: [...(f.context ?? []), name] } : f);
  const r = p(input, pos);
  if (!r.ok) return failWith(r, within(r.failure));
  return r.failure ? success(r.value, r.pos, within(r.failure)) : r;
};

/**
 * Commit to `p`: if it fails, the failure is fatal, so enclosing `alt`,
 * `many`, `optional`, `sepBy`, etc. propagate it rather than backtracking.
 * Place it after the part of a grammar that identifies a construct, e.g.
 * `right(keyword("let"), cut(binding))`.
 */
export const cut = <T, I = string>(p: Parser<T, I>): Parser<T, I> => (input, pos) => {
  const r = p(input, pos);
  return r.ok || r.fatal ? r : { ok: false, failure: r.failure, fatal: true };
};

/** Undo `cut` inside `p`: its fatal failures become ordinary, backtrackable ones. */
export const attempt = <T, I = string>(p: Parser<T, I>): Parser<T, I> => (input, pos) => {
  const r = p(input, pos);
  return r.ok || !r.fatal ? r : { ok: false, failure: r.failure };
};

/** Run `p` without consuming input. */
export const lookahead = <T, I = string>(p: Parser<T, I>): Parser<T, I> => (input, pos) => {
  const r = p(input, pos);
  return r.ok ? success(r.value, pos) : r;
};

/**
 * Succeed without consuming input when `p` fails (fatally or not); fail with
 * `expected` when it succeeds.
 */
export const not = <I = string>(p: Parser<unknown, I>, expected = "something else"): Parser<null, I> => (input, pos) =>
  p(input, pos).ok ? failure([expected], pos) : success(null, pos);

/**
 * Zero or more repetitions. Stops on failure, or if `p` succeeds without
 * consuming input (so it can't loop forever).
 */
export const many = <T, I = string>(p: Parser<T, I>): Parser<readonly T[], I> => (input, start) => {
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
export const many1 = <T, I = string>(p: Parser<T, I>): Parser<readonly T[], I> => {
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
export const manyTill = <T, I = string>(p: Parser<T, I>, end: Parser<unknown, I>): Parser<readonly T[], I> =>
  (input, start) => {
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
export function optional<T, I = string>(p: Parser<T, I>): Parser<T | null, I>;
export function optional<T, D, I = string>(p: Parser<T, I>, fallback: D): Parser<T | D, I>;
export function optional<T, D, I>(p: Parser<T, I>, fallback: D | null = null): Parser<T | D | null, I> {
  return (input, pos) => {
    const r = p(input, pos);
    return r.ok || r.fatal ? r : success(fallback, pos, r.failure);
  };
}

/** Exactly `n` repetitions of `p`. */
export const count = <T, I = string>(n: number, p: Parser<T, I>): Parser<readonly T[], I> => (input, start) => {
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
export type StructFields<S extends Readonly<Record<string, Parser<any, any>>>> = {
  readonly [K in keyof S]: ParserValue<S[K]>;
};

/**
 * Run each field's parser in key order, collecting the values into an object
 * with the same keys: `struct({ name: ident, _: symbol("="), value: expr })`.
 */
export const struct = <S extends Readonly<Record<string, Parser<any, any>>>>(
  shape: S,
): Parser<StructFields<S>, ParserInput<S[keyof S]>> => {
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
const separated = <T, S, I>(
  item: Parser<T, I>, sep: Parser<S, I>, trailing: boolean,
  input: I, first: T, start: number, firstFail: Failure | undefined,
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

const sepList = <T, I>(p: Parser<T, I>, sep: Parser<unknown, I>, allowEmpty: boolean, trailing: boolean): Parser<readonly T[], I> =>
  (input, pos) => {
    const r = p(input, pos);
    if (!r.ok) return allowEmpty && !r.fatal ? success([], pos, r.failure) : r;
    const s = separated(p, sep, trailing, input, r.value, r.pos, r.failure);
    return s.ok ? success(s.values, s.pos, s.fail) : s;
  };

/** One or more `p`, separated by `sep`. */
export const sepBy1 = <T, I = string>(p: Parser<T, I>, sep: Parser<unknown, I>): Parser<readonly T[], I> =>
  sepList(p, sep, false, false);

/** Zero or more `p`, separated by `sep`. A trailing `sep` is not consumed. */
export const sepBy = <T, I = string>(p: Parser<T, I>, sep: Parser<unknown, I>): Parser<readonly T[], I> =>
  sepList(p, sep, true, false);

/** Like `sepBy`, but allows a trailing separator after at least one item. */
export const sepEndBy = <T, I = string>(p: Parser<T, I>, sep: Parser<unknown, I>): Parser<readonly T[], I> =>
  sepList(p, sep, true, true);

/**
 * Defer construction so parsers can be mutually recursive. The factory runs
 * once, on first use; since it must be pure, the caching is unobservable.
 */
export const lazy = <T, I = string>(f: () => Parser<T, I>): Parser<T, I> => {
  let cached: Parser<T, I> | undefined;
  return (input, pos) => (cached ??= f())(input, pos);
};

/** Left-associative chain: `term (op term)*`, folded left. */
export const chainl1 = <T, I = string>(term: Parser<T, I>, op: Parser<(a: T, b: T) => T, I>): Parser<T, I> =>
  (input, pos) => {
    const r = term(input, pos);
    if (!r.ok) return r;
    const s = separated(term, op, false, input, r.value, r.pos, r.failure);
    if (!s.ok) return s;
    const { values, seps, pos: end, fail } = s;
    return success(values.slice(1).reduce((acc, v, i) => seps[i]!(acc, v), values[0]!), end, fail);
  };

/** Right-associative chain: `term (op term)*`, folded right. */
export const chainr1 = <T, I = string>(term: Parser<T, I>, op: Parser<(a: T, b: T) => T, I>): Parser<T, I> =>
  (input, pos) => {
    const r = term(input, pos);
    if (!r.ok) return r;
    const s = separated(term, op, false, input, r.value, r.pos, r.failure);
    if (!s.ok) return s;
    const { values, seps, pos: end, fail } = s;
    const last = values[values.length - 1]!;
    return success(values.slice(0, -1).reduceRight((acc, v, i) => seps[i]!(v, acc), last), end, fail);
  };
