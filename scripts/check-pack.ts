// Fail if the npm tarball would contain anything other than the build output
// and package metadata (e.g. tests, examples or source accidentally shipped).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const allowed = [/^dist\/.+\.(js|d\.ts|js\.map)$/, /^(package\.json|README\.md|LICENSE)$/];
const required = ["dist/index.js", "dist/index.d.ts", "dist/fp.js", "dist/fp.d.ts", "package.json", "README.md", "LICENSE"];

// npm and JSR must publish the same version.
const versionOf = (file: string) => (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
if (versionOf("package.json") !== versionOf("jsr.json")) {
  console.error(`Version mismatch: package.json ${versionOf("package.json")}, jsr.json ${versionOf("jsr.json")}`);
  process.exit(1);
}

const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" })) as [
  { files: { path: string }[]; size: number; unpackedSize: number },
];
const files = pack.files.map((f) => f.path);

const unexpected = files.filter((f) => !allowed.some((re) => re.test(f)));
const missing = required.filter((f) => !files.includes(f));

console.log(`${files.length} files, ${(pack.size / 1024).toFixed(1)} kB packed, ${(pack.unpackedSize / 1024).toFixed(1)} kB unpacked`);
if (unexpected.length || missing.length) {
  if (unexpected.length) console.error("Unexpected files:", unexpected);
  if (missing.length) console.error("Missing files:", missing);
  process.exit(1);
}
