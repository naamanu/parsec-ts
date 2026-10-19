import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  alt, anyChar, attempt, between, chain, chainl1, chainr1, cut, eof, fail, formatFailure, label, lazy, left, lookahead, many, many1,
  count, lexeme, manyTill, map, noneOf, not, oneOf, optional, parse, position, regex, right, satisfy, sepBy, sepBy1, sepEndBy, seq, str,
  struct, succeed, symbol, whitespace, withSpan, anyToken, matchToken, satisfyToken, operators, context,
  type Parser, type ParseResult,
} from "../src/index.ts";
import { calc } from "../examples/calc.ts";
import { parseJson } from "../examples/json.ts";
import { evaluate } from "../examples/tokens.ts";

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

  test("optional with a fallback", () => {
    assert.deepEqual(parse(optional(map(digit, Number), 0), ""), ok(0));
    assert.deepEqual(parse(optional(map(digit, Number), 0), "7"), ok(7));
  });

  test("oneOf and noneOf", () => {
    assert.deepEqual(parse(many(oneOf("+-😀")), "-😀+"), ok(["-", "😀", "+"]));
    assert.deepEqual(failed(parse(oneOf("ab"), "c")).expected, ['one of "ab"']);
    assert.deepEqual(parse(many(noneOf('"\\')), "ab😀"), ok(["a", "b", "😀"]));
    assert.equal(parse(noneOf("a"), "a").ok, false);
    assert.equal(parse(noneOf("a"), "").ok, false);
  });

  test("count", () => {
    const hex4 = map(count(4, regex(/[0-9a-f]/)), (cs) => cs.join(""));
    assert.deepEqual(parse(hex4, "beef"), ok("beef"));
    assert.equal(parse(hex4, "bee").ok, false);
    assert.equal(parse(hex4, "beefe").ok, false);
    assert.deepEqual(parse(count(0, digit), ""), ok([]));
  });

  test("struct collects named fields in key order", () => {
    const assignment = struct({
      name: lexeme(regex(/[a-z]+/)),
      _eq: symbol("="),
      value: map(regex(/\d+/), Number),
    });
    const r = parse(assignment, "x = 42");
    assert.deepEqual(r, ok({ name: "x", _eq: "=", value: 42 }));
    if (r.ok) {
      const value: number = r.value.value; // field types are inferred...
      // @ts-expect-error ...precisely, not as `any`
      const wrong: string = r.value.value;
      assert.equal(value, wrong);
    }
    assert.deepEqual(failed(parse(assignment, "x 42")).expected, ['"="']);
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

  test("whitespace, lexeme, symbol", () => {
    const list = right(whitespace, between(symbol("["), sepBy(lexeme(digit), symbol(",")), symbol("]")));
    assert.deepEqual(parse(list, " [ 1 ,\n2 ]  "), ok(["1", "2"]));
    const dots = regex(/\.*/);
    assert.deepEqual(parse(many(symbol("a", dots)), "a..a.a"), ok(["a", "a", "a"]));
    assert.equal(parse(symbol("a", dots), "a ").ok, false);
  });

  test("lazy builds its parser only once", () => {
    let calls = 0;
    const p: Parser<string> = lazy(() => (calls++, str("a")));
    parse(many(p), "aaa");
    parse(many(p), "aaa");
    assert.equal(calls, 1);
  });
});

describe("cut", () => {
  const ident = regex(/[a-z]+/, "identifier");
  const exprStmt = map(regex(/[a-z0-9 ]+/), (e) => ({ expr: e }));
  const letStmt = (commit: boolean) =>
    map(right(symbol("let"), commit ? cut(ident) : ident), (name) => ({ let: name }));

  test("without cut, a later alternative can misread the input", () => {
    assert.deepEqual(parse(alt(letStmt(false), exprStmt), "let 1"), ok({ expr: "let 1" }));
  });

  test("with cut, alt reports the committed failure", () => {
    const e = failed(parse(alt(letStmt(true), exprStmt), "let 1"));
    assert.deepEqual([e.column, e.expected], [5, ["identifier"]]);
  });

  test("fatal failures propagate through many, optional and sepBy", () => {
    // Without cut, each loop would stop before the broken "[x" and the
    // catch-all `rest` would swallow it. With cut, the failure surfaces.
    const item = right(str("["), cut(str("]")));
    const rest = regex(/.*/);
    const cases: [Parser<unknown>, string, number][] = [
      [left(many(item), rest), "[][x", 3],
      [left(optional(item), rest), "[x", 1],
      [left(sepBy(item, str(",")), rest), "[],[x", 4],
    ];
    for (const [p, input, pos] of cases) {
      const e = failed(parse(p, input));
      assert.deepEqual([e.pos, e.expected], [pos, ['"]"']], input);
    }
  });

  test("attempt restores backtracking", () => {
    assert.deepEqual(parse(alt(attempt(letStmt(true)), exprStmt), "let 1"), ok({ expr: "let 1" }));
  });

  test("not treats a fatal failure as failure", () => {
    assert.deepEqual(parse(right(not(cut(str("a"))), anyChar), "b"), ok("b"));
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

  test("columns count code points; lines end at \\n, \\r\\n or \\r", () => {
    const at = (input: string) => {
      const { line, column, pos } = failed(parse(many(noneOf("!")), input));
      return { line, column, pos };
    };
    assert.deepEqual(at("😀😀!"), { line: 1, column: 3, pos: 4 });
    assert.deepEqual(at("a\r\nb!"), { line: 2, column: 2, pos: 4 });
    assert.deepEqual(at("a\rb\nc!"), { line: 3, column: 2, pos: 5 });
  });

  test("context records where failures happened, innermost first", () => {
    const pair = context("pair", seq(str("("), digit, str(","), digit, str(")")));
    const list = context("list", between(str("["), sepBy(pair, str(";")), str("]")));
    const e = failed(parse(list, "[(1,2);(3x"));
    assert.deepEqual([e.pos, e.expected, e.context], [9, ['","'], ["pair", "list"]]);
    assert.match(formatFailure(e), /expected "," \(in pair, in list\)$/);
  });

  test("context ignores failures at its start, where it was never entered", () => {
    const tagged = context("tagged", seq(str("#"), digit));
    const e = failed(parse(alt(tagged, str("x")), "y"));
    assert.deepEqual([e.expected, e.context], [['"#"', '"x"'], []]);
  });

  test("context also annotates failures carried by a success", () => {
    // `many` inside the context fails at "x"; then eof fails there too.
    const e = failed(parse(context("digits", seq(str(":"), many(digit))), ":12x"));
    assert.deepEqual([e.pos, e.expected, e.context], [3, ["digit", "end of input"], ["digits"]]);
  });

  test("formatFailure reports line, column and alternatives", () => {
    const e = failed(parse(seq(str("a\n"), alt(str("b"), str("c"), str("d"))), "a\nx"));
    assert.equal(formatFailure(e), 'Parse error at line 2, column 1: unexpected "x", expected "b", "c" or "d"');
  });
});

describe("operators", () => {
  // A tiny grammar over single digits that builds strings, so the parse
  // tree shape is visible in the result.
  const atom = map(digit, (d) => d);
  const bin = (c: string) => map(str(c), () => (a: string, b: string) => `(${a}${c}${b})`);
  const pre = (c: string) => map(str(c), () => (a: string) => `(${c}${a})`);
  const post = (c: string) => map(str(c), () => (a: string) => `(${a}${c})`);
  const expr = operators(atom, [
    { postfix: [post("!")] },
    { prefix: [pre("-"), pre("~")] },
    { infix: "right", ops: [bin("^")] },
    { infix: "left", ops: [bin("*"), bin("/")] },
    { infix: "left", ops: [bin("+"), bin("-")] },
  ]);

  test("precedence and associativity follow the table", () => {
    assert.deepEqual(parse(expr, "1+2*3"), ok("(1+(2*3))"));
    assert.deepEqual(parse(expr, "1-2-3"), ok("((1-2)-3)"));
    assert.deepEqual(parse(expr, "1^2^3"), ok("(1^(2^3))"));
    assert.deepEqual(parse(expr, "1*2^3+4"), ok("((1*(2^3))+4)"));
  });

  test("prefix and postfix operators repeat, innermost first", () => {
    assert.deepEqual(parse(expr, "-~1"), ok("(-(~1))"));
    assert.deepEqual(parse(expr, "1!!"), ok("((1!)!)"));
    assert.deepEqual(parse(expr, "-1!"), ok("(-(1!))"));
    assert.deepEqual(parse(expr, "1--2"), ok("(1-(-2))"));
  });

  test("errors list operators from every level", () => {
    assert.deepEqual(failed(parse(expr, "1?")).expected, ['"!"', '"^"', '"*"', '"/"', '"+"', '"-"', "end of input"]);
    assert.deepEqual(failed(parse(expr, "1+")).expected, ['"-"', '"~"', "digit"]);
  });

  test("an empty table is just the atom", () => {
    assert.deepEqual(parse(operators(atom, []), "7"), ok("7"));
  });
});

describe("non-string input", () => {
  type Tok = { kind: "num" | "plus"; text: string };
  const n = (text: string): Tok => ({ kind: "num", text });
  const plusTok: Tok = { kind: "plus", text: "+" };
  const num = map(satisfyToken((t: Tok) => t.kind === "num", "number"), (t) => Number(t.text));
  const plus = satisfyToken((t: Tok) => t.kind === "plus", '"+"');
  const sum = map(sepBy1(num, plus), (xs) => xs.reduce((a, b) => a + b, 0));

  test("token arrays work with the generic combinators", () => {
    assert.deepEqual(parse(sum, [n("1"), plusTok, n("2"), plusTok, n("3")]), ok(6));
    assert.deepEqual(parse(seq(anyToken<Tok>(), eof, position), [n("1")]), ok([n("1"), null, 1]));
  });

  test("token errors describe the token and default to index columns", () => {
    const e = failed(parse(sum, [n("1"), n("2")]));
    assert.deepEqual([e.pos, e.column, e.found, e.expected], [1, 2, '{"kind":"num","text":"2"}', ['"+"', "end of input"]]);
    assert.equal(failed(parse(sum, [n("1"), plusTok])).found, "end of input");
  });

  test("describe and locate options customise errors", () => {
    const e = failed(parse(sum, [n("1"), n("2")], {
      describe: (ts, pos) => ts[pos]!.text,
      locate: (_, pos) => ({ line: 7, column: pos * 10 }),
    }));
    assert.deepEqual([e.found, e.line, e.column], ["2", 7, 10]);
  });

  test("matchToken and bytes", () => {
    const magic = seq(matchToken(0x89), matchToken(0x50, "P"), count(2, anyToken<number>()));
    assert.deepEqual(parse(magic, new Uint8Array([0x89, 0x50, 1, 2])), ok([0x89, 0x50, [1, 2]]));
    const e = failed(parse(magic, new Uint8Array([0x89, 0x51])));
    assert.deepEqual([e.found, e.expected], ["0x51", ["P"]]);
    assert.equal(failed(parse(matchToken("a"), ["b"])).expected[0], '"a"');
  });
});

describe("token example", () => {
  test("evaluates via a lexer and a token parser", () => {
    assert.deepEqual(evaluate("2 * (3 + 4)"), ok(14));
    assert.deepEqual(evaluate("10 - 4 - 3"), ok(3));
  });

  test("errors from either stage point into the source", () => {
    assert.equal(formatFailure(failed(evaluate("1 + x"))), 'Parse error at line 1, column 5: unexpected "x", expected token or end of input');
    assert.equal(formatFailure(failed(evaluate("1 +\n  2 3"))), 'Parse error at line 2, column 5: unexpected "3", expected "*", "/", "+", "-" or end of input');
    assert.equal(formatFailure(failed(evaluate("(1 + 2"))), 'Parse error at line 1, column 7: unexpected end of input, expected "*", "/", "+", "-" or ")"');
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
    assert.equal(formatFailure(failed(calc("1 +"))), 'Parse error at line 1, column 4: unexpected end of input, expected "-", number or "("');
  });

  test("unary minus binds looser than ^", () => {
    assert.deepEqual(calc("-2 ^ 2"), ok(-4));
    assert.deepEqual(calc("2 - -3"), ok(5));
    assert.deepEqual(calc("--4"), ok(4));
    assert.deepEqual(calc("-(1 + 2) * 3"), ok(-9));
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
    const depth = 1000;
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
