import { alt, between, chainl1, chainr1, label, lazy, left, map, parse, regex, right, str, type Parser, type ParseResult } from "../src/index.ts";

const ws = regex(/\s*/);

// Every token swallows trailing whitespace.
const token = <T>(p: Parser<T>): Parser<T> => left(p, ws);

const num = token(label(map(regex(/\d+(\.\d+)?/), Number), "number"));
const op = (c: string, f: (a: number, b: number) => number) => token(map(str(c), () => f));

// expr   := term (('+' | '-') term)*
// term   := power (('*' | '/') power)*
// power  := factor ('^' power)?
// factor := number | '(' expr ')'
const expr: Parser<number> = lazy(() =>
  chainl1(term, alt(op("+", (a, b) => a + b), op("-", (a, b) => a - b))),
);
const factor: Parser<number> = alt(num, between(token(str("(")), expr, token(str(")"))));
const power: Parser<number> = chainr1(factor, op("^", (a, b) => a ** b));
const term: Parser<number> = chainl1(power, alt(op("*", (a, b) => a * b), op("/", (a, b) => a / b)));

export const calc = (input: string): ParseResult<number> => parse(right(ws, expr), input);
