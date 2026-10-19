// Compile-time checks of type inference: `npm run typecheck` fails if any of
// these break. The runtime test just keeps node --test from reporting an
// empty file.
import { test } from "node:test";
import {
  alt, between, eof, lazy, many, map, matchToken, optional, parse, position, right, satisfyToken, seq, str, struct,
  succeed,
  type Parser, type ParserValue,
} from "../src/index.ts";

type Equal<A, B> = (<X>() => X extends A ? 1 : 2) extends (<X>() => X extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(_: T) => {};

// String parsers keep the default input type.
const s = seq(str("a"), succeed(1), position);
assertType<Equal<typeof s, Parser<[string, number, number], string>>>(true);

const a = alt(str("a"), succeed(null));
assertType<Equal<typeof a, Parser<string | null, string>>>(true);

const st = struct({ x: str("x"), n: map(str("1"), Number) });
assertType<Equal<ParserValue<typeof st>, { readonly x: string; readonly n: number }>>(true);

// Input-independent parsers fit any input.
const anyInput: Parser<number, readonly number[]> = map(succeed(1), (x) => x + 1);
const anyString: Parser<number> = map(succeed(1), (x) => x + 1);
const atEnd: Parser<null, Uint8Array> = eof;

// Token parsers infer the token type.
type Tok = { kind: "num" | "plus"; text: string };
const num = satisfyToken((t: Tok) => t.kind === "num", "number");
const plus = matchToken<Tok>({ kind: "plus", text: "+" });
const sum = seq(num, many(right(plus, num)));
assertType<Equal<ParserValue<typeof sum>, [Tok, readonly Tok[]]>>(true);
parse(sum, [] as Tok[]);

// Bytes are tokens too.
const byte = satisfyToken((b: number) => b < 0x80, "ASCII byte");
parse(many(byte), new Uint8Array([1, 2]));

// Recursive parsers can be annotated with their input type.
const nested: Parser<number, readonly Tok[]> = lazy(() => alt(map(num, () => 1), between(num, nested, num)));
const opt = optional(nested, 0);
assertType<Equal<typeof opt, Parser<number, readonly Tok[]>>>(true);

// Mixing string and token parsers is rejected where the parser is used.
// (Type-checked only; never called, since these would fail at runtime.)
export function typeErrors() {
  // @ts-expect-error a string can't be read by a token parser
  parse(seq(str("a"), num), "a");
  // @ts-expect-error nor can tokens be read by a string parser
  parse(str("a"), [] as Tok[]);
}

test("type-level checks compile", () => {
  void [anyInput, anyString, atEnd];
});
