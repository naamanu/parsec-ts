// Two-stage parsing: a string lexer produces tokens that carry their source
// position, then a token parser builds the result. Errors from the second
// stage still point at the right line and column of the original source.
import {
  alt, between, chainl1, lazy, lexeme, many, map, parse, regex, right, satisfyToken, whitespace, withSpan,
  type Parser, type ParseResult,
} from "../src/index.ts";

export type Token = {
  readonly kind: "num" | "op" | "lparen" | "rparen";
  readonly text: string;
  /** Offset of the token in the source text. */
  readonly start: number;
};

// Stage 1: characters -> tokens.

const tokenKind = (text: string): Token["kind"] =>
  /^\d/.test(text) ? "num" : text === "(" ? "lparen" : text === ")" ? "rparen" : "op";

const token: Parser<Token> = map(
  withSpan(regex(/\d+|[-+*\/()]/, "token")),
  ({ value, start }) => ({ kind: tokenKind(value), text: value, start }),
);

export const lex = (source: string): ParseResult<readonly Token[]> =>
  parse(right(whitespace, many(lexeme(token))), source);

// Stage 2: tokens -> value.

type Tokens = readonly Token[];
type BinOp = (a: number, b: number) => number;

const kind = (k: Token["kind"], name: string) => satisfyToken((t: Token) => t.kind === k, name);
const op = (text: string, f: BinOp): Parser<BinOp, Tokens> =>
  map(satisfyToken((t: Token) => t.kind === "op" && t.text === text, JSON.stringify(text)), () => f);

const num = map(kind("num", "number"), (t) => Number(t.text));
const expr: Parser<number, Tokens> = lazy(() =>
  chainl1(term, alt(op("+", (a, b) => a + b), op("-", (a, b) => a - b))),
);
const factor: Parser<number, Tokens> = alt(num, between(kind("lparen", '"("'), expr, kind("rparen", '")"')));
const term: Parser<number, Tokens> = chainl1(factor, alt(op("*", (a, b) => a * b), op("/", (a, b) => a / b)));

/** Lex, then parse, reporting errors from either stage against the source text. */
export const evaluate = (source: string): ParseResult<number> => {
  const lexed = lex(source);
  if (!lexed.ok) return lexed;
  const tokens = lexed.value;
  return parse(expr, tokens, {
    describe: (ts, pos) => JSON.stringify(ts[pos]!.text),
    locate: (_, pos) => {
      const offset = pos < tokens.length ? tokens[pos]!.start : source.length;
      const lines = source.slice(0, offset).split("\n");
      return { line: lines.length, column: [...lines[lines.length - 1]!].length + 1 };
    },
  });
};
