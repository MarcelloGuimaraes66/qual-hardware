import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const repository = resolve(process.env.PERCEPTRUM_SOURCE_ROOT ?? resolve(process.cwd(), ".."));
const roots = ["Perceptrum", "DrakonSite", "AppHost"];
const excludedDirectories = new Set([
  ".git", "node_modules", "bin", "obj", "dist", "build", "x64", "artifacts", "generated",
  "stage-debug", ".vs", "coverage", "packages", "AppPackages",
]);
const sourceExtensions = new Set([
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".cs", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".qml", ".ps1", ".sh", ".json", ".yaml", ".yml", ".xml", ".csproj", ".vcxproj", ".props", ".targets",
]);

interface InventoryItem { path: string; bytes: number; sha256: string; }
const files: InventoryItem[] = [];

async function visit(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) { await visit(fullPath); continue; }
    if (!entry.isFile() || !sourceExtensions.has(extname(entry.name).toLowerCase())) continue;
    const content = await readFile(fullPath);
    files.push({ path: relative(repository, fullPath).split(sep).join("/"), bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") });
  }
}

for (const root of roots) {
  const sourceRoot = resolve(repository, root);
  try {
    await access(sourceRoot);
  } catch {
    throw new Error(`Missing ${root} under PERCEPTRUM_SOURCE_ROOT=${repository}`);
  }
  await visit(sourceRoot);
}
files.sort((left, right) => left.path.localeCompare(right.path));
const aggregate = createHash("sha256");
for (const file of files) aggregate.update(`${file.path}\0${file.sha256}\n`);
const output = {
  schemaVersion: "perceptrum-source-inventory/1.0.0",
  generatedAt: new Date().toISOString(),
  roots,
  exclusions: [...excludedDirectories].sort(),
  sourceExtensions: [...sourceExtensions].sort(),
  fileCount: files.length,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  buildHash: aggregate.digest("hex"),
  files,
};
await mkdir(resolve(process.cwd(), "audit"), { recursive: true });
await writeFile(resolve(process.cwd(), "audit", "perceptrum-source-inventory.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ fileCount: output.fileCount, totalBytes: output.totalBytes, buildHash: output.buildHash }));
