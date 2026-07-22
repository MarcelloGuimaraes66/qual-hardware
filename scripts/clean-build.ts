import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const output = resolve(projectRoot, "dist");

if (!output.startsWith(`${projectRoot}${sep}`) || output === projectRoot) {
  throw new Error(`unsafe_build_output:${output}`);
}

await rm(output, { recursive: true, force: true });
