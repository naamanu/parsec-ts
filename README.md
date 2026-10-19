# parsec-ts

A tiny, purely functional parser combinator library for TypeScript. Zero dependencies, fully typed, and failures are values, not exceptions.

```sh
npm install parsec-ts
```

## Quick start

```ts
import { alt, between, chainl1, lazy, left, map, parse, regex, str, formatFailure, type Parser } from "parsec-ts";

const ws = regex(/\s*/);
const token = <T>(p: Parser<T>) => left(p, ws);
const num = token(map(regex(/\d+/, "number"), Number));
const op = (c: string, f: (a: number, b: number) => number) => token(map(str(c), () => f));

const expr: Parser<number> = lazy(() => chainl1(term, alt(op("+", (a, b) => a + b), op("-", (a, b) => a - b))));
const factor = alt(num, between(token(str("(")), expr, token(str(")"))));
const term = chainl1(factor, alt(op("*", (a, b) => a * b), op("/", (a, b) => a / b)));

const result = parse(expr, "2 * (3 + 4)");
if (result.ok) console.log(result.value); // 14
else console.error(formatFailure(result.error));

parse(expr, "1 x");
// Parse error at line 1, column 3: unexpected "x", expected "*", "/", "+", "-" or end of input
```

See [`examples/`](examples) for a calculator and a complete JSON parser.

## Concepts

A `Parser<T>` is a plain function `(input: string, pos: number) => Result<T>`. You can write your own parsers directly, and they compose with the built-in ones.

`parse(p, input)` runs `p` against the whole input and returns `{ ok: true, value }` or `{ ok: false, error }`. The `error` has `expected`, `found` (the character at the failure, or `"end of input"`), `pos`, `line` and `column`. `formatFailure` turns it into a readable message.

### Error messages

Errors report the **furthest position** any alternative reached, and **everything that would have been accepted there**. That includes alternatives tried by `alt`, and the last attempt of `many` or `optional`. Use `label` to give a group of parsers a friendlier name.

### Backtracking

`alt` always backtracks: if an alternative fails after consuming input, the next one is tried from the original position. No `attempt`/`try` is needed.

## API

| Primitive | |
|---|---|
| `str(s)` | match a literal string |
| `regex(re, name?)` | match a regex at the current position |
| `satisfy(pred, name)` | match one Unicode code point satisfying `pred` |
| `anyChar` | match any one code point |
| `eof` | match end of input |
| `position` | the current offset, consuming nothing |
| `succeed(v)` | consume nothing, return `v` |
| `fail(expected)` | consume nothing, fail |

| Combinator | |
|---|---|
| `map(p, f)` | transform the value |
| `chain(p, f)` | monadic bind: choose the next parser from a value |
| `seq(...ps)` | run in order, returning a typed tuple |
| `left(a, b)` / `right(a, b)` | run both, keep one value |
| `between(open, p, close)` | keep the middle value |
| `alt(...ps)` | ordered choice with backtracking |
| `optional(p)` | `p` or `null` |
| `many(p)` / `many1(p)` | zero / one or more |
| `manyTill(p, end)` | repeat `p` until `end` |
| `sepBy(p, sep)` / `sepBy1` / `sepEndBy` | separated lists |
| `chainl1(term, op)` / `chainr1` | left / right-associative operators |
| `lookahead(p)` / `not(p, expected?)` | zero-width checks |
| `label(p, name)` | rename what `p` reports as expected |
| `withSpan(p)` | `{ value, start, end }`: the value plus the input range it came from |
| `lazy(() => p)` | recursive grammars |

## Purity

Every exported function is referentially transparent: no exceptions, no shared mutable state, readonly results. A few combinators use loops or private mutable state inside, because JavaScript lacks tail-call elimination. That state never escapes a single call.

Grammars are recursive descent, so very deeply nested input can exhaust the JavaScript call stack. With Node's default stack, the bundled JSON example handles about 1,500 levels of nested arrays, and the calculator about 900 levels of parentheses.

## Development

Tests run TypeScript directly, which needs Node ≥ 22.18.

```sh
npm test           # run tests
npm run typecheck  # tsc --noEmit
npm run build      # emit dist/
```

## License

MIT
