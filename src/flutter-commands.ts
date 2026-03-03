import { spawn } from "node:child_process";

interface CommandResult {
  success: boolean;
  output: string;
}

function runCommand(command: string, projectDir: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
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
      const output = (stdout + stderr).trim();
      resolve({
        success: code === 0,
        output: output || `Exited with code ${code}`,
      });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run ${command} ${args.join(" ")}: ${err.message}`));
    });
  });
}

function runFlutterCommand(projectDir: string, args: string[]): Promise<CommandResult> {
  return runCommand("flutter", projectDir, args);
}

export async function flutterClean(projectDir: string): Promise<CommandResult> {
  return runFlutterCommand(projectDir, ["clean"]);
}

export async function flutterPubGet(projectDir: string): Promise<CommandResult> {
  return runFlutterCommand(projectDir, ["pub", "get"]);
}

export async function flutterPubAdd(projectDir: string, packages: string[], dev: boolean): Promise<CommandResult> {
  const args = ["pub", "add"];
  if (dev) args.push("--dev");
  args.push(...packages);
  return runFlutterCommand(projectDir, args);
}

export async function flutterGenL10n(projectDir: string): Promise<CommandResult> {
  return runFlutterCommand(projectDir, ["gen-l10n"]);
}

const VALID_BUILD_TARGETS = new Set([
  "apk", "appbundle", "bundle", "ios", "ipa",
  "web", "macos", "windows", "linux",
  "aar", "ios-framework", "macos-framework",
]);

export async function flutterBuild(
  projectDir: string,
  target: string,
  debug: boolean,
  extraArgs: string[],
): Promise<CommandResult> {
  if (!VALID_BUILD_TARGETS.has(target)) {
    return {
      success: false,
      output: `Invalid build target: ${target}. Valid targets: ${[...VALID_BUILD_TARGETS].join(", ")}`,
    };
  }

  const args = ["build", target];
  args.push(debug ? "--debug" : "--release");
  args.push(...extraArgs);
  return runFlutterCommand(projectDir, args);
}

export async function flutterBuildRunner(projectDir: string, deleteConflicting: boolean): Promise<CommandResult> {
  const args = ["run", "build_runner", "build"];
  if (deleteConflicting) args.push("--delete-conflicting-outputs");
  return runCommand("dart", projectDir, args);
}
