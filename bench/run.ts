// Benchmarks: `npm run bench`. Prints Markdown tables of median times.
// Each parser's output is checked against JSON.parse before it's timed.
import { deepStrictEqual } from "node:assert";
import { arch, cpus } from "node:os";
import { arcsecond, parsecTs, parsimmon } from "./grammars.ts";
import { parseJson } from "../examples/json.ts";
import { calc } from "../examples/calc.ts";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** Median wall time of `fn` in ms, after warming up the JIT. */
const time = (fn: () => unknown, runs: number): number => {
  for (let i = 0; i < Math.max(3, runs / 3); i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  return median(samples);
};

const document = (objects: number) =>
  JSON.stringify(
    Array.from({ length: objects }, (_, i) => ({
      id: i, name: `item ${i} "quoted" \\ é`, price: i * 1.25 - 100, tags: ["a", "b", "c"], ok: i % 2 === 0,
      none: null, nested: { depth: [[i], { x: -i }] },
    })),
    null,
    1,
  );

type Entry = readonly [name: string, parse: (s: string) => unknown];

const exampleJson: Entry = ["parsec-ts examples/json.ts (char-level strings, cut, context)", (s) => {
  const r = parseJson(s);
  if (!r.ok) throw new Error("examples/json.ts failed");
  return r.value;
}];

const table = (title: string, doc: string, parsers: readonly Entry[], runs: number) => {
  const expected = JSON.parse(doc);
  for (const [name, f] of parsers) deepStrictEqual(f(doc), expected, `${name} output differs from JSON.parse`);
  const rows = parsers.map(([name, f]) => [name, time(() => f(doc), runs)] as const);
  const ours = rows.find(([name]) => name === "parsec-ts")![1];
  console.log(`\n### ${title}: ${(doc.length / 1024).toFixed(0)} kB\n`);
  console.log("| Parser | Median | Relative to parsec-ts |");
  console.log("|---|---:|---:|");
  for (const [name, ms] of rows) console.log(`| ${name} | ${ms.toFixed(2)} ms | ${(ms / ours).toFixed(2)}× |`);
};

console.log(`Node ${process.versions.node}, ${arch()}, ${cpus()[0]?.model ?? "unknown CPU"}`);

table("JSON, 200 objects", document(200), [
  ["JSON.parse (native baseline)", JSON.parse],
  ["parsec-ts", parsecTs],
  exampleJson,
  ["Parsimmon 1.18.1", parsimmon],
  ["Arcsecond 5.0.0", arcsecond],
], 15);

// Arcsecond's parse time grows quadratically with input size (it takes
// minutes on this document), so it's left out here.
table("JSON, 5,000 objects", document(5000), [
  ["JSON.parse (native baseline)", JSON.parse],
  ["parsec-ts", parsecTs],
  exampleJson,
  ["Parsimmon 1.18.1", parsimmon],
], 30);

const expr = Array.from({ length: 20_000 }, (_, i) => i % 100).join(" + ");
if (!calc(expr).ok) throw new Error("calc failed");
console.log(`\nCalculator (examples/calc.ts), 20,000-term expression: ${time(() => calc(expr), 30).toFixed(1)} ms`);
