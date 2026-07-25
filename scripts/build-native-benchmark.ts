import { execFile } from "node:child_process";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const target = `${platform()}-${arch()}`;
const supported = new Set(["win32-x64", "linux-x64", "darwin-arm64"]);
if (!supported.has(target)) throw new Error(`native_benchmark_target_unsupported:${target}`);
const source = join(root, "tools", "native-bench");
const build = join(root, "resources", "native", target, "build");
const output = join(root, "resources", "native", target);

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function cmakePath(): Promise<string> {
  if (process.env.CMAKE_PATH && await exists(process.env.CMAKE_PATH)) return process.env.CMAKE_PATH;
  if (platform() === "win32") {
    for (const edition of ["Community", "Professional", "Enterprise", "BuildTools"]) {
      for (const year of ["2022", "18"]) {
        const candidate = `C:\\Program Files\\Microsoft Visual Studio\\${year}\\${edition}\\Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake.exe`;
        if (await exists(candidate)) return candidate;
      }
    }
  }
  return "cmake";
}

async function latestVersionDirectory(root: string): Promise<string | null> {
  if (!await exists(root)) return null;
  const versions = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  return versions[0] ? join(root, versions[0]) : null;
}

async function windowsVisualStudioBuildTools(): Promise<{
  ninja: string;
  cmakeArguments: string[];
  environment: NodeJS.ProcessEnv;
} | null> {
  if (platform() !== "win32") return null;
  for (const edition of ["Community", "Professional", "Enterprise", "BuildTools"]) {
    for (const year of ["2022", "18"]) {
      const visualStudio = `C:\\Program Files\\Microsoft Visual Studio\\${year}\\${edition}`;
      const ninja = join(
        visualStudio,
        "Common7",
        "IDE",
        "CommonExtensions",
        "Microsoft",
        "CMake",
        "Ninja",
        "ninja.exe",
      );
      const msvc = await latestVersionDirectory(join(visualStudio, "VC", "Tools", "MSVC"));
      const windowsKits = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10");
      const windowsSdk = await latestVersionDirectory(join(windowsKits, "Include"));
      if (!msvc || !windowsSdk || !await exists(ninja)) continue;
      const sdkVersion = windowsSdk.slice(windowsSdk.lastIndexOf("\\") + 1);
      const compilerDirectory = join(msvc, "bin", "Hostx64", "x64");
      const sdkBinaryDirectory = join(windowsKits, "bin", sdkVersion, "x64");
      const compiler = join(compilerDirectory, "cl.exe");
      const linker = join(compilerDirectory, "link.exe");
      const resourceCompiler = join(sdkBinaryDirectory, "rc.exe");
      const manifestTool = join(sdkBinaryDirectory, "mt.exe");
      if (!(await Promise.all([compiler, linker, resourceCompiler, manifestTool].map(exists))).every(Boolean)) continue;
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: [
          compilerDirectory,
          sdkBinaryDirectory,
          join(visualStudio, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake", "Ninja"),
          process.env.PATH ?? "",
        ].join(";"),
        INCLUDE: [
          join(msvc, "include"),
          join(windowsKits, "Include", sdkVersion, "ucrt"),
          join(windowsKits, "Include", sdkVersion, "shared"),
          join(windowsKits, "Include", sdkVersion, "um"),
          join(windowsKits, "Include", sdkVersion, "winrt"),
          join(windowsKits, "Include", sdkVersion, "cppwinrt"),
        ].join(";"),
        LIB: [
          join(msvc, "lib", "x64"),
          join(windowsKits, "Lib", sdkVersion, "ucrt", "x64"),
          join(windowsKits, "Lib", sdkVersion, "um", "x64"),
        ].join(";"),
      };
      return {
        ninja,
        environment,
        cmakeArguments: [
          `-DCMAKE_CXX_COMPILER=${compiler.replaceAll("\\", "/")}`,
          `-DCMAKE_LINKER=${linker.replaceAll("\\", "/")}`,
          `-DCMAKE_RC_COMPILER=${resourceCompiler.replaceAll("\\", "/")}`,
          `-DCMAKE_MT=${manifestTool.replaceAll("\\", "/")}`,
        ],
      };
    }
  }
  return null;
}

async function executeCmake(
  cmake: string,
  args: string[],
  windowsTools: Awaited<ReturnType<typeof windowsVisualStudioBuildTools>>,
): Promise<void> {
  await execFileAsync(cmake, args, {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    ...(windowsTools ? { env: windowsTools.environment } : {}),
  });
}

await rm(build, { recursive: true, force: true });
await mkdir(build, { recursive: true });
const cmake = await cmakePath();
const windowsTools = await windowsVisualStudioBuildTools();
let configured = false;
let configureError: unknown = null;
const configureAttempts = platform() === "win32" ? 3 : 1;
for (let attempt = 1; attempt <= configureAttempts; attempt += 1) {
  try {
    await executeCmake(cmake, [
      ...(windowsTools
        ? ["-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${windowsTools.ninja.replaceAll("\\", "/")}`,
          ...windowsTools.cmakeArguments]
        : []),
      "-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release",
    ], windowsTools);
    configured = true;
    break;
  } catch (error) {
    configureError = error;
    if (attempt === configureAttempts) break;
    // Antivírus pode manter arquivos recém-criados do gerador VS abertos por
    // alguns milissegundos. Recriar a árvore torna o build reproduzível.
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));
    await rm(build, { recursive: true, force: true });
    await mkdir(build, { recursive: true });
  }
}
if (!configured) throw configureError;
let compiled = false;
let compileError: unknown = null;
const compileAttempts = platform() === "win32" ? 3 : 1;
for (let attempt = 1; attempt <= compileAttempts; attempt += 1) {
  try {
    await executeCmake(cmake, ["--build", build, "--config", "Release", "--parallel"], windowsTools);
    compiled = true;
    break;
  } catch (error) {
    compileError = error;
    if (attempt < compileAttempts) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 750));
    }
  }
}
if (!compiled) throw compileError;
const fileName = platform() === "win32" ? "qual-hardware-native-bench.exe" : "qual-hardware-native-bench";
const candidates = [
  join(build, fileName),
  join(build, "Release", fileName),
];
const built = (await Promise.all(candidates.map(async (candidate) => await exists(candidate) ? candidate : null)))
  .find((candidate): candidate is string => Boolean(candidate));
if (!built) {
  const entries = await readdir(build, { recursive: true });
  throw new Error(`native_benchmark_output_missing:${entries.join(",")}`);
}
const finalPath = join(output, fileName);
await mkdir(output, { recursive: true });
await execFileAsync(cmake, ["-E", "copy_if_different", built, finalPath], { windowsHide: true });
const selfTest = await execFileAsync(finalPath, ["--self-test"], { timeout: 15_000, maxBuffer: 1_000_000, windowsHide: true });
const result = JSON.parse(selfTest.stdout) as { status?: string; schemaVersion?: string };
if (result.status !== "passed" || result.schemaVersion !== "qual-hardware-native-benchmark/1.0.0") {
  throw new Error("native_benchmark_self_test_failed");
}
process.stdout.write(`${JSON.stringify({ target, output: finalPath, status: result.status })}\n`);
