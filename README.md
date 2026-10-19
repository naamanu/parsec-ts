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

### Pipeable style

Every combinator has a data-last version in `parsec-ts/fp`, so parsers can be built with `pipe`, as in fp-ts or Effect:

```ts
import { pipe, regex, symbol } from "parsec-ts";
import * as P from "parsec-ts/fp";

const int = pipe(regex(/-?\d+/), P.map(Number), P.label("integer"), P.lexeme());
const list = pipe(int, P.sepBy(symbol(",")), P.between(symbol("["), symbol("]")));
```

`P.map(f)(p)` is `map(p, f)`, and so on: each takes every argument except the parser being transformed. Combinators that only take a parser (`many`, `cut`, ...) are the same functions in both styles.

### Error messages

Errors report the **furthest position** any alternative reached, and **everything that would have been accepted there**. That includes alternatives tried by `alt`, and the last attempt of `many` or `optional`. Use `label` to give a group of parsers a friendlier name.

Use `context(name, p)` to record *where* in the grammar a failure happened. Contexts appear innermost first:

```
Parse error at line 1, column 16: unexpected "2", expected ":" (in object key, in object, in array, in object)
```

`label` and `context` complement each other. `label` renames what's expected when `p` fails at its start. `context` annotates failures *inside* `p`, once it has consumed input.

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

### Error recovery

To report *every* error in one run, rather than stopping at the first, wrap the repeating unit in `recover(p, sync)`. If `p` fails, `recover` keeps the failure as an **error node** in the result, then runs `sync` to skip the broken input and carries on:

```ts
const sync = left(skipUntil(str(";")), optional(symbol(";")));
const program = many(recover(statement, sync));

const r = parse(program, source);
// r.value: [{ ok: true, value: stmt }, { ok: false, failure, skipped: { start, end } }, ...]
const errors = r.ok ? r.value.flatMap((n) => (n.ok ? [] : [locateFailure(source, n.failure)])) : [];
```

Errors are part of the returned value, not collected through hidden state, so this stays purely functional. `locateFailure` adds `found`, `line` and `column`, exactly as `parse` does for its own failure.

### Debugging with traces

To see what a grammar actually tries, write it as a function of a `Tracer`, wrap the parsers you care about with `trace(name, p)`, and run it with `parseWithTrace`:

```ts
const grammar = (trace: Tracer = noTrace) => {
  const num = trace("number", map(digit, Number));
  const expr: Parser<number> = lazy(() => trace("expr", chainl1(factor, add)));
  const factor = trace("factor", alt(num, between(str("("), expr, str(")"))));
  return expr;
};

const { result, events } = parseWithTrace(grammar, "1+(2");
console.log(formatTrace(events));
// ✓ expr 0..1
//   ✓ factor 0..1
//     ✓ number 0..1
//   ✗ factor 2 expected "+" | ")" at 4
//   ...
```

`grammar()` with no argument builds the same parser without tracing. Events are returned as data: an array local to the call, frozen on return.

### Operator precedence

`operators(atom, table)` builds an expression parser from a table of levels, ordered from highest precedence to lowest. Each level is left- or right-associative infix, prefix, or postfix:

```ts
const expr: Parser<number> = lazy(() => operators(atom, [
  { infix: "right", ops: [binary("^", (a, b) => a ** b)] },
  { prefix: [unary("-", (a) => -a)] },
  { infix: "left", ops: [binary("*", (a, b) => a * b), binary("/", (a, b) => a / b)] },
  { infix: "left", ops: [binary("+", (a, b) => a + b), binary("-", (a, b) => a - b)] },
]));
```

Each operator parser returns the function to apply, e.g. `const binary = (s, f) => map(symbol(s), () => f)`. See [`examples/calc.ts`](https://github.com/naamanu/parsec-ts/tree/main/examples/calc.ts).

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
| `parseWithTrace(build, input, options?)` | run `build(trace)` and return the result plus trace events |
| `formatTrace(events)` | render trace events as an indented tree |
| `locateFailure(input, failure, options?)` | add `found`, `line` and `column` to a raw failure, e.g. from `recover` |

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
| `operators(atom, table)` | expression parser from a precedence table (infix, prefix, postfix) |
| `lookahead(p)` / `not(p, expected?)` | zero-width checks |
| `label(p, name)` | rename what `p` reports as expected |
| `context(name, p)` | note that failures inside `p` happened while parsing `name` |
| `withSpan(p)` | `{ value, start, end }`: the value plus the input range it came from |
| `lazy(() => p)` | recursive grammars |
| `recover(p, sync)` | on failure, return an error node and skip ahead with `sync` |
| `skipUntil(end)` | skip input up to where `end` would match (never fails) |

| Lexing | |
|---|---|
| `whitespace` | zero or more whitespace characters |
| `lexeme(p, ws?)` | `p`, then skip trailing whitespace (or `ws`) |
| `symbol(s, ws?)` | the literal `s`, then skip trailing whitespace (or `ws`) |

Lexemes skip whitespace *after* themselves, so start a grammar with `right(whitespace, p)` to allow leading whitespace.

## Performance

`npm run bench` parses JSON with the same grammar written in each library. Each uses regexes for string and number literals, so the numbers compare combinator overhead. Every output is checked against `JSON.parse` before timing. Median times on Node 24.19, Apple M5:

| JSON parser | 45 kB | 1.15 MB |
|---|---:|---:|
| `JSON.parse` (native, for scale) | 0.08 ms | 2.2 ms |
| **parsec-ts** | **1.3 ms** | **42 ms** |
| parsec-ts `examples/json.ts` (char-level strings, `cut`, `context`) | 2.0 ms | 61 ms |
| Parsimmon 1.18.1 | 3.1 ms | 91 ms |
| Arcsecond 5.0.0 | 6,700 ms | — |

Arcsecond 5's `regex` decodes the whole remaining input on every call, so regex-heavy grammars like this one take time quadratic in the input size. A grammar avoiding `regex` would fare much better. The benchmark leaves it out of the large document, where it takes minutes.

Your numbers will differ by machine. Rerun the benchmark rather than relying on these.

## Purity

Every exported function is referentially transparent: no exceptions, no shared mutable state, readonly results. A few combinators use loops or private mutable state inside, because JavaScript lacks tail-call elimination. That state never escapes a single call.

Grammars are recursive descent, so very deeply nested input can exhaust the JavaScript call stack. With Node's default stack, the bundled JSON example handles about 1,100 levels of nested arrays, and the calculator about 800 levels of parentheses.

## Development

Tests run TypeScript directly, which needs Node ≥ 22.18.

```sh
npm test            # run tests
npm run typecheck   # tsc --noEmit
npm run build       # emit dist/
npm run check:pack  # build, then verify the npm tarball contents
npm run docs        # API reference in docs/api (fails on undocumented exports)
npm run bench       # JSON benchmark vs Parsimmon and Arcsecond
```

### Releasing

Publishing a GitHub release triggers `.github/workflows/release.yml`. The workflow publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored. npm adds provenance automatically, but only once the GitHub repo is public.

1. Update `CHANGELOG.md`.
2. `npm version <patch|minor|major>`, then `git push --follow-tags`.
3. Create a GitHub release from the new `vX.Y.Z` tag. The workflow checks that the tag matches `package.json`.

One-time setup: trusted publishers are configured in a package's settings on npmjs.com, so publish the first version by hand with `npm publish`. Then add a GitHub Actions trusted publisher for `naamanu/parsec-ts` with workflow `release.yml`. A new trusted-publisher configuration expires if it isn't used to publish within 2 days, so add it shortly before your next release.

## License

MIT
