import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const maxLineLength = 200;
const supportedExtensions = new Set([".js", ".mjs"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist"]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else if (supportedExtensions.has(extname(entry.name))) files.push(target);
  }
  return files;
}

const files = (await walk(root)).sort();
const violations = [];
for (const file of files) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (line.length > maxLineLength) {
      violations.push(`${relative(root, file).replaceAll("\\", "/")}:${index + 1} (${line.length})`);
    }
  });
}

if (violations.length) {
  for (const violation of violations) console.error(`Line exceeds ${maxLineLength} characters: ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Linted ${files.length} JavaScript modules; no line exceeds ${maxLineLength} characters.`);
}
