import * as fs from "node:fs/promises";
import * as path from "node:path";
import { runCodemodOnFile } from "./run-codemod.ts";

type TestCase = {
  name: string;
  inputPath: string;
  expectedPath: string;
};

function normalize(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

async function discoverTests(rootDir: string): Promise<TestCase[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const cases: TestCase[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const caseDir = path.join(rootDir, entry.name);
    const files = await fs.readdir(caseDir);
    const inputName = files.find((file) => file.startsWith("input."));
    const expectedName = files.find((file) => file.startsWith("expected."));
    if (!inputName || !expectedName) continue;

    cases.push({
      name: entry.name,
      inputPath: path.join(caseDir, inputName),
      expectedPath: path.join(caseDir, expectedName),
    });
  }

  return cases.sort((a, b) => a.name.localeCompare(b.name));
}

async function runCase(testCase: TestCase): Promise<string | null> {
  const runResult = await runCodemodOnFile(testCase.inputPath, true);
  const actualSource =
    runResult.after ?? (await fs.readFile(testCase.inputPath, "utf8"));
  const actual = normalize(actualSource);
  const expected = normalize(await fs.readFile(testCase.expectedPath, "utf8"));
  if (actual !== expected) {
    return `Mismatch in ${testCase.name}`;
  }
  return null;
}

async function main(): Promise<void> {
  const testsDir = path.resolve(process.cwd(), "tests");
  const testCases = await discoverTests(testsDir);
  let failed = 0;

  for (const testCase of testCases) {
    const failure = await runCase(testCase);
    if (failure) {
      failed += 1;
      console.error(`FAIL: ${failure}`);
      continue;
    }
    console.log(`PASS: ${testCase.name}`);
  }

  console.log(`Ran ${testCases.length} tests; failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(message);
  process.exit(1);
});

