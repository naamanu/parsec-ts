// Copy package.json's version into jsr.json. Runs as the npm `version`
// lifecycle script, so `npm version <bump>` updates both in one commit.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const jsr = JSON.parse(readFileSync("jsr.json", "utf8")) as { version: string };
writeFileSync("jsr.json", JSON.stringify({ ...jsr, version }, null, 2) + "\n");
console.log(`jsr.json version: ${version}`);
