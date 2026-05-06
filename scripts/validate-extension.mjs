import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const errors = [];
const expectedIconSizes = ["16", "32", "48", "128"];

function collectIconPaths(label, icons) {
  if (!icons || typeof icons !== "object" || Array.isArray(icons)) {
    errors.push(`${label} must define icon paths.`);
    return [];
  }

  for (const size of expectedIconSizes) {
    if (typeof icons[size] !== "string" || icons[size].length === 0) {
      errors.push(`${label}.${size} must point to an icon file.`);
    }
  }

  return Object.entries(icons).flatMap(([size, path]) => {
    if (!/^\d+$/.test(size)) {
      errors.push(`${label}.${size} must use a numeric icon size key.`);
    }

    if (typeof path !== "string" || path.length === 0) {
      return [];
    }

    return [path];
  });
}

const requiredPaths = [
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((script) => [
    ...(script.js ?? []),
    ...(script.css ?? [])
  ]),
  ...collectIconPaths("manifest.icons", manifest.icons),
  ...collectIconPaths("manifest.action.default_icon", manifest.action?.default_icon)
].filter(Boolean);

if (manifest.manifest_version !== 3) {
  errors.push("manifest_version must be 3.");
}

if (!manifest.name) {
  errors.push("manifest.name is required.");
}

if (!manifest.version) {
  errors.push("manifest.version is required.");
}

for (const path of new Set(requiredPaths)) {
  try {
    await readFile(path);
  } catch {
    errors.push(`Missing file referenced by manifest: ${path}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Extension manifest looks valid.");
