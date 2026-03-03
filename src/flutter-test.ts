import { spawn } from "node:child_process";

interface TestInfo {
  id: number;
  name: string;
  suiteID: number;
  rootUrl: string | null;
}

interface SuiteInfo {
  id: number;
  path: string;
}

interface TestError {
  testID: number;
  error: string;
  stackTrace: string;
}

interface StoredTestResult {
  test_id: number;
  test_file: string;
  test_name: string;
  error: string;
}

interface TestRunSummary {
  test_id: number;
  test_file: string;
  test_name: string;
  error_excerpt: string;
}

interface TestRunResult {
  test_run_id: number;
  success: boolean;
  tests_run: number;
  tests_failed: number;
  results: TestRunSummary[];
  truncated: boolean;
}

// Store test results keyed by test_run_id
const testRunStore = new Map<number, StoredTestResult[]>();
let nextTestRunId = 1;

const MAX_EXCERPT_LENGTH = 200;
const MAX_SUMMARY_BYTES = 24 * 1024;

export async function flutterTest(
  projectDir: string,
  testPath?: string,
  testName?: string,
  extraArgs?: string[],
): Promise<TestRunResult> {
  // Run pub get separately so its non-JSON output doesn't pollute the JSON stream
  await runPubGet(projectDir);

  const args = ["test", "--no-pub", "--reporter", "json"];

  if (testName) {
    args.push("--plain-name", testName);
  }
  if (testPath) {
    args.push(testPath);
  }

  // Safe: spawn() without shell:true passes args as argv directly,
  // so shell metacharacters like $() are never interpreted.
  if (extraArgs) {
    args.push(...extraArgs);
  }

  const output = await runFlutterTest(projectDir, args);
  const events = parseJsonEvents(output);

  // Build lookup maps
  const suites = new Map<number, SuiteInfo>();
  const tests = new Map<number, TestInfo>();
  const errors = new Map<number, TestError[]>();
  const prints = new Map<number, string[]>();
  const failedTestIds = new Set<number>();
  let testsRun = 0;

  for (const event of events) {
    switch (event.type) {
      case "suite":
        suites.set(event.suite.id, {
          id: event.suite.id,
          path: event.suite.path,
        });
        break;

      case "testStart":
        tests.set(event.test.id, {
          id: event.test.id,
          name: event.test.name,
          suiteID: event.test.suiteID,
          rootUrl: event.test.root_url ?? event.test.url ?? null,
        });
        break;

      case "print":
        // Capture print messages per test — exceptions from the Flutter
        // test framework are often reported here rather than in error events
        if (event.testID != null) {
          if (!prints.has(event.testID)) {
            prints.set(event.testID, []);
          }
          prints.get(event.testID)!.push(event.message);
        }
        break;

      case "error":
        if (!errors.has(event.testID)) {
          errors.set(event.testID, []);
        }
        errors.get(event.testID)!.push({
          testID: event.testID,
          error: event.error,
          stackTrace: event.stackTrace,
        });
        break;

      case "testDone":
        if (!event.hidden) {
          testsRun++;
          if (event.result !== "success") {
            failedTestIds.add(event.testID);
          }
        }
        break;
    }
  }

  // Build results for failed tests
  const storedResults: StoredTestResult[] = [];
  const summaryResults: TestRunSummary[] = [];
  let summarySize = 0;
  let truncated = false;

  for (const testId of failedTestIds) {
    const test = tests.get(testId);
    if (!test) continue;

    const suite = suites.get(test.suiteID);
    // Prefer root_url (actual test file), then suite path, then extract from
    // test name (loading errors use "loading /path/to/test.dart" as the name)
    const testFile = test.rootUrl
      ? test.rootUrl.replace(/^file:\/\//, "")
      : suite?.path
        ? suite.path
        : test.name.replace(/^loading\s+/, "") || "unknown";
    const testErrors = errors.get(testId) ?? [];
    const testPrints = prints.get(testId) ?? [];

    // Concatenate everything we have — print messages and error events
    const parts: string[] = [];
    if (testPrints.length > 0) {
      parts.push(testPrints.join("\n"));
    }
    if (testErrors.length > 0) {
      parts.push(testErrors.map((e) => `${e.error}\n${e.stackTrace}`).join("\n\n"));
    }
    const fullError = parts.join("\n\n");

    // Always store full results for flutter_get_result
    storedResults.push({
      test_id: testId,
      test_file: testFile,
      test_name: test.name,
      error: fullError,
    });

    // Cap the summary output
    if (!truncated) {
      const summary: TestRunSummary = {
        test_id: testId,
        test_file: testFile,
        test_name: test.name,
        error_excerpt: fullError.substring(0, MAX_EXCERPT_LENGTH) + (fullError.length > MAX_EXCERPT_LENGTH ? "..." : ""),
      };
      const entrySize = Buffer.byteLength(JSON.stringify(summary), "utf-8");
      if (summarySize + entrySize > MAX_SUMMARY_BYTES) {
        truncated = true;
      } else {
        summaryResults.push(summary);
        summarySize += entrySize;
      }
    }
  }

  const testRunId = nextTestRunId++;
  testRunStore.set(testRunId, storedResults);

  return {
    test_run_id: testRunId,
    success: failedTestIds.size === 0,
    tests_run: testsRun,
    tests_failed: failedTestIds.size,
    results: summaryResults,
    truncated,
  };
}

const MAX_TOTAL_BYTES = 24 * 1024;

export function flutterGetResult(
  testRunId: number,
  testIds: number[],
): StoredTestResult[] {
  const stored = testRunStore.get(testRunId);
  if (!stored) {
    throw new Error(`No test run found with id ${testRunId}`);
  }

  const results: StoredTestResult[] = [];
  let totalSize = 0;

  for (const testId of testIds) {
    const result = stored.find((r) => r.test_id === testId);
    if (!result) continue;

    const resultJson = JSON.stringify(result);
    const resultSize = Buffer.byteLength(resultJson, "utf-8");

    if (results.length === 0) {
      // Always include at least one result, truncating if needed
      if (resultSize > MAX_TOTAL_BYTES) {
        results.push({
          ...result,
          error: result.error.substring(0, MAX_TOTAL_BYTES - 512) + "\n... [truncated]",
        });
      } else {
        results.push(result);
      }
      totalSize += Math.min(resultSize, MAX_TOTAL_BYTES);
    } else if (totalSize + resultSize <= MAX_TOTAL_BYTES) {
      results.push(result);
      totalSize += resultSize;
    } else {
      // Would exceed limit, stop adding
      break;
    }
  }

  return results;
}

function runPubGet(projectDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("flutter", ["pub", "get"], {
      cwd: projectDir,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`flutter pub get failed with code ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start flutter pub get: ${err.message}`));
    });
  });
}

function runFlutterTest(projectDir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("flutter", args, {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      // flutter test exits with non-zero when tests fail - that's expected
      if (stdout.length > 0) {
        resolve(stdout);
      } else if (code !== 0) {
        reject(new Error(`flutter test failed with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start flutter test: ${err.message}`));
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseJsonEvents(output: string): any[] {
  const events: unknown[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Skip non-JSON lines (flutter may output non-JSON messages)
    }
  }

  return events;
}
