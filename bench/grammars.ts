// The same JSON grammar in each library, written the same way so the
// benchmark measures combinator overhead: regexes for string and number
// literals (escapes decoded by JSON.parse), sepBy for lists, a recursive value.
import P from "parsimmon";
import * as A from "arcsecond";
import {
  alt, between, lazy, lexeme, map, parse, regex, right, sepBy, seq, str, left, type Parser,
} from "../src/index.ts";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;

// parsec-ts

const ws = regex(/[ \t\n\r]*/);
const tok = <T>(p: Parser<T>) => lexeme(p, ws);
const sym = (s: string) => tok(str(s));
const value: Parser<Json> = lazy(() =>
  alt(
    map(between(sym("{"), sepBy(seq(left(jsonString, sym(":")), value), sym(",")), sym("}")), (ps) => Object.fromEntries(ps)),
    between(sym("["), sepBy(value, sym(",")), sym("]")),
    jsonString,
    tok(map(regex(NUMBER), Number)),
    tok(map(str("true"), () => true)),
    tok(map(str("false"), () => false)),
    tok(map(str("null"), () => null)),
  ),
);
const jsonString: Parser<string> = tok(map(regex(STRING), (s) => JSON.parse(s) as string));
const parsecJson = right(ws, value);

export const parsecTs = (input: string): Json => {
  const r = parse(parsecJson, input);
  if (!r.ok) throw new Error("parsec-ts failed");
  return r.value;
};

// Parsimmon

const pws = P.regexp(/[ \t\n\r]*/);
const ptok = <T>(p: P.Parser<T>) => p.skip(pws);
const pword = (s: string) => ptok(P.string(s));
const PJson: P.Language = P.createLanguage({
  value: (r) => P.alt(r.object!, r.array!, r.string!, r.number!, r.true!, r.false!, r.null!),
  object: (r) =>
    pword("{").then(P.seq(r.string!.skip(pword(":")), r.value!).sepBy(pword(","))).skip(pword("}"))
      .map((ps) => Object.fromEntries(ps as [string, Json][])),
  array: (r) => pword("[").then(r.value!.sepBy(pword(","))).skip(pword("]")),
  string: () => ptok(P.regexp(STRING).map((s) => JSON.parse(s) as string)),
  number: () => ptok(P.regexp(NUMBER).map(Number)),
  true: () => pword("true").result(true),
  false: () => pword("false").result(false),
  null: () => pword("null").result(null),
});
const parsimmonJson = pws.then(PJson.value!);

export const parsimmon = (input: string): Json => {
  const r = parsimmonJson.parse(input);
  if (!r.status) throw new Error("parsimmon failed");
  return r.value as Json;
};

// Arcsecond (its regexes must be anchored with ^)

// A.regex fails at end of input even when it could match nothing, so use
// the built-in (\s*); the benchmark input only contains JSON whitespace.
const aws = A.optionalWhitespace;
const atok = <T>(p: A.Parser<T>) => A.sequenceOf([p, aws]).map(([x]) => x as T);
const aword = (s: string) => atok(A.str(s));
const anchored = (re: RegExp) => new RegExp(`^(?:${re.source})`);
const avalue: A.Parser<Json> = A.recursiveParser(() =>
  A.choice([aobject, aarray, astring, anumber, aword("true").map(() => true), aword("false").map(() => false), aword("null").map(() => null)]) as A.Parser<Json>,
);
const astring = atok(A.regex(anchored(STRING)).map((s) => JSON.parse(s) as string));
const anumber = atok(A.regex(anchored(NUMBER)).map(Number));
const aarray = A.between(aword("["))(aword("]"))(A.sepBy(aword(","))(avalue));
const aobject = A.between(aword("{"))(aword("}"))(
  A.sepBy(aword(","))(A.sequenceOf([astring, aword(":"), avalue]).map(([k, , v]) => [k, v] as [string, Json])),
).map((ps) => Object.fromEntries(ps as [string, Json][]));
const arcsecondJson = A.sequenceOf([aws, avalue]).map(([, v]) => v);

export const arcsecond = (input: string): Json => {
  const r = arcsecondJson.run(input);
  if (r.isError) throw new Error(`arcsecond failed: ${r.error}`);
  return r.result as Json;
};
