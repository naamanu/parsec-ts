import { failure, success, type Parser } from "./core.ts";
import { left } from "./combinators.ts";

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

// Lexing helpers

/** Zero or more whitespace characters (`\s*`). */
export const whitespace: Parser<string> = regex(/\s*/, "whitespace");

/** Run `p`, then skip trailing whitespace (or whatever `ws` matches). */
export const lexeme = <T>(p: Parser<T>, ws: Parser<unknown> = whitespace): Parser<T> => left(p, ws);

/** Match the literal `s`, then skip trailing whitespace. */
export const symbol = (s: string, ws: Parser<unknown> = whitespace): Parser<string> => lexeme(str(s), ws);
