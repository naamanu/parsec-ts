# Changelog

## 0.1.0 — unreleased

First release.

- Parsers are pure functions `(input, pos) => Result<T>`; `parse` returns failures as values and never throws.
- Primitives: `str`, `regex`, `satisfy`, `anyChar`, `oneOf`, `noneOf`, `eof`, `position`, `succeed`, `fail`.
- Combinators: `map`, `chain`, `seq`, `struct`, `left`, `right`, `between`, `alt`, `optional`, `many`, `many1`, `manyTill`, `count`, `sepBy`, `sepBy1`, `sepEndBy`, `chainl1`, `chainr1`, `lookahead`, `not`, `label`, `withSpan`, `lazy`.
- Committed choice with `cut`, undone by `attempt`.
- Lexing helpers: `whitespace`, `lexeme`, `symbol`.
- Errors report the furthest failure, everything expected there, and what was found, with code-point columns.
