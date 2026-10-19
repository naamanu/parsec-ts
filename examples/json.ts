import {
  alt, between, context, cut, label, lazy, left, lexeme, many, map, parse, regex, right, satisfy, sepBy, seq, str, symbol,
  type Parser, type ParseResult,
} from "../src/index.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

// JSON allows only these four whitespace characters, unlike the default `\s`.
const ws = regex(/[ \t\n\r]*/, "whitespace");
const token = <T>(p: Parser<T>): Parser<T> => lexeme(p, ws);
const sym = (s: string) => symbol(s, ws);
const keyword = <T>(s: string, value: T) => token(map(str(s), () => value));

const escapes: Readonly<Record<string, string>> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};

const escape = right(
  str("\\"),
  alt(
    map(satisfy((c) => Object.hasOwn(escapes, c), "escape character"), (c) => escapes[c]!),
    map(right(str("u"), regex(/[0-9a-fA-F]{4}/, "4 hex digits")), (h) => String.fromCharCode(parseInt(h, 16))),
  ),
);

const stringChars = alt(regex(/[^"\\\u0000-\u001f]+/, "string character"), escape);

const string: Parser<string> = token(
  label(map(between(str('"'), many(stringChars), str('"')), (cs) => cs.join("")), "string"),
);

const number: Parser<number> = token(
  label(map(regex(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/), Number), "number"),
);

const value: Parser<Json> = lazy(() =>
  alt(object, array, string, number, keyword("true", true), keyword("false", false), keyword("null", null)),
);

// After "[" or "{" nothing else can match, so `cut` commits: a failure inside
// is reported as-is, with no backtracking into other alternatives. `context`
// adds where the failure happened: `... (in object key, in object, in array)`.
const array: Parser<readonly Json[]> = context(
  "array",
  between(sym("["), cut(sepBy(value, sym(","))), cut(sym("]"))),
);

const key = context("object key", left(string, sym(":")));

const object: Parser<{ readonly [key: string]: Json }> = context(
  "object",
  map(between(sym("{"), cut(sepBy(seq(key, value), sym(","))), cut(sym("}"))), (pairs) => Object.fromEntries(pairs)),
);

export const parseJson = (input: string): ParseResult<Json> => parse(right(ws, value), input);
