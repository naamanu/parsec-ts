import { test } from "node:test";
import assert from "node:assert/strict";
import { alt, formatFailure, many, many1, optional, parse, regex, sepBy, seq, str } from "../src/index.ts";
import { calc } from "../examples/calc.ts";

const ok = <T>(value: T) => ({ ok: true, value });

test("str / alt / seq", () => {
  assert.deepEqual(parse(seq(str("a"), str("b")), "ab"), ok(["a", "b"]));
  assert.deepEqual(parse(alt(str("foo"), str("bar")), "bar"), ok("bar"));
});

test("many1 and optional", () => {
  assert.deepEqual(parse(many1(str("x")), "xxx"), ok(["x", "x", "x"]));
  assert.deepEqual(parse(optional(str("x")), ""), ok(null));
});

test("sepBy", () => {
  const list = sepBy(regex(/\d+/), str(","));
  assert.deepEqual(parse(list, "1,2,3"), ok(["1", "2", "3"]));
  assert.deepEqual(parse(list, ""), ok([]));
});

test("many handles long inputs without overflowing the stack", () => {
  const r = parse(many(str("x")), "x".repeat(200_000));
  assert.ok(r.ok && r.value.length === 200_000);
});

test("regex is stateless, even with g/y flags", () => {
  const p = regex(/\d/g);
  assert.deepEqual(parse(many(p), "123"), ok(["1", "2", "3"]));
  assert.deepEqual(parse(many(p), "123"), ok(["1", "2", "3"]));
});

test("failures are values with line and column", () => {
  const r = parse(seq(str("a\n"), str("b")), "a\nx");
  assert.ok(!r.ok);
  assert.equal(formatFailure(r.error), 'Parse error at line 2, column 1: expected "b"');
  const trailing = parse(str("a"), "ab");
  assert.ok(!trailing.ok && trailing.error.expected === "end of input");
});

test("calculator respects precedence, associativity, parens", () => {
  assert.deepEqual(calc("1 + 2 * 3"), ok(7));
  assert.deepEqual(calc("(1 + 2) * 3"), ok(9));
  assert.deepEqual(calc("10 - 4 - 3"), ok(3));
  assert.deepEqual(calc(" 8 / 2 / 2 "), ok(2));
  assert.equal(calc("1 +").ok, false);
});
