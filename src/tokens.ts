// Primitives for non-string input: arrays of tokens (e.g. from a separate
// lexer) or bytes (`Uint8Array`). Combine them with the generic combinators.

import { failure, success, type Parser } from "./core.ts";

/** Match one token that satisfies `pred`. */
export const satisfyToken = <Tok>(pred: (token: Tok) => boolean, name: string): Parser<Tok, ArrayLike<Tok>> =>
  (input, pos) => {
    if (pos >= input.length) return failure([name], pos);
    const token = input[pos]!;
    return pred(token) ? success(token, pos + 1) : failure([name], pos);
  };

/** Match any one token. Fails only at end of input. */
export const anyToken = <Tok>(): Parser<Tok, ArrayLike<Tok>> => satisfyToken<Tok>(() => true, "any token");

/** Match one token equal (`===`) to `value`. */
export const matchToken = <Tok>(value: Tok, name: string = describeToken(value)): Parser<Tok, ArrayLike<Tok>> =>
  satisfyToken<Tok>((t) => t === value, name);

/** @internal Render a token for error messages. */
export const describeToken = (token: unknown): string => {
  if (typeof token === "string") return JSON.stringify(token);
  if (typeof token === "number" || typeof token === "bigint" || typeof token === "boolean") return String(token);
  try {
    return JSON.stringify(token) ?? String(token);
  } catch {
    return String(token);
  }
};
