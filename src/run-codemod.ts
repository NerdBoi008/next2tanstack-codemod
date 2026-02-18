import { Lang, parse } from "@ast-grep/napi";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CodemodRoot } from "./types/index.ts";
import transform from "./scripts/codemod.ts";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);
const ANSI_RED = "\x1b[31m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RESET = "\x1b[0m";

type RunResult = {
  changed: boolean;
  moved: boolean;
  before: string | null;
  after: string | null;
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

async function existsFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function collectFiles(targetPath: string): Promise<string[]> {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) return [targetPath];

  const files: string[] = [];
  async function walk(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        if (entry.name !== ".well-known") continue;
      }
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;

      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!CODE_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push(entryPath);
    }
  }

  await walk(targetPath);
  return files;
}

export async function runCodemodOnFile(
  filePath: string,
  dryRun: boolean,
): Promise<RunResult> {
  const source = await fs.readFile(filePath, "utf8");
  const ast = parse(Lang.Tsx, source);
  const root: CodemodRoot = {
    root: () => ast.root(),
    filename: () => filePath,
  };

  const previousDryRun = process.env.CODEMOD_DRY_RUN;
  if (dryRun) process.env.CODEMOD_DRY_RUN = "1";
  let result: string | null;
  try {
    result = await transform(root);
  } finally {
    if (dryRun) {
      if (previousDryRun === undefined) delete process.env.CODEMOD_DRY_RUN;
      else process.env.CODEMOD_DRY_RUN = previousDryRun;
    }
  }

  if (result === null) {
    const moved = !(await existsFile(filePath));
    return { changed: moved, moved, before: source, after: null };
  }

  if (result === source)
    return { changed: false, moved: false, before: source, after: result };
  if (!dryRun) await fs.writeFile(filePath, result, "utf8");
  return { changed: true, moved: false, before: source, after: result };
}

type CliArgs = {
  target: string;
  dryRun: boolean;
  showDiff: boolean;
};

function parseCliArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let showDiff = false;
  let target = ".";

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--diff") {
      showDiff = true;
      continue;
    }
    if (arg === "--allow-dirty" || arg === "-v" || arg === "--verbose") {
      continue;
    }
    if (arg.startsWith("--")) continue;
    target = arg;
  }

  return { target, dryRun, showDiff };
}

function createUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string | null {
  if (before === after) return null;

  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  type DiffOp = { type: "equal" | "delete" | "insert"; line: string };
  const dp: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    const currentRow = dp[i]!;
    const nextRow = dp[i + 1]!;
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const oldLine = oldLines[i]!;
      const newLine = newLines[j]!;
      if (oldLine === newLine) currentRow[j] = nextRow[j + 1]! + 1;
      else currentRow[j] = Math.max(nextRow[j]!, currentRow[j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    const oldLine = oldLines[i]!;
    const newLine = newLines[j]!;
    if (oldLine === newLine) {
      ops.push({ type: "equal", line: oldLine });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "delete", line: oldLine });
      i += 1;
    } else {
      ops.push({ type: "insert", line: newLine });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    ops.push({ type: "delete", line: oldLines[i]! });
    i += 1;
  }
  while (j < newLines.length) {
    ops.push({ type: "insert", line: newLines[j]! });
    j += 1;
  }

  const changeIndexes: number[] = [];
  for (let k = 0; k < ops.length; k += 1) {
    if (ops[k]!.type !== "equal") changeIndexes.push(k);
  }
  if (changeIndexes.length === 0) return null;

  const relPath = normalizePath(path.relative(process.cwd(), filePath));
  const separator = `================================================`;
  const chunks: string[] = [
    separator,
    `file: ${relPath}`,
    separator,
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
  ];
  const contextLines = 3;

  function getLineNumberAt(index: number): {
    oldLine: number;
    newLine: number;
  } {
    let oldLine = 1;
    let newLine = 1;
    for (let k = 0; k < index; k += 1) {
      const op = ops[k]!;
      if (op.type !== "insert") oldLine += 1;
      if (op.type !== "delete") newLine += 1;
    }
    return { oldLine, newLine };
  }

  let changePointer = 0;
  while (changePointer < changeIndexes.length) {
    let start = Math.max(0, changeIndexes[changePointer]! - contextLines);
    let end = Math.min(
      ops.length - 1,
      changeIndexes[changePointer]! + contextLines,
    );
    changePointer += 1;
    while (
      changePointer < changeIndexes.length &&
      changeIndexes[changePointer]! <= end + contextLines
    ) {
      end = Math.min(
        ops.length - 1,
        changeIndexes[changePointer]! + contextLines,
      );
      changePointer += 1;
    }

    const { oldLine: oldStart, newLine: newStart } = getLineNumberAt(start);
    const hunkOps = ops.slice(start, end + 1);
    let oldCount = 0;
    let newCount = 0;
    for (const op of hunkOps) {
      if (op.type !== "insert") oldCount += 1;
      if (op.type !== "delete") newCount += 1;
    }

    chunks.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of hunkOps) {
      if (op.type === "equal") chunks.push(` ${op.line}`);
      if (op.type === "delete") chunks.push(`-${op.line}`);
      if (op.type === "insert") chunks.push(`+${op.line}`);
    }
  }

  return chunks.join("\n");
}

function colorizeDiff(diff: string): string {
  const shouldColor = process.stdout.isTTY && !process.env.NO_COLOR;
  if (!shouldColor) return diff;

  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("-") && !line.startsWith("--- ")) {
        return `${ANSI_RED}${line}${ANSI_RESET}`;
      }
      if (line.startsWith("+") && !line.startsWith("+++ ")) {
        return `${ANSI_GREEN}${line}${ANSI_RESET}`;
      }
      return line;
    })
    .join("\n");
}

async function runCli(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const root = path.resolve(process.cwd(), args.target);
  const files = await collectFiles(root);

  let changed = 0;
  let moved = 0;
  let failed = 0;

  for (const filePath of files) {
    try {
      const result = await runCodemodOnFile(filePath, args.dryRun);
      if (result.changed) changed += 1;
      if (result.moved) moved += 1;
      if (result.changed) {
        const rel = normalizePath(path.relative(process.cwd(), filePath));
        // console.log(`[changed] ${rel}`);
        if (
          args.showDiff &&
          !result.moved &&
          result.before !== null &&
          result.after !== null
        ) {
          const diff = createUnifiedDiff(filePath, result.before, result.after);
          if (diff) console.log(`${colorizeDiff(diff)}\n`);
        }
      }
    } catch (error) {
      failed += 1;
      const rel = normalizePath(path.relative(process.cwd(), filePath));
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[failed] ${rel}: ${message}`);
    }
  }

  const mode = args.dryRun ? "dry-run" : "write";
  console.log(
    `Processed ${files.length} files (${mode}). changed=${changed}, moved=${moved}, failed=${failed}`,
  );

  if (failed > 0) process.exitCode = 1;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryPath = normalizePath(path.resolve(entry));
  const modulePath = normalizePath(
    path.resolve(fileURLToPath(import.meta.url)),
  );
  return entryPath === modulePath;
}

if (isMainModule()) {
  runCli().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(message);
    process.exit(1);
  });
}
