// A tiny language that uses most of the library together:
//
//   let x = 1 + 2;
//   let y = x * -3;
//   print y ^ 2;
//
// - `operators` for expressions, with spans on every AST node
// - `cut` after keywords and `context` for statements, for precise errors
// - `recover` per statement, so one run reports every syntax error
// - a pure evaluator that reports undefined variables at their source position
import {
  alt, between, context, cut, formatFailure, lazy, left, lexeme, locateFailure, many, map, not, operators, optional,
  parse, recover, regex, right, seq, skipUntil, str, symbol, whitespace, withSpan,
  type Parser, type Span,
} from "../src/index.ts";

type Range = { readonly start: number; readonly end: number };

export type Expr =
  | { readonly kind: "num"; readonly value: number; readonly at: Range }
  | { readonly kind: "var"; readonly name: string; readonly at: Range }
  | { readonly kind: "neg"; readonly operand: Expr; readonly at: Range }
  | { readonly kind: "bin"; readonly op: string; readonly left: Expr; readonly right: Expr; readonly at: Range };

export type Stmt =
  | { readonly kind: "let"; readonly name: string; readonly value: Expr }
  | { readonly kind: "print"; readonly value: Expr };

// Lexical structure

const keyword = (word: string) => lexeme(regex(new RegExp(`${word}\\b`), JSON.stringify(word)));
const reserved = regex(/(?:let|print)\b/);
const identifier = lexeme(right(not(reserved, "identifier"), regex(/[a-z_][a-z0-9_]*/i, "identifier")));
const number = lexeme(regex(/\d+(?:\.\d+)?/, "number"));

const spanned = <T>(p: Parser<T>): Parser<Span<T>> => withSpan(p);
const range = (s: Span<unknown>): Range => ({ start: s.start, end: s.end });

// Expressions

const binary = (op: string) =>
  map(symbol(op), () => (left: Expr, right: Expr): Expr => ({
    kind: "bin", op, left, right, at: { start: left.at.start, end: right.at.end },
  }));
const negate = map(withSpan(symbol("-")), ({ start }) => (operand: Expr): Expr => ({
  kind: "neg", operand, at: { start, end: operand.at.end },
}));

const atom: Parser<Expr> = alt(
  map(spanned(number), (s): Expr => ({ kind: "num", value: Number(s.value), at: range(s) })),
  map(spanned(identifier), (s): Expr => ({ kind: "var", name: s.value, at: range(s) })),
  between(symbol("("), lazy(() => expr), symbol(")")),
);

const expr: Parser<Expr> = operators(atom, [
  { infix: "right", ops: [binary("^")] },
  { prefix: [negate] },
  { infix: "left", ops: [binary("*"), binary("/")] },
  { infix: "left", ops: [binary("+"), binary("-")] },
]);

// Statements: once a keyword matches, `cut` commits to that statement.

const letStmt = context(
  "let statement",
  map(right(keyword("let"), cut(seq(identifier, symbol("="), expr, symbol(";")))), ([name, , value]): Stmt => ({
    kind: "let", name, value,
  })),
);
const printStmt = context(
  "print statement",
  map(right(keyword("print"), cut(left(expr, symbol(";")))), (value): Stmt => ({ kind: "print", value })),
);

// On a bad statement, skip past the next ";" and carry on.
const sync = left(skipUntil(str(";")), optional(symbol(";")));
const program = right(whitespace, many(recover(alt(letStmt, printStmt), sync)));

// Evaluation

type Outcome = { readonly value: number } | { readonly error: { readonly message: string; readonly at: Range } };

const evaluate = (e: Expr, env: ReadonlyMap<string, number>): Outcome => {
  switch (e.kind) {
    case "num":
      return { value: e.value };
    case "var": {
      const value = env.get(e.name);
      return value === undefined ? { error: { message: `undefined variable ${e.name}`, at: e.at } } : { value };
    }
    case "neg": {
      const v = evaluate(e.operand, env);
      return "error" in v ? v : { value: -v.value };
    }
    case "bin": {
      const l = evaluate(e.left, env);
      if ("error" in l) return l;
      const r = evaluate(e.right, env);
      if ("error" in r) return r;
      const ops: Record<string, (a: number, b: number) => number> = {
        "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "/": (a, b) => a / b, "^": (a, b) => a ** b,
      };
      return { value: ops[e.op]!(l.value, r.value) };
    }
  }
};

export type RunResult = { readonly output: readonly number[]; readonly errors: readonly string[] };

/** Parse and run `source`, collecting printed values and every error, syntax or runtime. */
export const run = (source: string): RunResult => {
  const parsed = parse(program, source);
  if (!parsed.ok) return { output: [], errors: [formatFailure(parsed.error)] };

  const at = (pos: number) => locateFailure(source, { pos, expected: [] });
  type State = { env: ReadonlyMap<string, number>; output: readonly number[]; errors: readonly string[] };

  const final = parsed.value.reduce<State>((state, node) => {
    if (!node.ok) return { ...state, errors: [...state.errors, formatFailure(locateFailure(source, node.failure))] };
    const stmt = node.value;
    const result = evaluate(stmt.value, state.env);
    if ("error" in result) {
      const { line, column } = at(result.error.at.start);
      return { ...state, errors: [...state.errors, `Runtime error at line ${line}, column ${column}: ${result.error.message}`] };
    }
    return stmt.kind === "let"
      ? { ...state, env: new Map([...state.env, [stmt.name, result.value]]) }
      : { ...state, output: [...state.output, result.value] };
  }, { env: new Map(), output: [], errors: [] });

  return { output: final.output, errors: final.errors };
};
