import { spawn } from "node:child_process";

interface AnalyzeIssue {
  severity: "error" | "warning" | "info";
  message: string;
  file: string;
  line: number;
  column: number;
  rule: string;
}

export interface AnalyzeResult {
  issues: AnalyzeIssue[];
  error_count: number;
  warning_count: number;
  info_count: number;
}

export async function flutterAnalyze(
  projectDir: string,
): Promise<AnalyzeResult> {
  await runPubGet(projectDir);
  const output = await runAnalyze(projectDir);
  return parseAnalyzeOutput(output);
}

// Pattern: "   info • message • file:line:col • rule_name"
const issuePattern = /^\s*(error|warning|info)\s+•\s+(.+?)\s+•\s+(.+?):(\d+):(\d+)\s+•\s+(\S+)\s*$/;

function parseAnalyzeOutput(output: string): AnalyzeResult {
  const issues: AnalyzeIssue[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const line of output.split("\n")) {
    const match = issuePattern.exec(line);
    if (!match) continue;

    const severity = match[1] as "error" | "warning" | "info";
    issues.push({
      severity,
      message: match[2]!,
      file: match[3]!,
      line: parseInt(match[4]!, 10),
      column: parseInt(match[5]!, 10),
      rule: match[6]!,
    });

    if (severity === "error") errorCount++;
    else if (severity === "warning") warningCount++;
    else infoCount++;
  }

  return {
    issues,
    error_count: errorCount,
    warning_count: warningCount,
    info_count: infoCount,
  };
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

function runAnalyze(projectDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("flutter", ["analyze", "--no-pub"], {
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
      // flutter analyze exits non-zero when issues are found — that's expected
      if (stdout.length > 0) {
        resolve(stdout);
      } else if (code !== 0 && stderr.length > 0) {
        reject(new Error(`flutter analyze failed: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start flutter analyze: ${err.message}`));
    });
  });
}
