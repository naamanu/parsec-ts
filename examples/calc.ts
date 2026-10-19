import {
  alt, between, chainl1, chainr1, label, lazy, lexeme, map, parse, regex, right, symbol, whitespace,
  type Parser, type ParseResult,
} from "../src/index.ts";

const num = lexeme(label(map(regex(/\d+(\.\d+)?/), Number), "number"));
const op = (c: string, f: (a: number, b: number) => number) => map(symbol(c), () => f);

// expr   := term (('+' | '-') term)*
// term   := power (('*' | '/') power)*
// power  := factor ('^' power)?
// factor := number | '(' expr ')'
const expr: Parser<number> = lazy(() =>
  chainl1(term, alt(op("+", (a, b) => a + b), op("-", (a, b) => a - b))),
);
const factor: Parser<number> = alt(num, between(symbol("("), expr, symbol(")")));
const power: Parser<number> = chainr1(factor, op("^", (a, b) => a ** b));
const term: Parser<number> = chainl1(power, alt(op("*", (a, b) => a * b), op("/", (a, b) => a / b)));

export const calc = (input: string): ParseResult<number> => parse(right(whitespace, expr), input);
