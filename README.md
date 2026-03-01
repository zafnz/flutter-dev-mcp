# flutter-dev-mcp

An MCP (Model Context Protocol) server that gives AI coding agents first-class Flutter development tools.

## Why?

Flutter CLI tools are designed for humans, not agents. `flutter test` dumps hundreds of lines of output that overwhelm context windows. `flutter run` requires interactive terminal access for hot reload. `flutter analyze` produces unstructured text. This MCP server wraps the Flutter CLI into structured, agent-friendly tools with sensible output limits.

Key design decisions:
- **Test results are two-phase**: `flutter_test` returns a compact summary of failures. `flutter_get_result` fetches full error details for specific tests. This prevents a single test run from blowing the context window.
- **All outputs are capped at 24KB** to stay within typical tool response limits.
- **`flutter run` is managed**: The server holds the process, exposes hot reload/restart/logs/kill as separate tools, so the agent doesn't need terminal access.
- **Inputs are sanitized**: All commands use array-based process spawning (no shell). Project paths are normalized and validated. Package names and device IDs are checked for flag injection.

## Tools at a glance

| Tool | Parameters | Description |
|------|-----------|-------------|
| `flutter_test` | project_dir, [test_path], [test_name] | Run tests and return a compact summary of failures only. Use `flutter_get_result` to drill into specific failures. |
| `flutter_get_result` | test_run_id, test_ids | Get full error details for specific test IDs from a previous `flutter_test` run. Output capped at 24KB. |
| `flutter_run` | project_dir, [device], [is_debug], [dont_detach] | Start a Flutter app on `device` (e.g. `macos`, `chrome`, emulator ID) in debug or release mode. By default detaches after the app starts and returns a `run_id`. |
| `flutter_hot_reload` | run_id | Hot reload a running app. |
| `flutter_hot_restart` | run_id | Hot restart a running app. |
| `flutter_kill` | run_id | Kill a running app. Graceful shutdown, force-kills after 5s. |
| `flutter_logs` | run_id | Get logs from a running app. Returns the most recent output, capped at 24KB. |
| `flutter_analyze` | project_dir | Run static analysis. Returns structured issues with severity, file, line, column, and rule name. |
| `flutter_devices` | [wireless] | List available devices (simulators, emulators, physical). Skips wireless scan by default. |
| `flutter_clean` | project_dir | Delete build artifacts. Useful when builds get into a bad state. |
| `flutter_pub_get` | project_dir | Resolve and download dependencies. |
| `flutter_pub_add` | project_dir, packages, [dev] | Add one or more packages. Supports `dev` dependencies. |
| `flutter_gen_l10n` | project_dir | Generate localization files from ARB files. |
| `flutter_build_runner` | project_dir, [delete_conflicting] | Run `build_runner` for code generation (freezed, json_serializable, drift, etc.). |

Parameters in `[brackets]` are optional.

## Install

Requires Node.js 18+ and Flutter SDK on your PATH.

```bash
npm install -g flutter-dev-mcp
```

Or run directly with npx (recommended):

```bash
npx -y flutter-dev-mcp
```

### Options

```
--limit-tools  Only expose tools that provide significant benefit over
               direct CLI usage (testing, app lifecycle, logs). Omits
               analyze, devices, clean, pub get/add, gen-l10n, and
               build_runner, which agents can run via shell without issue.
```

## Configuration

### Claude Code (CLI)

Add to your MCP settings (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "flutter-dev": {
      "command": "npx",
      "args": ["-y", "flutter-dev-mcp"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "flutter-dev": {
      "command": "npx",
      "args": ["-y", "flutter-dev-mcp"]
    }
  }
}
```

### Codex / Other agents

Any agent that supports MCP can use this server. Point it at the stdio transport:

```bash
npx -y flutter-dev-mcp
```

The server communicates over stdin/stdout using the MCP JSON-RPC protocol.

## Tools

### Testing

#### `flutter_test`

Run tests and get a summary of failures.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_dir` | string | yes | Path to the Flutter project |
| `test_path` | string | no | Specific test file or directory |
| `test_name` | string | no | Filter by test name (plain string match) |

Returns a `test_run_id` and an array of failed tests with short error excerpts. Pass the `test_run_id` to `flutter_get_result` for full details.

#### `flutter_get_result`

Get full error output for specific test IDs from a previous run.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `test_run_id` | number | yes | From a previous `flutter_test` call |
| `test_ids` | number[] | yes | Test IDs to get details for |

Output is capped at 24KB total. If a single test exceeds that, its error is truncated. If multiple tests would exceed it, only tests that fit are returned.

### App lifecycle

#### `flutter_run`

Start a Flutter app and get a `run_id` for subsequent commands.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_dir` | string | yes | | Path to the Flutter project |
| `device` | string | no | `""` | Device ID (e.g. `chrome`, `macos`, emulator ID) |
| `is_debug` | boolean | no | `true` | Debug mode (true) or release mode (false) |
| `dont_detach` | boolean | no | `false` | Wait for app to exit instead of returning after start |

#### `flutter_hot_reload`

Trigger a hot reload on a running app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `run_id` | number | yes | From a previous `flutter_run` call |

#### `flutter_hot_restart`

Trigger a hot restart on a running app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `run_id` | number | yes | From a previous `flutter_run` call |

#### `flutter_kill`

Kill a running app. Sends `q` for graceful shutdown, force-kills after 5s.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `run_id` | number | yes | From a previous `flutter_run` call |

#### `flutter_logs`

Get logs from a running app. Returns the most recent output, capped at 24KB.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `run_id` | number | yes | From a previous `flutter_run` call |

### Analysis

#### `flutter_analyze`

Run static analysis. Returns structured issues with severity, file location, and lint rule name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_dir` | string | yes | Path to the Flutter project |

#### `flutter_devices`

List available devices.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `wireless` | boolean | no | `false` | Include wireless devices (slower) |

### Dependencies & codegen

#### `flutter_pub_get`

Resolve and download dependencies.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_dir` | string | yes | Path to the Flutter project |

#### `flutter_pub_add`

Add packages to the project.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_dir` | string | yes | | Path to the Flutter project |
| `packages` | string[] | yes | | Package names (e.g. `["http", "provider"]`) |
| `dev` | boolean | no | `false` | Add as dev dependency |

#### `flutter_clean`

Delete build artifacts. Useful when builds get into a bad state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_dir` | string | yes | Path to the Flutter project |

#### `flutter_gen_l10n`

Generate localization files from ARB files.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_dir` | string | yes | Path to the Flutter project |

#### `flutter_build_runner`

Run `dart run build_runner build` for code generation (freezed, json_serializable, drift, etc.).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project_dir` | string | yes | | Path to the Flutter project |
| `delete_conflicting` | boolean | no | `true` | Delete conflicting outputs before building |

## Building from source

```bash
git clone <repo-url>
cd flutter-dev-mcp
npm install
npm run build
node dist/index.js
```

## License

MIT
