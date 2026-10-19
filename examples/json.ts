import {
  alt, between, label, lazy, left, many, map, parse, regex, right, satisfy, sepBy, seq, str,
  type Parser, type ParseResult,
} from "../src/index.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const ws = regex(/[ \t\n\r]*/, "whitespace");
const token = <T>(p: Parser<T>): Parser<T> => left(p, ws);
const sym = (s: string) => token(str(s));
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

const array: Parser<readonly Json[]> = between(sym("["), sepBy(value, sym(",")), sym("]"));

const object: Parser<{ readonly [key: string]: Json }> = map(
  between(sym("{"), sepBy(seq(left(string, sym(":")), value), sym(",")), sym("}")),
  (pairs) => Object.fromEntries(pairs),
);

export const parseJson = (input: string): ParseResult<Json> => parse(right(ws, value), input);
