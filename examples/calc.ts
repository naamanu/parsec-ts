import {
  alt, between, label, lazy, lexeme, map, operators, parse, regex, right, symbol, whitespace,
  type Parser, type ParseResult,
} from "../src/index.ts";

const num = lexeme(label(map(regex(/\d+(\.\d+)?/), Number), "number"));
const binary = (c: string, f: (a: number, b: number) => number) => map(symbol(c), () => f);
const unary = (c: string, f: (a: number) => number) => map(symbol(c), () => f);

// Highest precedence first. `^` binds tighter than unary minus, so -2^2 = -4.
const expr: Parser<number> = lazy(() =>
  operators(atom, [
    { infix: "right", ops: [binary("^", (a, b) => a ** b)] },
    { prefix: [unary("-", (a) => -a)] },
    { infix: "left", ops: [binary("*", (a, b) => a * b), binary("/", (a, b) => a / b)] },
    { infix: "left", ops: [binary("+", (a, b) => a + b), binary("-", (a, b) => a - b)] },
  ]),
);
const atom: Parser<number> = alt(num, between(symbol("("), expr, symbol(")")));

export const calc = (input: string): ParseResult<number> => parse(right(whitespace, expr), input);
