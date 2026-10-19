import { alt, between, chainl1, lazy, map, parse, regex, seq, str, type Parser, type ParseResult } from "../src/index.ts";

// Every token swallows trailing whitespace.
const token = <T>(p: Parser<T>): Parser<T> => map(seq(p, regex(/\s*/)), ([v]) => v);

const num = token(map(regex(/\d+(\.\d+)?/, "number"), Number));
const op = (c: string, f: (a: number, b: number) => number) => token(map(str(c), () => f));

// expr   := term (('+' | '-') term)*
// term   := factor (('*' | '/') factor)*
// factor := number | '(' expr ')'
const expr: Parser<number> = lazy(() =>
  chainl1(term, alt(op("+", (a, b) => a + b), op("-", (a, b) => a - b))),
);
const term: Parser<number> = chainl1(
  lazy(() => factor),
  alt(op("*", (a, b) => a * b), op("/", (a, b) => a / b)),
);
const factor: Parser<number> = alt(num, between(token(str("(")), expr, token(str(")"))));

export const calc = (input: string): ParseResult<number> =>
  parse(map(seq(regex(/\s*/), expr), ([, v]) => v), input);
