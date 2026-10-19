import type { Input, Parser } from "./core.ts";
import { eof, left } from "./combinators.ts";
import { describeToken } from "./tokens.ts";

/** Failure from `parse`, with a human-friendly location. */
export type ParseFailure = {
  readonly expected: readonly string[];
  /** What was actually at `pos`: a quoted character or token, or "end of input". */
  readonly found: string;
  /** Offset into the input: UTF-16 code units for strings, element index otherwise. */
  readonly pos: number;
  /** 1-based. For strings, `\n`, `\r\n` and `\r` each end a line. */
  readonly line: number;
  /**
   * 1-based. For strings it's counted in Unicode code points, so an emoji is
   * one column; for other input it's the element index + 1, unless `locate`
   * says otherwise.
   */
  readonly column: number;
};

/** Outcome of `parse`: the value, or a located failure. */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ParseFailure };

/** Options for `parse`, mainly to give good errors on non-string input. */
export type ParseOptions<I> = {
  /** Describe the input at `pos`, for `found`. Only called when `pos` is before the end. */
  readonly describe?: (input: I, pos: number) => string;
  /**
   * Map an offset to a 1-based line and column, e.g. using source positions
   * a lexer stored in its tokens.
   */
  readonly locate?: (input: I, pos: number) => { line: number; column: number };
};

const locateText = (input: string, pos: number): { line: number; column: number } => {
  const lines = input.slice(0, pos).split(/\r\n|\r|\n/);
  return { line: lines.length, column: [...lines[lines.length - 1]!].length + 1 };
};

const describeText = (input: string, pos: number): string =>
  JSON.stringify(String.fromCodePoint(input.codePointAt(pos)!));

const defaultDescribe = (input: Input, pos: number): string =>
  typeof input === "string" ? describeText(input, pos)
  : input instanceof Uint8Array ? `0x${input[pos]!.toString(16).padStart(2, "0")}`
  : describeToken(input[pos]);

const defaultLocate = (input: Input, pos: number): { line: number; column: number } =>
  typeof input === "string" ? locateText(input, pos) : { line: 1, column: pos + 1 };

/** Parse the whole input. Never throws; failures are returned as values. */
export const parse = <T, I extends Input>(p: Parser<T, I>, input: I, options: ParseOptions<I> = {}): ParseResult<T> => {
  const r = left(p, eof)(input, 0);
  if (r.ok) return { ok: true, value: r.value };
  const { pos, expected } = r.failure;
  const found = pos >= input.length ? "end of input" : (options.describe ?? defaultDescribe)(input, pos);
  const { line, column } = (options.locate ?? defaultLocate)(input, pos);
  return { ok: false, error: { expected, found, pos, line, column } };
};

const orList = (xs: readonly string[]): string =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

/** Render a failure as `Parse error at line L, column C: unexpected X, expected A, B or C`. */
export const formatFailure = (e: ParseFailure): string =>
  `Parse error at line ${e.line}, column ${e.column}: unexpected ${e.found}` +
  (e.expected.length ? `, expected ${orList(e.expected)}` : "");
