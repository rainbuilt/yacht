import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const requiredPaths = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((script) => [
    ...(script.js ?? []),
    ...(script.css ?? [])
  ])
].filter(Boolean);

const errors = [];

if (manifest.manifest_version !== 3) {
  errors.push("manifest_version must be 3.");
}

if (!manifest.name) {
  errors.push("manifest.name is required.");
}

if (!manifest.version) {
  errors.push("manifest.version is required.");
}

for (const path of requiredPaths) {
  try {
    await readFile(path, "utf8");
  } catch {
    errors.push(`Missing file referenced by manifest: ${path}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Extension manifest looks valid.");
