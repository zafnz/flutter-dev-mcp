import { spawn, type ChildProcess } from "node:child_process";

interface FlutterRunInstance {
  process: ChildProcess;
  projectDir: string;
  logs: string[];
  started: boolean;
  appId: string | null;
  error: string | null;
}

const runInstances = new Map<number, FlutterRunInstance>();
let nextRunId = 1;

const MAX_LOG_LINES = 5000;

export interface FlutterRunResult {
  run_id: number;
  success: boolean;
  error?: string;
}

export async function flutterRun(
  projectDir: string,
  device: string,
  isDebug: boolean,
  dontDetach: boolean,
): Promise<FlutterRunResult> {
  const args = ["run"];

  if (device) {
    args.push("-d", device);
  }

  args.push(isDebug ? "--debug" : "--release");

  const runId = nextRunId++;
  const proc = spawn("flutter", args, {
    cwd: projectDir,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const instance: FlutterRunInstance = {
    process: proc,
    projectDir,
    logs: [],
    started: false,
    appId: null,
    error: null,
  };

  runInstances.set(runId, instance);

  const addLog = (line: string) => {
    instance.logs.push(line);
    if (instance.logs.length > MAX_LOG_LINES) {
      instance.logs.shift();
    }
  };

  proc.stdout!.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      if (line.trim()) addLog(line);
    }
  });

  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const line of text.split("\n")) {
      if (line.trim()) addLog(`[stderr] ${line}`);
    }
  });

  proc.on("close", (code) => {
    if (!instance.started) {
      instance.error = `Process exited with code ${code} before app started`;
    }
    addLog(`[process exited with code ${code}]`);
  });

  proc.on("error", (err) => {
    instance.error = err.message;
    addLog(`[process error: ${err.message}]`);
  });

  // Wait for the app to start or fail
  try {
    await waitForAppStart(instance, dontDetach);
  } catch (err) {
    return {
      run_id: runId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    run_id: runId,
    success: true,
  };
}

function waitForAppStart(
  instance: FlutterRunInstance,
  dontDetach: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // The ready indicators in flutter run output
    const readyPatterns = [
      /Flutter run key commands/i,
      /An Observatory debugger/i,
      /The Flutter DevTools debugger/i,
      /A Dart VM Service/i,
    ];

    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for Flutter app to start (120s)"));
    }, 120_000);

    const checkLine = (data: Buffer) => {
      const text = data.toString();
      for (const pattern of readyPatterns) {
        if (pattern.test(text)) {
          clearTimeout(timeout);
          instance.started = true;
          instance.process.stdout!.removeListener("data", checkLine);
          resolve();
          return;
        }
      }
    };

    instance.process.stdout!.on("data", checkLine);

    instance.process.on("close", (code) => {
      clearTimeout(timeout);
      if (!instance.started) {
        const recentLogs = instance.logs.slice(-20).join("\n");
        reject(
          new Error(
            `Flutter run exited with code ${code} before app started.\nRecent output:\n${recentLogs}`,
          ),
        );
      }
    });

    instance.process.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start flutter run: ${err.message}`));
    });
  });
}

export function flutterHotReload(runId: number): { success: boolean; error?: string } {
  const instance = runInstances.get(runId);
  if (!instance) {
    return { success: false, error: `No flutter run instance found with id ${runId}` };
  }

  if (!instance.started || instance.process.killed) {
    return { success: false, error: "Flutter run is not running" };
  }

  try {
    instance.process.stdin!.write("r");
    instance.logs.push("[hot reload triggered]");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to send hot reload: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function flutterHotRestart(runId: number): { success: boolean; error?: string } {
  const instance = runInstances.get(runId);
  if (!instance) {
    return { success: false, error: `No flutter run instance found with id ${runId}` };
  }

  if (!instance.started || instance.process.killed) {
    return { success: false, error: "Flutter run is not running" };
  }

  try {
    instance.process.stdin!.write("R");
    instance.logs.push("[hot restart triggered]");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to send hot restart: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function flutterKill(runId: number): { success: boolean; error?: string } {
  const instance = runInstances.get(runId);
  if (!instance) {
    return { success: false, error: `No flutter run instance found with id ${runId}` };
  }

  if (instance.process.killed) {
    runInstances.delete(runId);
    return { success: true };
  }

  try {
    // Send 'q' to gracefully quit, then force kill after a timeout
    instance.process.stdin!.write("q");
    setTimeout(() => {
      if (!instance.process.killed) {
        instance.process.kill("SIGKILL");
      }
    }, 5000);
    runInstances.delete(runId);
    return { success: true };
  } catch {
    // If stdin write fails, force kill
    instance.process.kill("SIGKILL");
    runInstances.delete(runId);
    return { success: true };
  }
}

const MAX_LOG_OUTPUT_BYTES = 24 * 1024;

export function flutterLogs(runId: number): { logs: string; error?: string } {
  const instance = runInstances.get(runId);
  if (!instance) {
    return { logs: "", error: `No flutter run instance found with id ${runId}` };
  }

  const allLogs = instance.logs.join("\n");

  // If logs exceed max size, return the tail
  if (Buffer.byteLength(allLogs, "utf-8") > MAX_LOG_OUTPUT_BYTES) {
    // Take from the end
    const lines = instance.logs;
    const result: string[] = [];
    let size = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      const lineSize = Buffer.byteLength(line, "utf-8") + 1; // +1 for newline
      if (size + lineSize > MAX_LOG_OUTPUT_BYTES) break;
      result.unshift(line);
      size += lineSize;
    }
    return { logs: `[... earlier logs truncated ...]\n${result.join("\n")}` };
  }

  return { logs: allLogs };
}
