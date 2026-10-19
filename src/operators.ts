import { failWith, merge, success, type Parser } from "./core.ts";
import { alt, chainl1, chainr1, many } from "./combinators.ts";

/** One precedence level of an `operators` table. */
export type OperatorLevel<T, I = string> =
  | {
    /** Associativity of the binary operators at this level. */
    readonly infix: "left" | "right";
    /** Parsers for the operators, each returning the function it applies. */
    readonly ops: readonly Parser<(a: T, b: T) => T, I>[];
  }
  | {
    /** Parsers for prefix operators, each returning the function it applies. */
    readonly prefix: readonly Parser<(a: T) => T, I>[];
  }
  | {
    /** Parsers for postfix operators, each returning the function it applies. */
    readonly postfix: readonly Parser<(a: T) => T, I>[];
  };

/**
 * Build an expression parser from `atom` and a table of operator levels,
 * ordered from highest precedence (binds tightest) to lowest:
 *
 * ```ts
 * const expr = operators(atom, [
 *   { postfix: [op("!", factorial)] },
 *   { prefix: [op("-", (x) => -x)] },
 *   { infix: "right", ops: [op("^", (a, b) => a ** b)] },
 *   { infix: "left", ops: [op("*", mul), op("/", div)] },
 *   { infix: "left", ops: [op("+", add), op("-", sub)] },
 * ]);
 * ```
 *
 * Prefix and postfix operators may repeat (`--x`, `x!!`); the one nearest the
 * operand applies first.
 */
export const operators = <T, I = string>(atom: Parser<T, I>, table: readonly OperatorLevel<T, I>[]): Parser<T, I> =>
  table.reduce<Parser<T, I>>((term, level) => {
    if ("infix" in level) {
      const op = alt(...level.ops) as Parser<(a: T, b: T) => T, I>;
      return level.infix === "left" ? chainl1(term, op) : chainr1(term, op);
    }
    if ("prefix" in level) return prefixed(alt(...level.prefix) as Parser<(a: T) => T, I>, term);
    return postfixed(term, alt(...level.postfix) as Parser<(a: T) => T, I>);
  }, atom);

/** `op* term`, applying the operators innermost-first. */
const prefixed = <T, I>(op: Parser<(a: T) => T, I>, term: Parser<T, I>): Parser<T, I> => {
  const ops = many(op);
  return (input, pos) => {
    const ro = ops(input, pos);
    if (!ro.ok) return ro;
    const rt = term(input, ro.pos);
    if (!rt.ok) return failWith(rt, merge(ro.failure, rt.failure));
    return success(ro.value.reduceRight((acc, f) => f(acc), rt.value), rt.pos, merge(ro.failure, rt.failure));
  };
};

/** `term op*`, applying the operators innermost-first. */
const postfixed = <T, I>(term: Parser<T, I>, op: Parser<(a: T) => T, I>): Parser<T, I> => {
  const ops = many(op);
  return (input, pos) => {
    const rt = term(input, pos);
    if (!rt.ok) return rt;
    const ro = ops(input, rt.pos);
    if (!ro.ok) return failWith(ro, merge(rt.failure, ro.failure));
    return success(ro.value.reduce((acc, f) => f(acc), rt.value), ro.pos, merge(rt.failure, ro.failure));
  };
};
