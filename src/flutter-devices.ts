import { spawn } from "node:child_process";

interface FlutterDevice {
  name: string;
  id: string;
  targetPlatform: string;
  emulator: boolean;
  sdk: string;
}

export async function flutterDevices(wireless: boolean): Promise<FlutterDevice[]> {
  const output = await runDevices(wireless);

  try {
    const raw = JSON.parse(output) as Array<{
      name: string;
      id: string;
      targetPlatform: string;
      emulator: boolean;
      sdk: string;
    }>;

    return raw.map((d) => ({
      name: d.name,
      id: d.id,
      targetPlatform: d.targetPlatform,
      emulator: d.emulator,
      sdk: d.sdk,
    }));
  } catch {
    throw new Error(`Failed to parse flutter devices output: ${output.substring(0, 500)}`);
  }
}

function runDevices(wireless: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["devices", "--machine"];
    if (!wireless) {
      args.push("--device-connection", "attached");
    }

    const proc = spawn("flutter", args, {
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
      if (code !== 0) {
        reject(new Error(`flutter devices failed with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start flutter devices: ${err.message}`));
    });
  });
}
