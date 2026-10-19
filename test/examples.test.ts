import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { parseCsv } from "../examples/csv.ts";
import { parseIni } from "../examples/ini.ts";
import { run } from "../examples/lang.ts";

const ok = <T>(value: T) => ({ ok: true, value });
const dictionary = <T>(entries: Record<string, T>): Record<string, T> => Object.assign(Object.create(null), entries);

describe("CSV example", () => {
  test("quoted fields, doubled quotes and every line ending", () => {
    assert.deepEqual(parseCsv('a,b\r\n1,"x, ""y"""\n"multi\nline",\r'), ok([["a", "b"], ["1", 'x, "y"'], ["multi\nline", ""]]));
  });

  test("blank lines, empty input and an optional final line break", () => {
    assert.deepEqual(parseCsv(""), ok([]));
    assert.deepEqual(parseCsv("a\n\nb"), ok([["a"], [""], ["b"]]));
    assert.deepEqual(parseCsv("a,b\n"), ok([["a", "b"]]));
    assert.deepEqual(parseCsv("a,b"), ok([["a", "b"]]));
  });

  test("an unclosed quote is an error", () => {
    const r = parseCsv('a,"open');
    assert.ok(!r.ok && r.error.found === "end of input" && r.error.expected.includes('"\\""'));
  });

  test("round-trips generated tables", () => {
    const cell = fc.string({ unit: fc.constantFrom("a", "b", ",", '"', "\n", " "), maxLength: 6 });
    const encode = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
    const table = fc.integer({ min: 1, max: 4 }).chain((width) =>
      fc.array(fc.array(cell, { minLength: width, maxLength: width }), { minLength: 1, maxLength: 5 }));
    fc.assert(fc.property(table, (rows) => {
      // A single empty field on the last line is indistinguishable from a final line break.
      fc.pre(!(rows.at(-1)!.length === 1 && rows.at(-1)![0] === ""));
      const text = rows.map((r) => r.map(encode).join(",")).join("\r\n");
      assert.deepEqual(parseCsv(text), ok(rows));
    }));
  });
});

describe("INI example", () => {
  test("sections, comments and values", () => {
    const src = "; top\nname = demo\n\n[server]\nhost = example.com ; inline\nport=8080\n# done";
    assert.deepEqual(parseIni(src), ok({
      ini: dictionary({ "": dictionary({ name: "demo" }), server: dictionary({ host: "example.com", port: "8080" }) }),
      errors: [],
    }));
  });

  test("reports every bad line and keeps the good ones", () => {
    const r = parseIni("[a]\nx = 1\n[bad\nnope\ny = 2\n");
    assert.deepEqual(r, ok({
      ini: dictionary({ a: dictionary({ x: "1", y: "2" }) }),
      errors: [
        'Parse error at line 3, column 5: unexpected "\\n", expected "]"',
        'Parse error at line 4, column 5: unexpected "\\n", expected "="',
      ],
    }));
  });

  test("empty input returns an empty dictionary", () => {
    assert.deepEqual(parseIni(""), ok({ ini: dictionary({}), errors: [] }));
  });

  test("prototype property names are ordinary keys", () => {
    const entries = { ["__proto__"]: "proto", constructor: "ctor", toString: "string", hasOwnProperty: "own" };
    const source = Object.entries(entries).map(([key, value]) => `${key}=${value}`).join("\n");
    assert.deepEqual(parseIni(source), ok({ ini: dictionary({ "": dictionary(entries) }), errors: [] }));
  });

  test("prototype property names are ordinary sections without mutating global objects", (t) => {
    const names = ["__proto__", "constructor", "toString", "hasOwnProperty"];
    const marker = "parsecTsIniMarker";
    const inherited = names.map((name) => Reflect.get({}, name) as object);
    const before = inherited.map((value) => Object.getOwnPropertyDescriptor(value, marker));
    // Keep the test process safe if a regression writes through an inherited section.
    t.after(() => inherited.forEach((value, i) => {
      const descriptor = before[i];
      if (descriptor) Object.defineProperty(value, marker, descriptor);
      else Reflect.deleteProperty(value, marker);
    }));

    const source = names.map((name) => `[${name}]\n${marker}=${name}`).join("\n");
    const r = parseIni(source);
    assert.deepEqual(inherited.map((value) => Object.getOwnPropertyDescriptor(value, marker)), before);
    assert.deepEqual(r, ok({
      ini: dictionary(Object.fromEntries(names.map((name) => [name, dictionary({ [marker]: name })]))),
      errors: [],
    }));
  });
});

describe("language example", () => {
  test("runs a program", () => {
    const src = "let x = 1 + 2;\nlet y = x * -3;\nprint y ^ 2;\nprint -2 ^ 2;\nprint (x + 1) / 2;";
    assert.deepEqual(run(src), { output: [81, -4, 2], errors: [] });
  });

  test("reports syntax and runtime errors from one run, and keeps going", () => {
    const src = "let x = 1;\nlet = 5;\nprint z + 1;\nlet w = (1 + ;\nprint x;";
    assert.deepEqual(run(src), {
      output: [1],
      errors: [
        'Parse error at line 2, column 5: unexpected "=", expected identifier (in let statement)',
        "Runtime error at line 3, column 7: undefined variable z",
        'Parse error at line 4, column 14: unexpected ";", expected "-", number, identifier or "(" (in let statement)',
      ],
    });
  });

  test("keywords aren't identifiers, but words starting with them are", () => {
    assert.deepEqual(run("let letter = 1; print letter;"), { output: [1], errors: [] });
    assert.deepEqual(run("let print = 1;").errors, [
      'Parse error at line 1, column 5: unexpected "p", expected identifier (in let statement)',
    ]);
  });
});
