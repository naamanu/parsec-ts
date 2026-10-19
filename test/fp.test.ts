import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/index.ts";
import { parse, pipe, regex, str, symbol, type Parser } from "../src/index.ts";
import * as P from "../src/fp.ts";

const digit = regex(/\d/, "digit");
const inputs = ["", "1", "12", "1,2", "[1,2]", "(1)", "1;", "x", "1+2+3", "1^2^3", "--1"];

/** Two parsers are equal if they give identical results at every position of every input. */
const same = (p: Parser<unknown>, q: Parser<unknown>) => {
  for (const s of inputs) for (let pos = 0; pos <= s.length; pos++) assert.deepEqual(p(s, pos), q(s, pos), `${s}@${pos}`);
};

describe("data-last combinators match their data-first versions", () => {
  const n = C.map(digit, Number);
  const add = C.map(str("+"), () => (a: number, b: number) => a + b);
  const cases: [string, Parser<unknown>, Parser<unknown>][] = [
    ["map", P.map(Number)(digit), C.map(digit, Number)],
    ["chain", P.chain((d: string) => str(d))(digit), C.chain(digit, (d) => str(d))],
    ["label", P.label("x")(digit), C.label(digit, "x")],
    ["context", P.context("x")(C.seq(digit, digit)), C.context("x", C.seq(digit, digit))],
    ["left", P.left(str(","))(digit), C.left(digit, str(","))],
    ["right", P.right(digit)(str("(")), C.right(str("("), digit)],
    ["between", P.between(str("("), str(")"))(digit), C.between(str("("), digit, str(")"))],
    ["not", P.not("no")(digit), C.not(digit, "no")],
    ["optional", P.optional()(digit), C.optional(digit)],
    ["optional fallback", P.optional(0)(digit), C.optional(digit, 0)],
    ["count", P.count(2)(digit), C.count(2, digit)],
    ["manyTill", P.manyTill(str(";"))(digit), C.manyTill(digit, str(";"))],
    ["sepBy", P.sepBy(str(","))(digit), C.sepBy(digit, str(","))],
    ["sepBy1", P.sepBy1(str(","))(digit), C.sepBy1(digit, str(","))],
    ["sepEndBy", P.sepEndBy(str(","))(digit), C.sepEndBy(digit, str(","))],
    ["chainl1", P.chainl1(add)(n), C.chainl1(n, add)],
    ["chainr1", P.chainr1(add)(n), C.chainr1(n, add)],
    ["operators", P.operators([{ infix: "left", ops: [add] }])(n), C.operators(n, [{ infix: "left", ops: [add] }])],
    ["recover", P.recover(C.skipUntil(str(";")))(digit), C.recover(digit, C.skipUntil(str(";")))],
    ["lexeme", P.lexeme()(digit), C.lexeme(digit)],
  ];
  for (const [name, p, q] of cases) test(name, () => same(p, q));

  test("unary combinators are the same functions", () => {
    assert.equal(P.many, C.many);
    assert.equal(P.cut, C.cut);
    assert.equal(P.withSpan, C.withSpan);
  });
});

describe("pipe", () => {
  test("applies functions left to right", () => {
    assert.equal(pipe(1), 1);
    assert.equal(pipe(1, (x) => x + 1, (x) => x * 10, String), "20");
  });

  test("builds parsers fluently", () => {
    const int = pipe(regex(/-?\d+/), P.map(Number), P.label("integer"), P.lexeme());
    const list = pipe(int, P.sepBy(symbol(",")), P.between(symbol("["), symbol("]")));
    assert.deepEqual(parse(list, "[1, -2 ,3]"), { ok: true, value: [1, -2, 3] });
    const e = parse(list, "[1, x]");
    assert.ok(!e.ok && e.error.expected.includes("integer"));
  });
});
