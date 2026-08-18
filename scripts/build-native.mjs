// scripts/build-native.mjs
// Native build script with selectable target (v1: mac-arm only)
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Target alias to Rust target triple mapping.
 * This is the single source of truth for build target selection.
 */
export const TARGETS = {
  'mac-arm': {
    triple: 'aarch64-apple-darwin',
    supported: true,
  },
  'mac-intel': {
    triple: 'x86_64-apple-darwin',
    supported: false,
  },
  'mac-universal': {
    triple: 'universal2-apple-darwin',
    supported: false,
  },
  'windows-x64': {
    triple: 'x86_64-pc-windows-msvc',
    supported: false,
  },
  'linux-x64': {
    triple: 'x86_64-unknown-linux-gnu',
    supported: false,
  },
};

/**
 * Get the list of all supported (supported: true) target aliases.
 */
function getSupportedTargets() {
  return Object.entries(TARGETS)
    .filter(([_, { supported }]) => supported)
    .map(([alias]) => alias);
}

/**
 * Print usage information and supported targets.
 */
function printUsage(stderr = process.stderr) {
  const supported = getSupportedTargets();
  stderr.write(
    `Usage: ${basename(__filename)} <target-alias>\n\n` +
    `Supported targets (v1):\n  - ${supported.join('\n  - ')}\n\n` +
    `Run with one of the supported aliases to build.\n`,
  );
}

/**
 * Check if rustup is installed and the required target is available.
 */
function checkRustTarget(triple) {
  try {
    const result = spawnSync(
      'rustup',
      ['target', 'list', '--installed'],
      { shell: false },
    );

    if (result.status !== 0) {
      return { ok: false, error: 'rustup not found or not installed' };
    }

    const installed = result.stdout.toString().trim();
    if (!installed.includes(triple)) {
      return {
        ok: false,
        error: `Required Rust target not installed: ${triple}`,
        suggestedCommand: `rustup target add ${triple}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Failed to check Rust target: ${error.message}` };
  }
}

/**
 * Build the native Tauri app for the specified target.
 */
function build(targetAlias) {
  const config = TARGETS[targetAlias];
    process.stderr.write(
      `Target "${targetAlias}" is not supported in v1.\n` +
      `Only mac-arm is available for native builds.\n`,
    );
    process.exit(1);
  }

    if (process.platform !== 'darwin') {
      process.stderr.write(
        `Native builds are only supported on macOS.\n` +
        `Host platform: ${process.platform} (expected: darwin)\n`,
      );
      process.exit(1);
    }

  const rustCheck = checkRustTarget(config.triple);
  if (!rustCheck.ok) {
    process.stderr.write(
      `Prerequisites check failed for target "${targetAlias}":\n` +
      `  ${rustCheck.error}`,
    );
    if (rustCheck.suggestedCommand) {
      process.stderr.write(
        `\n` +
        `Suggested remediation:\n` +
        `  ${rustCheck.suggestedCommand}`,
      );
    }
    process.stderr.write('\n');
    process.exit(1);
  }

  console.log(`Building ${targetAlias} (${config.triple})...`);

   const result = spawn(
     'npx',
     ['tauri', 'build', '--target', config.triple],
     {
       stdio: 'inherit',
       shell: false,
     },
   );

   // Wait for the build to complete
   result.on('exit', (code) => {
     if (code === 0) {
       const bundleDir = resolve('src-tauri', 'target', config.triple, 'release', 'bundle');
       console.log(`\nBuild succeeded. Bundle outputs in:\n  ${bundleDir}`);
     }
      process.exitCode = code ?? 1;
   });

   result.on('error', (error) => {
     process.stderr.write(`Build error: ${error.message}\n`);
     process.exitCode = 1;
   });
}

// Parse command-line arguments
const args = process.argv.slice(2);
const targetAlias = args[0];

// Extract base name for usage (skip node, skip scripts/build-native.mjs)
// Use the script name directly, it already contains the full path
if (!targetAlias) {
  printUsage();
  process.exit(1);
}

// Process unknown alias early
const config = TARGETS[targetAlias];
if (!config) {
  printUsage();
  process.exit(1);
}

// Build the native application
build(targetAlias);
