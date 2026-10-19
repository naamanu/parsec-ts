// CSV per RFC 4180: comma-separated fields; double-quoted fields may contain
// commas, line breaks and doubled quotes (""); records end with CRLF, LF or CR.
import { alt, between, many, map, parse, regex, sepBy1, sepEndBy, str, type ParseResult } from "../src/index.ts";

type Row = readonly string[];

const quoted = map(
  between(str('"'), many(alt(regex(/[^"]+/, "quoted text"), map(str('""'), () => '"'))), str('"')),
  (parts) => parts.join(""),
);
const bare = regex(/[^,"\r\n]*/, "field");
const record = sepBy1(alt(quoted, bare), str(","));
const lineBreak = regex(/\r\n|\n|\r/, "line break");

// A final line break is optional, but it leaves an empty record after it.
const isBlank = (row: Row) => row.length === 1 && row[0] === "";
const dropFinalBlank = (rows: readonly Row[]) => (rows.length > 1 && isBlank(rows.at(-1)!) ? rows.slice(0, -1) : rows);

const csv = map(sepEndBy(record, lineBreak), dropFinalBlank);

/** Parse CSV text into rows of fields. */
export const parseCsv = (input: string): ParseResult<readonly Row[]> =>
  input === "" ? { ok: true, value: [] } : parse(csv, input);
