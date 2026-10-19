/**
 * Data-last versions of the combinators, for use with `pipe`:
 *
 * ```ts
 * import { pipe, regex } from "parsec-ts";
 * import * as P from "parsec-ts/fp";
 *
 * const int = pipe(regex(/-?\d+/), P.map(Number), P.label("integer"), P.lexeme());
 * const list = pipe(int, P.sepBy(symbol(",")), P.between(symbol("["), symbol("]")));
 * ```
 *
 * Each function takes every argument except the parser being transformed,
 * and returns a function of that parser: `P.map(f)(p)` is `map(p, f)`.
 * Combinators that only take a parser (`many`, `cut`, ...) are re-exported
 * unchanged, since they already fit.
 *
 * @module
 */

import type { Parser } from "./core.ts";
import * as C from "./combinators.ts";
import type { OperatorLevel } from "./operators.ts";
import { operators as operatorsFn } from "./operators.ts";
import { recover as recoverFn, type Recovered } from "./recovery.ts";
import { lexeme as lexemeFn, whitespace } from "./text.ts";

export { attempt, cut, lookahead, many, many1, withSpan } from "./combinators.ts";
export { pipe } from "./pipe.ts";

/** `P.map(f)(p)` is `map(p, f)`. */
export const map = <A, B>(f: (a: A) => B) => <I>(p: Parser<A, I>): Parser<B, I> => C.map(p, f);

/** `P.chain(f)(p)` is `chain(p, f)`. */
export const chain = <A, B, I>(f: (a: A) => Parser<B, I>) => (p: Parser<A, I>): Parser<B, I> => C.chain(p, f);

/** `P.label(name)(p)` is `label(p, name)`. */
export const label = (name: string) => <T, I>(p: Parser<T, I>): Parser<T, I> => C.label(p, name);

/** `P.context(name)(p)` is `context(name, p)`. */
export const context = (name: string) => <T, I>(p: Parser<T, I>): Parser<T, I> => C.context(name, p);

/** `P.left(b)(a)` is `left(a, b)`: run `a`, then `b`, keep `a`'s value. */
export const left = <I>(b: Parser<unknown, I>) => <A>(a: Parser<A, I>): Parser<A, I> => C.left(a, b);

/** `P.right(b)(a)` is `right(a, b)`: run `a`, then `b`, keep `b`'s value. */
export const right = <B, I>(b: Parser<B, I>) => (a: Parser<unknown, I>): Parser<B, I> => C.right(a, b);

/** `P.between(open, close)(p)` is `between(open, p, close)`. */
export const between = <I>(open: Parser<unknown, I>, close: Parser<unknown, I>) => <T>(p: Parser<T, I>): Parser<T, I> =>
  C.between(open, p, close);

/** `P.not(expected?)(p)` is `not(p, expected)`. */
export const not = (expected?: string) => <I>(p: Parser<unknown, I>): Parser<null, I> => C.not(p, expected);

/** `P.optional(fallback?)(p)` is `optional(p, fallback)`; with no fallback, `null`. */
export function optional(): <T, I>(p: Parser<T, I>) => Parser<T | null, I>;
export function optional<D>(fallback: D): <T, I>(p: Parser<T, I>) => Parser<T | D, I>;
export function optional<D>(...args: [D?]) {
  return <T, I>(p: Parser<T, I>) => (args.length ? C.optional(p, args[0] as D) : C.optional(p));
}

/** `P.count(n)(p)` is `count(n, p)`. */
export const count = (n: number) => <T, I>(p: Parser<T, I>): Parser<readonly T[], I> => C.count(n, p);

/** `P.manyTill(end)(p)` is `manyTill(p, end)`. */
export const manyTill = <I>(end: Parser<unknown, I>) => <T>(p: Parser<T, I>): Parser<readonly T[], I> => C.manyTill(p, end);

/** `P.sepBy(sep)(p)` is `sepBy(p, sep)`. */
export const sepBy = <I>(sep: Parser<unknown, I>) => <T>(p: Parser<T, I>): Parser<readonly T[], I> => C.sepBy(p, sep);

/** `P.sepBy1(sep)(p)` is `sepBy1(p, sep)`. */
export const sepBy1 = <I>(sep: Parser<unknown, I>) => <T>(p: Parser<T, I>): Parser<readonly T[], I> => C.sepBy1(p, sep);

/** `P.sepEndBy(sep)(p)` is `sepEndBy(p, sep)`. */
export const sepEndBy = <I>(sep: Parser<unknown, I>) => <T>(p: Parser<T, I>): Parser<readonly T[], I> => C.sepEndBy(p, sep);

/** `P.chainl1(op)(term)` is `chainl1(term, op)`. */
export const chainl1 = <T, I>(op: Parser<(a: T, b: T) => T, I>) => (term: Parser<T, I>): Parser<T, I> => C.chainl1(term, op);

/** `P.chainr1(op)(term)` is `chainr1(term, op)`. */
export const chainr1 = <T, I>(op: Parser<(a: T, b: T) => T, I>) => (term: Parser<T, I>): Parser<T, I> => C.chainr1(term, op);

/** `P.operators(table)(atom)` is `operators(atom, table)`. */
export const operators = <T, I>(table: readonly OperatorLevel<T, I>[]) => (atom: Parser<T, I>): Parser<T, I> =>
  operatorsFn(atom, table);

/** `P.recover(sync)(p)` is `recover(p, sync)`. */
export const recover = <I>(sync: Parser<unknown, I>) => <T>(p: Parser<T, I>): Parser<Recovered<T>, I> => recoverFn(p, sync);

/** `P.lexeme(ws?)(p)` is `lexeme(p, ws)`. */
export const lexeme = (ws: Parser<unknown> = whitespace) => <T>(p: Parser<T>): Parser<T> => lexemeFn(p, ws);
