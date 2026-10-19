// INI files: `[section]` headers, `key = value` pairs, `;` or `#` comments
// and blank lines. A malformed line doesn't stop parsing: it's skipped and
// reported, so one run finds every error.
import {
  alt, cut, eof, formatFailure, left, locateFailure, many, map, optional, parse, recover, regex, right, seq, skipUntil, str,
  type ParseResult,
} from "../src/index.ts";

export type Ini = { readonly [section: string]: { readonly [key: string]: string } };

const spaces = regex(/[ \t]*/);
const eol = alt(regex(/\r\n|\n|\r/), map(eof, () => ""));
const comment = regex(/[;#][^\r\n]*/);
const rest = left(spaces, optional(comment));

const name = regex(/[A-Za-z0-9_.\-]+/, "name");
const header = map(right(str("["), cut(left(name, seq(str("]"), rest)))), (section) => ({ section }));
const pair = map(
  seq(name, spaces, str("="), spaces, regex(/[^\r\n;#]*/)),
  ([key, , , , value]) => ({ key, value: value.trimEnd() }),
);
const blank = map(rest, () => null);

const line = right(spaces, alt(header, left(pair, rest), blank));

// On a bad line, skip to the end of it and carry on.
const toEol = skipUntil(regex(/[\r\n]/));
const lines = many(recover(left(line, eol), right(toEol, eol)));

/** Parse INI text into sections (keys before any header go in `""`), plus any errors. */
export const parseIni = (input: string): ParseResult<{ readonly ini: Ini; readonly errors: readonly string[] }> => {
  const r = parse(lines, input);
  if (!r.ok) return r;
  const ini: Record<string, Record<string, string>> = {};
  const errors: string[] = [];
  let section = "";
  for (const node of r.value) {
    if (!node.ok) errors.push(formatFailure(locateFailure(input, node.failure)));
    else if (node.value && "section" in node.value) section = node.value.section;
    else if (node.value) (ini[section] ??= {})[node.value.key] = node.value.value;
  }
  return { ok: true, value: { ini, errors } };
};
