import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  alt, chain, count, fail, many, map, optional, parse, regex, sepBy, seq, str, succeed,
  type Parser,
} from "../src/index.ts";
import { calc } from "../examples/calc.ts";
import { parseJson } from "../examples/json.ts";

// Small inputs over a tiny alphabet, so parsers from the pool below both
// succeed and fail often.
const input = fc.string({ unit: fc.constantFrom("a", "b", "c"), maxLength: 8 });

const pool: readonly Parser<unknown>[] = [
  str("a"), str("ab"), str("b"), regex(/a+/), regex(/c*/), many(str("a")),
  optional(str("b")), seq(str("a"), str("b")), count(2, str("a")), succeed(0), fail("nothing"),
];
const parser = fc.constantFrom(...pool);
/** A deterministic `value => parser` function for the monad laws. */
const kleisli = fc.integer({ min: 0, max: pool.length - 1 }).map(
  (k) => (v: unknown) => pool[(JSON.stringify(v ?? null).length + k) % pool.length]!,
);

/** Two parsers are equal if they give identical results at every position of every input. */
const same = (p: Parser<unknown>, q: Parser<unknown>, s: string) => {
  for (let pos = 0; pos <= s.length; pos++) assert.deepEqual(p(s, pos), q(s, pos));
};

describe("functor laws", () => {
  test("map(p, x => x) = p", () => {
    fc.assert(fc.property(parser, input, (p, s) => same(map(p, (x) => x), p, s)));
  });

  test("map(map(p, f), g) = map(p, x => g(f(x)))", () => {
    const f = (x: unknown) => [x];
    const g = (x: unknown[]) => x.length;
    fc.assert(fc.property(parser, input, (p, s) => same(map(map(p, f), g), map(p, (x) => g(f(x))), s)));
  });
});

describe("monad laws", () => {
  test("left identity: chain(succeed(a), f) = f(a)", () => {
    fc.assert(fc.property(fc.jsonValue(), kleisli, input, (a, f, s) => same(chain(succeed(a), f), f(a), s)));
  });

  test("right identity: chain(p, succeed) = p", () => {
    fc.assert(fc.property(parser, input, (p, s) => same(chain(p, succeed), p, s)));
  });

  test("associativity: chain(chain(p, f), g) = chain(p, x => chain(f(x), g))", () => {
    fc.assert(fc.property(parser, kleisli, kleisli, input, (p, f, g, s) =>
      same(chain(chain(p, f), g), chain(p, (x) => chain(f(x), g)), s)));
  });
});

describe("alternative laws", () => {
  test("associativity: alt(alt(a, b), c) = alt(a, alt(b, c))", () => {
    fc.assert(fc.property(parser, parser, parser, input, (a, b, c, s) =>
      same(alt(alt(a, b), c), alt(a, alt(b, c)), s)));
  });

  test("a single alternative is the parser itself", () => {
    fc.assert(fc.property(parser, input, (p, s) => same(alt(p), p, s)));
  });
});

describe("invariants", () => {
  test("results never move backwards or past the end of input", () => {
    fc.assert(fc.property(parser, input, (p, s) => {
      for (let pos = 0; pos <= s.length; pos++) {
        const r = p(s, pos);
        if (r.ok) assert.ok(r.pos >= pos && r.pos <= s.length);
        const f = r.failure;
        if (f) assert.ok(f.pos >= pos && f.pos <= s.length);
      }
    }));
  });

  test("sepBy round-trips joined items", () => {
    const item = fc.stringMatching(/^[0-9]{1,4}$/);
    fc.assert(fc.property(fc.array(item, { maxLength: 10 }), (xs) => {
      assert.deepEqual(parse(sepBy(regex(/[0-9]+/), str(",")), xs.join(",")), { ok: true, value: xs });
    }));
  });
});

describe("examples", () => {
  test("JSON parser agrees with JSON.parse on generated documents", () => {
    // "binary" strings cover every code point (control characters, lone
    // surrogates, astral), not just printable ASCII, so all escapes are hit.
    const value = fc.jsonValue({ stringUnit: "binary" });
    fc.assert(fc.property(value, fc.constantFrom(undefined, 0, 2, "\t"), (v, indent) => {
      const doc = JSON.stringify(v, null, indent);
      assert.deepEqual(parseJson(doc), { ok: true, value: JSON.parse(doc) });
    }));
  });

  test("parsers never throw and report in-bounds errors on arbitrary input", () => {
    fc.assert(fc.property(fc.string({ maxLength: 40 }), (s) => {
      for (const r of [calc(s), parseJson(s)]) {
        if (!r.ok) assert.ok(r.error.pos >= 0 && r.error.pos <= s.length);
      }
    }));
  });

  type Expr = number | { op: "+" | "-" | "*" | "/" | "^"; l: Expr; r: Expr };
  const expr: fc.Arbitrary<Expr> = fc.letrec<{ e: Expr }>((tie) => ({
    e: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.integer({ min: 0, max: 99 }),
      fc.record({ op: fc.constantFrom("+", "-", "*", "/", "^"), l: tie("e"), r: tie("e") }),
    ),
  })).e;
  const show = (e: Expr): string => (typeof e === "number" ? String(e) : `(${show(e.l)} ${e.op} ${show(e.r)})`);
  const evaluate = (e: Expr): number => {
    if (typeof e === "number") return e;
    const [l, r] = [evaluate(e.l), evaluate(e.r)];
    return { "+": l + r, "-": l - r, "*": l * r, "/": l / r, "^": l ** r }[e.op];
  };

  test("calculator agrees with direct evaluation of generated expressions", () => {
    fc.assert(fc.property(expr, (e) => {
      assert.deepEqual(calc(show(e)), { ok: true, value: evaluate(e) });
    }));
  });
});
