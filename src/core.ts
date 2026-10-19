/**
 * Core types and the internal helpers every combinator builds on.
 *
 * Every exported function in this library is referentially transparent: same
 * arguments, same result, no observable side effects, and failures are
 * returned as values rather than thrown. Some combinators use loops or local
 * mutable state internally, because JavaScript has no tail-call elimination
 * and recursion would overflow the stack on long inputs. That state never
 * escapes the call that created it.
 */

/** Anything a parser can read: a string, an array of tokens, or bytes. */
export type Input = string | ArrayLike<unknown>;

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

/**
 * A parser is a pure function from (input, position) to a Result. `I` is the
 * input type; it defaults to `string`.
 */
export type Parser<T, I = string> = (input: I, pos: number) => Result<T>;

/**
 * A parser that works on any input type, such as `succeed(x)` or `eof`. The
 * input type is left unconstrained so that, combined with e.g. a string
 * parser, the inferred input is plain `string` (`string & unknown`).
 */
export type AnyParser<T> = <I>(input: I, pos: number) => Result<T>;

/** The value type a parser produces: `ParserValue<typeof p>`. */
export type ParserValue<P> = P extends (input: any, pos: number) => Result<infer T> ? T : never;

/**
 * The input type that every parser in the union `P` can read. Inferring from
 * the contravariant parameter position intersects the union's input types.
 */
export type ParserInput<P> = [P] extends [(input: infer I, pos: number) => any] ? I : never;

/** @internal */
export type Failed = Extract<Result<never>, { ok: false }>;

/** @internal */
export const success = <T>(value: T, pos: number, failure?: Failure): Result<T> =>
  failure ? { ok: true, value, pos, failure } : { ok: true, value, pos };

/** @internal */
export const failure = (expected: readonly string[], pos: number): Failed =>
  ({ ok: false, failure: { pos, expected } });

/** @internal A failure with new details that keeps `r`'s fatality (see `cut`). */
export const failWith = (r: Failed, failure: Failure): Failed =>
  r.fatal ? { ok: false, failure, fatal: true } : { ok: false, failure };

/** @internal Keep the furthest failure; at the same position, combine what was expected. */
export function merge(a: Failure | undefined, b: Failure): Failure;
export function merge(a: Failure | undefined, b: Failure | undefined): Failure | undefined;
export function merge(a: Failure | undefined, b: Failure | undefined): Failure | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.pos !== b.pos) return a.pos > b.pos ? a : b;
  return { pos: a.pos, expected: [...new Set([...a.expected, ...b.expected])] };
}
