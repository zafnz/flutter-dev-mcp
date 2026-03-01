#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { flutterTest, flutterGetResult } from "./flutter-test.js";
import {
  flutterRun,
  flutterHotReload,
  flutterHotRestart,
  flutterKill,
  flutterLogs,
} from "./flutter-run.js";
import { flutterAnalyze } from "./flutter-analyze.js";
import { flutterDevices } from "./flutter-devices.js";
import { flutterClean, flutterPubGet, flutterPubAdd, flutterGenL10n, flutterBuildRunner } from "./flutter-commands.js";
import { validateProjectDir, validatePackageName, validateTestPath, validateDeviceId } from "./validate.js";

const server = new McpServer({
  name: "flutter-dev-mcp",
  version: "1.0.0",
});

// --- flutter_test ---
server.registerTool("flutter_test", {
  description:
    "Run flutter tests and return a summary of failed tests. Use flutter_get_result to get full error details for specific test IDs.",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
    test_path: z
      .string()
      .optional()
      .describe("Specific test file or directory to run (e.g. test/widget_test.dart)"),
    test_name: z
      .string()
      .optional()
      .describe("Filter tests by name (plain string match)"),
  },
}, async ({ project_dir, test_path, test_name }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const path = test_path ? validateTestPath(test_path) : undefined;
    const result = await flutterTest(dir, path, test_name);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

// --- flutter_get_result ---
server.registerTool("flutter_get_result", {
  description:
    "Get full error details for specific test IDs from a previous flutter_test run. Output is capped at 24KB.",
  inputSchema: {
    test_run_id: z.number().describe("The test_run_id from a previous flutter_test call"),
    test_ids: z.array(z.number()).describe("Array of test_id values to get full details for"),
  },
}, ({ test_run_id, test_ids }) => {
  try {
    const results = flutterGetResult(test_run_id, test_ids);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

// --- flutter_run ---
server.registerTool("flutter_run", {
  description:
    "Start a Flutter app. Returns a run_id for use with hot_reload, hot_restart, and logs tools.",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
    device: z
      .string()
      .default("")
      .describe("Target device ID (e.g. 'chrome', 'macos', an emulator ID). Empty for default."),
    is_debug: z.boolean().default(true).describe("Run in debug mode (true) or release mode (false)"),
    dont_detach: z.boolean().default(false).describe("If true, wait for the app to finish instead of returning immediately after start"),
  },
}, async ({ project_dir, device, is_debug, dont_detach }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const dev = device ? validateDeviceId(device) : "";
    const result = await flutterRun(dir, dev, is_debug, dont_detach);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

// --- flutter_hot_reload ---
server.registerTool("flutter_hot_reload", {
  description: "Trigger a hot reload on a running Flutter app.",
  inputSchema: {
    run_id: z.number().describe("The run_id from a previous flutter_run call"),
  },
}, ({ run_id }) => {
  const result = flutterHotReload(run_id);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
});

// --- flutter_hot_restart ---
server.registerTool("flutter_hot_restart", {
  description: "Trigger a hot restart on a running Flutter app.",
  inputSchema: {
    run_id: z.number().describe("The run_id from a previous flutter_run call"),
  },
}, ({ run_id }) => {
  const result = flutterHotRestart(run_id);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
});

// --- flutter_kill ---
server.registerTool("flutter_kill", {
  description: "Kill a running Flutter app.",
  inputSchema: {
    run_id: z.number().describe("The run_id from a previous flutter_run call"),
  },
}, ({ run_id }) => {
  const result = flutterKill(run_id);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
});

// --- flutter_logs ---
server.registerTool("flutter_logs", {
  description:
    "Get logs from a running Flutter app. Returns the most recent logs, capped at 24KB.",
  inputSchema: {
    run_id: z.number().describe("The run_id from a previous flutter_run call"),
  },
}, ({ run_id }) => {
  const result = flutterLogs(run_id);
  return {
    content: [{ type: "text" as const, text: result.error ? JSON.stringify(result) : result.logs }],
    isError: !!result.error,
  };
});

// --- flutter_analyze ---
server.registerTool("flutter_analyze", {
  description:
    "Run static analysis on a Flutter project. Returns all errors, warnings, and info-level issues with file locations and rule names.",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
  },
}, async ({ project_dir }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const result = await flutterAnalyze(dir);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

// --- flutter_devices ---
server.registerTool("flutter_devices", {
  description:
    "List available Flutter devices (simulators, emulators, physical devices).",
  inputSchema: {
    wireless: z.boolean().default(false).describe("Include wirelessly connected devices (slower, default false)"),
  },
}, async ({ wireless }) => {
  try {
    const devices = await flutterDevices(wireless);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(devices, null, 2) }],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      ],
      isError: true,
    };
  }
});

// --- flutter_clean ---
server.registerTool("flutter_clean", {
  description: "Run flutter clean to delete build artifacts. Useful when builds get into a bad state.",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
  },
}, async ({ project_dir }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const result = await flutterClean(dir);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
      isError: true,
    };
  }
});

// --- flutter_pub_get ---
server.registerTool("flutter_pub_get", {
  description: "Run flutter pub get to resolve and download dependencies.",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
  },
}, async ({ project_dir }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const result = await flutterPubGet(dir);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
      isError: true,
    };
  }
});

// --- flutter_pub_add ---
server.registerTool("flutter_pub_add", {
  description: "Add one or more packages to the project's dependencies.",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
    packages: z.array(z.string()).describe("Package names to add (e.g. ['http', 'provider'])"),
    dev: z.boolean().default(false).describe("Add as dev dependency"),
  },
}, async ({ project_dir, packages, dev }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const validatedPackages = packages.map(validatePackageName);
    const result = await flutterPubAdd(dir, validatedPackages, dev);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
      isError: true,
    };
  }
});

// --- flutter_gen_l10n ---
server.registerTool("flutter_gen_l10n", {
  description: "Generate localization files from ARB files.",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
  },
}, async ({ project_dir }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const result = await flutterGenL10n(dir);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
      isError: true,
    };
  }
});

// --- flutter_build_runner ---
server.registerTool("flutter_build_runner", {
  description: "Run build_runner to generate code (freezed, json_serializable, drift, etc.).",
  inputSchema: {
    project_dir: z.string().describe("Path to the Flutter project directory"),
    delete_conflicting: z.boolean().default(true).describe("Delete conflicting outputs before building (usually what you want)"),
  },
}, async ({ project_dir, delete_conflicting }) => {
  try {
    const dir = validateProjectDir(project_dir);
    const result = await flutterBuildRunner(dir, delete_conflicting);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      isError: !result.success,
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
      isError: true,
    };
  }
});

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Flutter Dev MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
