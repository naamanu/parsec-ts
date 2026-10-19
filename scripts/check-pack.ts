// Fail if the npm tarball would contain anything other than the build output
// and package metadata (e.g. tests, examples or source accidentally shipped).
import { execFileSync } from "node:child_process";

const allowed = [/^dist\/.+\.(js|d\.ts|js\.map)$/, /^(package\.json|README\.md|LICENSE)$/];
const required = ["dist/index.js", "dist/index.d.ts", "package.json", "README.md", "LICENSE"];

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
