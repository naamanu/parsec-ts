// Tracing for debugging grammars: which named parsers ran, where, and whether
// they matched. Trace events are returned as data, not logged.

import type { Failure, Input, Parser } from "./core.ts";
import { parse, type ParseOptions, type ParseResult } from "./run.ts";

/** One run of a traced parser, in the order the runs started. */
export type TraceEvent = {
  /** The name given to `trace`. */
  readonly name: string;
  /** How many traced parsers enclose this one. */
  readonly depth: number;
  /** Where the parser started. */
  readonly start: number;
  /** Where it finished: `end` on success, the failure position otherwise. */
  readonly end: number;
  /** Whether it matched. */
  readonly ok: boolean;
  /** On failure (or a success carrying one), what was expected and where. */
  readonly failure?: Failure;
};

/** Wraps a parser so its runs are recorded under `name`. */
export type Tracer = <T, I>(name: string, p: Parser<T, I>) => Parser<T, I>;

/** A `Tracer` that records nothing: use it to build a grammar normally. */
export const noTrace: Tracer = (_, p) => p;

/**
 * Parse with tracing. `build` receives a `trace` wrapper and returns the
 * grammar; wrap any parser you want to see with `trace(name, p)`:
 *
 * ```ts
 * const grammar = (trace: Tracer = noTrace) => { ...trace("term", term)... };
 * const { result, events } = parseWithTrace(grammar, "1 + x");
 * console.log(formatTrace(events));
 * ```
 *
 * The events are collected in an array local to this call and returned
 * frozen, so the function stays pure: same grammar and input, same output.
 */
export const parseWithTrace = <T, I extends Input>(
  build: (trace: Tracer) => Parser<T, I>,
  input: I,
  options?: ParseOptions<I>,
): { readonly result: ParseResult<T>; readonly events: readonly TraceEvent[] } => {
  const events: TraceEvent[] = [];
  let depth = 0;
  const trace: Tracer = (name, p) => (inp, start) => {
    const index = events.length;
    events.push({ name, depth, start, end: start, ok: false }); // placeholder, keeps start order
    depth++;
    const r = p(inp, start);
    depth--;
    events[index] = r.ok
      ? { name, depth, start, end: r.pos, ok: true, ...(r.failure && { failure: r.failure }) }
      : { name, depth, start, end: r.failure.pos, ok: false, failure: r.failure };
    return r;
  };
  const result = parse(build(trace), input, options);
  return { result, events: Object.freeze(events.map((e) => Object.freeze(e))) };
};

/**
 * Render trace events as an indented tree, one line per run:
 * `✓ term 0..1` or `✗ factor 4 expected number`.
 */
export const formatTrace = (events: readonly TraceEvent[]): string =>
  events
    .map((e) => {
      const where = e.ok ? `${e.start}..${e.end}` : `${e.start}`;
      const why = e.ok ? "" : ` expected ${e.failure!.expected.join(" | ")} at ${e.failure!.pos}`;
      return `${"  ".repeat(e.depth)}${e.ok ? "✓" : "✗"} ${e.name} ${where}${why}`;
    })
    .join("\n");
