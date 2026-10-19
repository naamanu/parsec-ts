/** Outcome of running a parser at a position: either a value and the new position, or a failure. */
export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly pos: number }
  | { readonly ok: false; readonly expected: string; readonly pos: number };

/** A parser is a pure function from (input, position) to a Result. */
export type Parser<T> = (input: string, pos: number) => Result<T>;

/** Failure from `parse`, with a human-friendly location. */
export type ParseFailure = {
  readonly expected: string;
  readonly pos: number;
  readonly line: number;
  readonly column: number;
};

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ParseFailure };

const success = <T>(value: T, pos: number): Result<T> => ({ ok: true, value, pos });
const failure = (expected: string, pos: number): Result<never> => ({ ok: false, expected, pos });

// Primitives

export const succeed = <T>(value: T): Parser<T> => (_, pos) => success(value, pos);

export const str = (s: string): Parser<string> => (input, pos) =>
  input.startsWith(s, pos) ? success(s, pos + s.length) : failure(JSON.stringify(s), pos);

/**
 * Match a regular expression at the current position. The pattern is anchored
 * to the position (no `^`/`$`/lookbehind relative to the full input), and the
 * `g`/`y` flags are ignored, so no regex state is ever mutated.
 */
export const regex = (re: RegExp, name = String(re)): Parser<string> => {
  const anchored = new RegExp(`^(?:${re.source})`, re.flags.replace(/[gy]/g, ""));
  return (input, pos) => {
    const m = anchored.exec(input.slice(pos));
    return m ? success(m[0], pos + m[0].length) : failure(name, pos);
  };
};

export const eof: Parser<null> = (input, pos) =>
  pos === input.length ? success(null, pos) : failure("end of input", pos);

// Combinators

export const map = <A, B>(p: Parser<A>, f: (a: A) => B): Parser<B> => (input, pos) => {
  const r = p(input, pos);
  return r.ok ? success(f(r.value), r.pos) : r;
};

type Values<Ps extends readonly Parser<any>[]> = {
  [K in keyof Ps]: Ps[K] extends Parser<infer T> ? T : never;
};

/** Run parsers in order, collecting every value into a tuple. */
export const seq = <Ps extends readonly Parser<any>[]>(...ps: Ps): Parser<Values<Ps>> => {
  const go = (input: string, i: number, pos: number, acc: readonly unknown[]): Result<Values<Ps>> => {
    if (i === ps.length) return success(acc as Values<Ps>, pos);
    const r = ps[i]!(input, pos);
    return r.ok ? go(input, i + 1, r.pos, [...acc, r.value]) : r;
  };
  return (input, pos) => go(input, 0, pos, []);
};

/** Ordered choice. If every alternative fails, report the one that got furthest. */
export const alt = <Ts extends readonly unknown[]>(
  ...ps: { [K in keyof Ts]: Parser<Ts[K]> }
): Parser<Ts[number]> => {
  const go = (input: string, i: number, pos: number, best: Result<never> | undefined): Result<Ts[number]> => {
    if (i === ps.length) return best ?? failure("alternative", pos);
    const r = (ps[i] as Parser<Ts[number]>)(input, pos);
    if (r.ok) return r;
    return go(input, i + 1, pos, best && best.pos >= r.pos ? best : r);
  };
  return (input, pos) => go(input, 0, pos, undefined);
};

/**
 * Zero or more repetitions. Stops on failure, or if `p` succeeds without
 * consuming input (so it can't loop forever).
 *
 * This is the one place with a loop: JavaScript has no tail-call elimination,
 * so a recursive version would overflow the stack on long inputs. The mutation
 * is local and never escapes, so `many` is still referentially transparent.
 */
export const many = <T>(p: Parser<T>): Parser<readonly T[]> => (input, start) => {
  const values: T[] = [];
  let pos = start;
  for (;;) {
    const r = p(input, pos);
    if (!r.ok || r.pos === pos) return success(values, pos);
    values.push(r.value);
    pos = r.pos;
  }
};

export const many1 = <T>(p: Parser<T>): Parser<readonly T[]> =>
  map(seq(p, many(p)), ([first, rest]) => [first, ...rest]);

export const optional = <T>(p: Parser<T>): Parser<T | null> => alt(p, succeed(null));

export const sepBy1 = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> =>
  map(seq(p, many(map(seq(sep, p), ([, v]) => v))), ([first, rest]) => [first, ...rest]);

export const sepBy = <T>(p: Parser<T>, sep: Parser<unknown>): Parser<readonly T[]> =>
  alt(sepBy1(p, sep), succeed<readonly T[]>([]));

export const between = <T>(open: Parser<unknown>, p: Parser<T>, close: Parser<unknown>): Parser<T> =>
  map(seq(open, p, close), ([, v]) => v);

/** Defer construction so parsers can be mutually recursive. */
export const lazy = <T>(f: () => Parser<T>): Parser<T> => (input, pos) => f()(input, pos);

/** Left-associative chain: `term (op term)*`, folded left. */
export const chainl1 = <T>(term: Parser<T>, op: Parser<(a: T, b: T) => T>): Parser<T> =>
  map(seq(term, many(seq(op, term))), ([first, rest]) =>
    rest.reduce((acc, [f, b]) => f(acc, b), first),
  );

// Running

const locate = (input: string, pos: number): { line: number; column: number } => {
  const lines = input.slice(0, pos).split("\n");
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 };
};

/** Parse the whole input. Never throws; failures are returned as values. */
export const parse = <T>(p: Parser<T>, input: string): ParseResult<T> => {
  const r = map(seq(p, eof), ([v]) => v)(input, 0);
  return r.ok
    ? { ok: true, value: r.value }
    : { ok: false, error: { expected: r.expected, pos: r.pos, ...locate(input, r.pos) } };
};

export const formatFailure = (e: ParseFailure): string =>
  `Parse error at line ${e.line}, column ${e.column}: expected ${e.expected}`;
