# parsec-ts

A tiny, purely functional parser combinator library for TypeScript. Zero dependencies, fully typed, and failures are values, not exceptions.

```sh
npm install parsec-ts
```

## Quick start

```ts
import { alt, between, chainl1, lazy, lexeme, map, parse, regex, symbol, formatFailure, type Parser } from "parsec-ts";

const num = lexeme(map(regex(/\d+/, "number"), Number));
const op = (c: string, f: (a: number, b: number) => number) => map(symbol(c), () => f);

const expr: Parser<number> = lazy(() => chainl1(term, alt(op("+", (a, b) => a + b), op("-", (a, b) => a - b))));
const factor = alt(num, between(symbol("("), expr, symbol(")")));
const term = chainl1(factor, alt(op("*", (a, b) => a * b), op("/", (a, b) => a / b)));

const result = parse(expr, "2 * (3 + 4)");
if (result.ok) console.log(result.value); // 14
else console.error(formatFailure(result.error));

parse(expr, "1 x");
// Parse error at line 1, column 3: unexpected "x", expected "*", "/", "+", "-" or end of input
```

See [`examples/`](https://github.com/naamanu/parsec-ts/tree/main/examples) for a calculator, a complete JSON parser, and a two-stage lexer + token parser.

## Concepts

A `Parser<T, I = string>` is a plain function `(input: I, pos: number) => Result<T>`. You can write your own parsers directly, and they compose with the built-in ones. `ParserValue<typeof p>` gives a parser's value type.

`parse(p, input)` runs `p` against the whole input and returns `{ ok: true, value }` or `{ ok: false, error }`. The `error` has `expected`, `found` (the character at the failure, or `"end of input"`), `pos`, `line` and `column`. `formatFailure` turns it into a readable message.

### Error messages

Errors report the **furthest position** any alternative reached, and **everything that would have been accepted there**. That includes alternatives tried by `alt`, and the last attempt of `many` or `optional`. Use `label` to give a group of parsers a friendlier name.

### Backtracking

By default `alt` backtracks: if an alternative fails after consuming input, the next one is tried from the original position.

Use `cut(p)` to commit. Once a grammar has seen enough to know which construct it's in, wrap the rest in `cut`. Any failure inside is then **fatal**: `alt`, `many`, `optional`, `sepBy` and the other combinators pass it straight up rather than trying something else. That keeps a later alternative from silently misreading broken input, and it skips backtracking that can't succeed:

```ts
const letStmt = right(symbol("let"), cut(ident));
parse(alt(letStmt, exprStmt), "let 1");
// without cut: exprStmt may happily accept "let 1"
// with cut:    unexpected "1", expected identifier
```

`attempt(p)` undoes `cut` inside `p`, turning its fatal failures back into ordinary ones.

### Non-string input

Parsers can read any array-like input as well as strings: an array of tokens from a separate lexer, or a `Uint8Array` of bytes. The combinators are generic over the input type. `succeed`, `fail`, `eof` and `position` work with every input. `satisfyToken`, `anyToken` and `matchToken` match single elements:

```ts
type Tok = { kind: "num" | "plus"; text: string };
const num = map(satisfyToken((t: Tok) => t.kind === "num", "number"), (t) => Number(t.text));
const plus = satisfyToken((t: Tok) => t.kind === "plus", '"+"');
parse(sepBy1(num, plus), tokens); // Parser<readonly number[], ArrayLike<Tok>>
```

For tokens, `found` defaults to the JSON of the token, and `column` to its index + 1. Bytes are shown as hex. Pass `describe` and `locate` to `parse` to customise both. For example, map a token back to its line and column in the original source, as [`examples/tokens.ts`](https://github.com/naamanu/parsec-ts/tree/main/examples/tokens.ts) does.

## API

| Primitive | |
|---|---|
| `str(s)` | match a literal string |
| `regex(re, name?)` | match a regex at the current position |
| `satisfy(pred, name)` | match one Unicode code point satisfying `pred` |
| `anyChar` | match any one code point |
| `oneOf(chars)` / `noneOf(chars)` | match one character in / not in `chars` |
| `eof` | match end of input |
| `position` | the current offset, consuming nothing |
| `succeed(v)` | consume nothing, return `v` |
| `fail(expected)` | consume nothing, fail |

| Token primitive (arrays, `Uint8Array`) | |
|---|---|
| `satisfyToken(pred, name)` | match one element satisfying `pred` |
| `anyToken<Tok>()` | match any one element |
| `matchToken(value, name?)` | match one element `=== value` |

| Running | |
|---|---|
| `parse(p, input, { describe?, locate? })` | run `p` on the whole input; failures are values |
| `formatFailure(error)` | render a failure as a one-line message |

| Combinator | |
|---|---|
| `map(p, f)` | transform the value |
| `chain(p, f)` | monadic bind: choose the next parser from a value |
| `seq(...ps)` | run in order, returning a typed tuple |
| `left(a, b)` / `right(a, b)` | run both, keep one value |
| `between(open, p, close)` | keep the middle value |
| `alt(...ps)` | ordered choice with backtracking |
| `cut(p)` / `attempt(p)` | make failures in `p` fatal / recoverable again |
| `struct({ key: p, ... })` | run in key order, returning a typed object |
| `optional(p, fallback?)` | `p`, or `fallback` (default `null`) |
| `many(p)` / `many1(p)` | zero / one or more |
| `count(n, p)` | exactly `n` |
| `manyTill(p, end)` | repeat `p` until `end` |
| `sepBy(p, sep)` / `sepBy1` / `sepEndBy` | separated lists |
| `chainl1(term, op)` / `chainr1` | left / right-associative operators |
| `lookahead(p)` / `not(p, expected?)` | zero-width checks |
| `label(p, name)` | rename what `p` reports as expected |
| `withSpan(p)` | `{ value, start, end }`: the value plus the input range it came from |
| `lazy(() => p)` | recursive grammars |

| Lexing | |
|---|---|
| `whitespace` | zero or more whitespace characters |
| `lexeme(p, ws?)` | `p`, then skip trailing whitespace (or `ws`) |
| `symbol(s, ws?)` | the literal `s`, then skip trailing whitespace (or `ws`) |

Lexemes skip whitespace *after* themselves, so start a grammar with `right(whitespace, p)` to allow leading whitespace.

## Purity

Every exported function is referentially transparent: no exceptions, no shared mutable state, readonly results. A few combinators use loops or private mutable state inside, because JavaScript lacks tail-call elimination. That state never escapes a single call.

Grammars are recursive descent, so very deeply nested input can exhaust the JavaScript call stack. With Node's default stack, the bundled JSON example handles about 1,500 levels of nested arrays, and the calculator about 900 levels of parentheses.

## Development

Tests run TypeScript directly, which needs Node ≥ 22.18.

```sh
npm test            # run tests
npm run typecheck   # tsc --noEmit
npm run build       # emit dist/
npm run check:pack  # build, then verify the npm tarball contents
npm run docs        # API reference in docs/api (fails on undocumented exports)
```

### Releasing

Publishing a GitHub release triggers `.github/workflows/release.yml`. The workflow publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored. npm adds provenance automatically, but only once the GitHub repo is public.

1. Update `CHANGELOG.md`.
2. `npm version <patch|minor|major>`, then `git push --follow-tags`.
3. Create a GitHub release from the new `vX.Y.Z` tag. The workflow checks that the tag matches `package.json`.

One-time setup: trusted publishers are configured in a package's settings on npmjs.com, so publish the first version by hand with `npm publish`. Then add a GitHub Actions trusted publisher for `naamanu/parsec-ts` with workflow `release.yml`. A new trusted-publisher configuration expires if it isn't used to publish within 2 days, so add it shortly before your next release.

## License

MIT
