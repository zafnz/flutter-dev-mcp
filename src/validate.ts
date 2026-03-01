import { resolve, normalize } from "node:path";
import { existsSync, statSync } from "node:fs";

/**
 * Validates and normalizes a project directory path.
 * - Resolves to absolute path
 * - Normalizes away ../ traversal
 * - Verifies the directory exists
 * - Verifies it looks like a Flutter project (has pubspec.yaml)
 */
export function validateProjectDir(projectDir: string): string {
  const normalized = resolve(normalize(projectDir));

  if (!existsSync(normalized)) {
    throw new Error(`Directory does not exist: ${normalized}`);
  }

  const stat = statSync(normalized);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${normalized}`);
  }

  const pubspecPath = resolve(normalized, "pubspec.yaml");
  if (!existsSync(pubspecPath)) {
    throw new Error(`Not a Flutter project (no pubspec.yaml found): ${normalized}`);
  }

  return normalized;
}

/**
 * Validates a package name for flutter pub add.
 * Package names must be valid Dart package identifiers, optionally with a version constraint.
 * e.g. "http", "provider:^6.0.0", "http:any"
 */
export function validatePackageName(pkg: string): string {
  // Must not start with a dash (flag injection)
  if (pkg.startsWith("-")) {
    throw new Error(`Invalid package name (cannot start with -): ${pkg}`);
  }

  // Basic format: alphanumeric/underscore, optionally followed by :version
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*(?::.*)?$/.test(pkg)) {
    throw new Error(`Invalid package name: ${pkg}`);
  }

  return pkg;
}

/**
 * Validates a device ID string for flutter run.
 */
export function validateDeviceId(device: string): string {
  if (device.startsWith("-")) {
    throw new Error(`Invalid device ID (cannot start with -): ${device}`);
  }
  return device;
}

/**
 * Validates a test path - must be a relative path within the project, no traversal.
 */
export function validateTestPath(testPath: string): string {
  const normalized = normalize(testPath);

  if (normalized.startsWith("/") || normalized.startsWith("..")) {
    throw new Error(`Test path must be relative and within the project: ${testPath}`);
  }

  if (normalized.startsWith("-")) {
    throw new Error(`Invalid test path (cannot start with -): ${testPath}`);
  }

  return normalized;
}
