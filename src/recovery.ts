// Error recovery: keep parsing after an error so one run can report every
// error in the input. Recovered errors are returned in the parse tree as
// values (error nodes), not collected through hidden state.

import { success, type Failure, type Input, type Parser } from "./core.ts";
import type { Span } from "./combinators.ts";

/** The outcome of `recover(p, sync)`: `p`'s value, or an error node. */
export type Recovered<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false;
    /** Why `p` failed. Pass it to `locateFailure` for a line and column. */
    readonly failure: Failure;
    /** The input range `sync` skipped over, starting where `p` started. */
    readonly skipped: Span<null>;
  };

/**
 * Run `p`; if it fails, even fatally, record the failure and run `sync` from
 * where `p` started to skip the bad input, then carry on. Only if `sync`
 * also fails does `recover` fail.
 *
 * ```ts
 * const stmt = recover(statement, right(skipUntil(str(";")), str(";")));
 * const program = many(stmt); // parses every statement, good or bad
 * ```
 */
export const recover = <T, I = string>(p: Parser<T, I>, sync: Parser<unknown, I>): Parser<Recovered<T>, I> =>
  (input, pos) => {
    const r = p(input, pos);
    if (r.ok) return success({ ok: true, value: r.value }, r.pos, r.failure);
    const s = sync(input, pos);
    if (!s.ok) return s;
    // The original failure lives on in the error node, so it's not carried as
    // a pending failure: it mustn't resurface as the reason a later parser failed.
    return success({ ok: false, failure: r.failure, skipped: { value: null, start: pos, end: s.pos } }, s.pos);
  };

/** One step forward: a code point for strings, one element otherwise. */
const step = (input: Input, pos: number): number =>
  typeof input === "string" ? pos + String.fromCodePoint(input.codePointAt(pos)!).length : pos + 1;

/**
 * Skip input up to (not including) the first place `end` matches, or to the
 * end of input. Never fails. Useful as a `recover` sync parser.
 */
export const skipUntil = <I extends Input = string>(end: Parser<unknown, I>): Parser<null, I> => (input, start) => {
  let pos = start;
  while (pos < input.length && !end(input, pos).ok) pos = step(input, pos);
  return success(null, pos);
};
