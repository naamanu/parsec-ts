import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  alt, anyChar, between, chain, chainl1, chainr1, eof, fail, formatFailure, label, lazy, left, lookahead, many, many1,
  manyTill, map, not, optional, parse, position, regex, right, satisfy, sepBy, sepBy1, sepEndBy, seq, str, succeed, withSpan,
  type Parser, type ParseResult,
} from "../src/index.ts";
import { calc } from "../examples/calc.ts";
import { parseJson } from "../examples/json.ts";

const ok = <T>(value: T) => ({ ok: true, value });

/** Assert a parse failed, returning the failure for further checks. */
const failed = <T>(r: ParseResult<T>) => {
  assert.equal(r.ok, false, `expected failure, got ${JSON.stringify(r)}`);
  return (r as Extract<ParseResult<T>, { ok: false }>).error;
};

const digit = regex(/\d/, "digit");

describe("primitives", () => {
  test("str", () => {
    assert.deepEqual(parse(str("abc"), "abc"), ok("abc"));
    assert.deepEqual(failed(parse(str("abc"), "abd")).expected, ['"abc"']);
  });

  test("regex matches at the position, with whole-input context", () => {
    assert.deepEqual(parse(seq(str("a"), regex(/(?<=a)b/)), "ab"), ok(["a", "b"]));
    assert.equal(parse(seq(str("a"), regex(/^b/)), "ab").ok, false);
  });

  test("regex is stateless, even with g/y flags", () => {
    const p = many(regex(/\d/g));
    assert.deepEqual(parse(p, "123"), ok(["1", "2", "3"]));
    assert.deepEqual(parse(p, "123"), ok(["1", "2", "3"]));
  });

  test("regex scales to large inputs", () => {
    const r = parse(many(regex(/a/)), "a".repeat(1_000_000));
    assert.ok(r.ok && r.value.length === 1_000_000);
  });

  test("satisfy handles astral code points", () => {
    assert.deepEqual(parse(many(satisfy((c) => c !== "x", "not x")), "😀é"), ok(["😀", "é"]));
    assert.deepEqual(parse(anyChar, "😀"), ok("😀"));
    assert.deepEqual(failed(parse(anyChar, "")).expected, ["any character"]);
  });

  test("succeed, fail, eof", () => {
    assert.deepEqual(parse(succeed(42), ""), ok(42));
    assert.deepEqual(failed(parse(fail("nothing"), "")).expected, ["nothing"]);
    assert.deepEqual(failed(parse(eof, "x")).expected, ["end of input"]);
  });
});

describe("combinators", () => {
  test("map, seq, left, right, between", () => {
    assert.deepEqual(parse(map(digit, Number), "7"), ok(7));
    assert.deepEqual(parse(seq(str("a"), str("b")), "ab"), ok(["a", "b"]));
    assert.deepEqual(parse(left(str("a"), str("b")), "ab"), ok("a"));
    assert.deepEqual(parse(right(str("a"), str("b")), "ab"), ok("b"));
    assert.deepEqual(parse(between(str("("), digit, str(")")), "(1)"), ok("1"));
  });

  test("chain enables context-sensitive parsing", () => {
    const lengthPrefixed = chain(map(regex(/\d+/), Number), (n) => right(str(":"), regex(new RegExp(`.{${n}}`, "s"))));
    assert.deepEqual(parse(lengthPrefixed, "3:abc"), ok("abc"));
    assert.equal(parse(lengthPrefixed, "3:ab").ok, false);
    assert.equal(parse(lengthPrefixed, "2:abc").ok, false);
  });

  test("alt is ordered, backtracking choice", () => {
    assert.deepEqual(parse(alt(str("ab"), str("a")), "a"), ok("a"));
    assert.deepEqual(parse(alt(right(str("a"), str("x")), str("ab")), "ab"), ok("ab"));
  });

  test("many, many1, optional", () => {
    assert.deepEqual(parse(many(digit), ""), ok([]));
    assert.deepEqual(parse(many1(digit), "123"), ok(["1", "2", "3"]));
    assert.deepEqual(failed(parse(many1(digit), "")).expected, ["digit"]);
    assert.deepEqual(parse(optional(digit), ""), ok(null));
  });

  test("many stops on zero-width success", () => {
    assert.deepEqual(parse(many(succeed(1)), ""), ok([]));
  });

  test("manyTill", () => {
    const comment = right(str("/*"), map(manyTill(anyChar, str("*/")), (cs) => cs.join("")));
    assert.deepEqual(parse(comment, "/* hi */"), ok(" hi "));
    assert.deepEqual(failed(parse(comment, "/* hi")).expected, ['"*/"', "any character"]);
  });

  test("sepBy, sepBy1, sepEndBy", () => {
    const comma = str(",");
    assert.deepEqual(parse(sepBy(digit, comma), "1,2,3"), ok(["1", "2", "3"]));
    assert.deepEqual(parse(sepBy(digit, comma), ""), ok([]));
    assert.equal(parse(sepBy1(digit, comma), "").ok, false);
    assert.equal(parse(sepBy(digit, comma), "1,2,").ok, false);
    assert.deepEqual(parse(sepEndBy(digit, comma), "1,2,"), ok(["1", "2"]));
    assert.deepEqual(parse(sepEndBy(digit, comma), "1,2"), ok(["1", "2"]));
    assert.equal(parse(sepEndBy(digit, comma), ",").ok, false);
  });

  test("lookahead and not consume nothing", () => {
    assert.deepEqual(parse(right(lookahead(str("a")), str("ab")), "ab"), ok("ab"));
    const notX = right(not(str("x"), "not x"), anyChar);
    assert.deepEqual(parse(notX, "y"), ok("y"));
    assert.deepEqual(failed(parse(notX, "x")).expected, ["not x"]);
  });

  test("chainl1 and chainr1 associativity", () => {
    const n = map(digit, Number);
    const minus = map(str("-"), () => (a: number, b: number) => a - b);
    assert.deepEqual(parse(chainl1(n, minus), "9-3-2"), ok(4));
    assert.deepEqual(parse(chainr1(n, minus), "9-3-2"), ok(8));
  });

  test("position and withSpan report input offsets", () => {
    assert.deepEqual(parse(right(str("ab"), position), "ab"), ok(2));
    const word = withSpan(regex(/[a-z]+/));
    assert.deepEqual(parse(sepBy(word, str(" ")), "hi there"), ok([
      { value: "hi", start: 0, end: 2 },
      { value: "there", start: 3, end: 8 },
    ]));
  });

  test("lazy builds its parser only once", () => {
    let calls = 0;
    const p: Parser<string> = lazy(() => (calls++, str("a")));
    parse(many(p), "aaa");
    parse(many(p), "aaa");
    assert.equal(calls, 1);
  });
});

describe("errors", () => {
  test("alt merges what every alternative expected", () => {
    assert.deepEqual(failed(parse(alt(str("a"), str("b"), digit), "x")).expected, ['"a"', '"b"', "digit"]);
  });

  test("failures from repetition are kept", () => {
    assert.deepEqual(failed(parse(many(digit), "12x")).expected, ["digit", "end of input"]);
  });

  test("the furthest failure wins", () => {
    const p = alt(seq(str("a"), str("b"), str("c")), str("x"));
    const e = failed(parse(p, "abd"));
    assert.equal(e.pos, 2);
    assert.deepEqual(e.expected, ['"c"']);
  });

  test("label renames failures at the start, but not after consuming input", () => {
    assert.deepEqual(failed(parse(label(many1(digit), "integer"), "x")).expected, ["integer"]);
    assert.deepEqual(failed(parse(label(seq(str("a"), str("b")), "ab"), "ac")).expected, ['"b"']);
  });

  test("failures report what was found", () => {
    assert.equal(failed(parse(str("a"), "😀")).found, '"😀"');
    assert.equal(failed(parse(str("a"), "")).found, "end of input");
    assert.equal(formatFailure(failed(parse(alt(), "z"))), "Parse error at line 1, column 1: unexpected \"z\"");
  });

  test("formatFailure reports line, column and alternatives", () => {
    const e = failed(parse(seq(str("a\n"), alt(str("b"), str("c"), str("d"))), "a\nx"));
    assert.equal(formatFailure(e), 'Parse error at line 2, column 1: unexpected "x", expected "b", "c" or "d"');
  });
});

describe("calculator example", () => {
  test("precedence, associativity, parentheses", () => {
    assert.deepEqual(calc("1 + 2 * 3"), ok(7));
    assert.deepEqual(calc("(1 + 2) * 3"), ok(9));
    assert.deepEqual(calc("10 - 4 - 3"), ok(3));
    assert.deepEqual(calc(" 8 / 2 / 2 "), ok(2));
    assert.deepEqual(calc("2 ^ 3 ^ 2"), ok(512));
  });

  test("errors list every acceptable token", () => {
    assert.equal(
      formatFailure(failed(calc("1 x"))),
      'Parse error at line 1, column 3: unexpected "x", expected "^", "*", "/", "+", "-" or end of input',
    );
    assert.equal(formatFailure(failed(calc("1 +"))), 'Parse error at line 1, column 4: unexpected end of input, expected number or "("');
  });
});

describe("JSON example", () => {
  test("agrees with JSON.parse", () => {
    const docs = [
      "null", "true", "false", "0", "-12.5e-3", '""', '"a\\"b\\\\c\\/\\n\\u00e9"', "[]", "{}",
      ' { "a" : [1, 2, {"b": null}], "c": "d", "__proto__": 1 } ',
      JSON.stringify({ nested: [[[]]], unicode: "😀 日本", n: 1e21 }, null, 2),
    ];
    for (const doc of docs) assert.deepEqual(parseJson(doc), ok(JSON.parse(doc)), doc);
  });

  test("handles deep nesting", () => {
    const depth = 1200;
    assert.equal(parseJson("[".repeat(depth) + "]".repeat(depth)).ok, true);
  });

  test("rejects invalid documents", () => {
    for (const doc of ["", "[1,]", "{,}", "01", '"\\x"', '"a', "tru", '{"a" 1}', "[1 2]"]) {
      assert.equal(parseJson(doc).ok, false, doc);
    }
  });

  test("reports a useful error", () => {
    const e = failed(parseJson('{"a": }'));
    assert.equal(e.column, 7);
    assert.ok(e.expected.includes("string") && e.expected.includes("number"));
  });
});
