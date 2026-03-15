import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Check } from '../index.js';
import {
  POINTS_COMMANDS_VALID,
  POINTS_PATHS_VALID,
  POINTS_CONFIG_DRIFT,
} from '../constants.js';

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function readJsonOrNull(path: string): Record<string, unknown> | null {
  const content = readFileOrNull(path);
  if (!content) return null;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Extract npm scripts from package.json. */
function getPackageScripts(dir: string): Set<string> {
  const pkg = readJsonOrNull(join(dir, 'package.json'));
  if (!pkg?.scripts) return new Set();
  return new Set(Object.keys(pkg.scripts as Record<string, string>));
}

/** Extract commands documented in CLAUDE.md and check if they're valid. */
function validateDocumentedCommands(dir: string): {
  valid: string[];
  invalid: string[];
  total: number;
} {
  const claudeMd = readFileOrNull(join(dir, 'CLAUDE.md'));
  if (!claudeMd) return { valid: [], invalid: [], total: 0 };

  const scripts = getPackageScripts(dir);
  const valid: string[] = [];
  const invalid: string[] = [];

  // Match npm/yarn/pnpm/bun run commands — strip trailing markdown backticks/punctuation
  const cmdPattern = /(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?([a-zA-Z0-9_:@./-]+)/g;
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = cmdPattern.exec(claudeMd)) !== null) {
    const scriptName = match[1].replace(/[.,;:!?)]+$/, '');
    if (seen.has(scriptName)) continue;
    seen.add(scriptName);

    // Built-in npm commands that don't need to be in scripts
    const builtins = new Set(['install', 'ci', 'test', 'start', 'init', 'publish', 'pack', 'link', 'uninstall']);
    if (builtins.has(scriptName)) {
      // 'test' and 'start' should be in scripts if documented
      if ((scriptName === 'test' || scriptName === 'start') && !scripts.has(scriptName)) {
        invalid.push(`${match[0]} (no "${scriptName}" script in package.json)`);
      } else {
        valid.push(match[0]);
      }
      continue;
    }

    if (scripts.has(scriptName)) {
      valid.push(match[0]);
    } else {
      invalid.push(`${match[0]} (no "${scriptName}" script in package.json)`);
    }
  }

  // Also check for npx commands referencing tools
  const npxPattern = /npx\s+(\S+)/g;
  while ((match = npxPattern.exec(claudeMd)) !== null) {
    const tool = match[1];
    if (seen.has(`npx-${tool}`)) continue;
    seen.add(`npx-${tool}`);
    // npx commands are generally valid, just count them
    valid.push(match[0]);
  }

  // Check make targets
  const makePattern = /make\s+(\S+)/g;
  if (existsSync(join(dir, 'Makefile'))) {
    const makefile = readFileOrNull(join(dir, 'Makefile'));
    const makeTargets = new Set<string>();
    if (makefile) {
      for (const line of makefile.split('\n')) {
        const targetMatch = line.match(/^([a-zA-Z_-]+)\s*:/);
        if (targetMatch) makeTargets.add(targetMatch[1]);
      }
    }

    while ((match = makePattern.exec(claudeMd)) !== null) {
      const target = match[1];
      if (seen.has(`make-${target}`)) continue;
      seen.add(`make-${target}`);

      if (makeTargets.has(target)) {
        valid.push(match[0]);
      } else {
        invalid.push(`${match[0]} (no "${target}" target in Makefile)`);
      }
    }
  }

  return { valid, invalid, total: valid.length + invalid.length };
}

/** Check if file paths mentioned in CLAUDE.md actually exist. */
function validateDocumentedPaths(dir: string): {
  valid: string[];
  invalid: string[];
  total: number;
} {
  const claudeMd = readFileOrNull(join(dir, 'CLAUDE.md'));
  if (!claudeMd) return { valid: [], invalid: [], total: 0 };

  const valid: string[] = [];
  const invalid: string[] = [];

  // Match file paths that look like src/..., lib/..., app/..., etc.
  // Be conservative: only match paths that look like real file references
  const pathPattern = /(?:^|\s|`|"|')((src|lib|app|apps|packages|cmd|internal|test|tests|scripts|config|public|pages|components|routes|services|middleware|utils|helpers)\/[a-zA-Z0-9_./-]+\.[a-zA-Z]{1,5})/gm;

  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pathPattern.exec(claudeMd)) !== null) {
    const filePath = match[1];
    if (seen.has(filePath)) continue;
    seen.add(filePath);

    // Skip obvious example/placeholder paths
    if (/\/path\/to\/|\/example[s]?\/|\/your[_-]|\/foo\/|\/bar\//.test(filePath)) continue;

    if (existsSync(join(dir, filePath))) {
      valid.push(filePath);
    } else {
      invalid.push(filePath);
    }
  }

  return { valid, invalid, total: valid.length + invalid.length };
}

/** Detect config drift: source files changed more recently than config files. */
function detectConfigDrift(dir: string): {
  driftDays: number;
  srcLastModified: Date | null;
  configLastModified: Date | null;
} {
  const srcDirs = ['src', 'lib', 'app', 'cmd', 'internal', 'pages', 'components'];
  let latestSrcMtime = 0;

  for (const srcDir of srcDirs) {
    const fullPath = join(dir, srcDir);
    if (!existsSync(fullPath)) continue;

    try {
      const files = readdirSync(fullPath, { recursive: true })
        .map(String)
        .filter(f => /\.(ts|js|tsx|jsx|py|go|rs|java|rb)$/.test(f));

      for (const file of files.slice(0, 100)) { // sample up to 100 files
        try {
          const stat = statSync(join(fullPath, file));
          if (stat.mtime.getTime() > latestSrcMtime) {
            latestSrcMtime = stat.mtime.getTime();
          }
        } catch { /* skip */ }
      }
    } catch { /* dir doesn't exist */ }
  }

  const configFiles = ['CLAUDE.md', '.cursorrules'];
  let latestConfigMtime = 0;

  for (const configFile of configFiles) {
    try {
      const stat = statSync(join(dir, configFile));
      if (stat.mtime.getTime() > latestConfigMtime) {
        latestConfigMtime = stat.mtime.getTime();
      }
    } catch { /* file doesn't exist */ }
  }

  if (latestSrcMtime === 0 || latestConfigMtime === 0) {
    return { driftDays: 0, srcLastModified: null, configLastModified: null };
  }

  const driftMs = latestSrcMtime - latestConfigMtime;
  const driftDays = Math.max(0, Math.floor(driftMs / (1000 * 60 * 60 * 24)));

  return {
    driftDays,
    srcLastModified: new Date(latestSrcMtime),
    configLastModified: new Date(latestConfigMtime),
  };
}

export function checkAccuracy(dir: string): Check[] {
  const checks: Check[] = [];

  // 1. Documented commands are valid
  const cmds = validateDocumentedCommands(dir);
  const cmdRatio = cmds.total > 0 ? cmds.valid.length / cmds.total : 1;
  const cmdPoints = cmds.total === 0
    ? POINTS_COMMANDS_VALID
    : Math.round(cmdRatio * POINTS_COMMANDS_VALID);

  checks.push({
    id: 'commands_valid',
    name: 'Documented commands exist',
    category: 'accuracy',
    maxPoints: POINTS_COMMANDS_VALID,
    earnedPoints: cmdPoints,
    passed: cmdRatio >= 0.8,
    detail: cmds.total === 0
      ? 'No commands documented'
      : `${cmds.valid.length}/${cmds.total} commands verified`,
    suggestion: cmds.invalid.length > 0
      ? `Remove these invalid commands from CLAUDE.md: ${cmds.invalid.join('; ')}`
      : undefined,
  });

  // 2. Documented file paths exist
  const paths = validateDocumentedPaths(dir);
  const pathRatio = paths.total > 0 ? paths.valid.length / paths.total : 1;
  const pathPoints = paths.total === 0
    ? POINTS_PATHS_VALID
    : Math.round(pathRatio * POINTS_PATHS_VALID);

  checks.push({
    id: 'paths_valid',
    name: 'Documented paths exist',
    category: 'accuracy',
    maxPoints: POINTS_PATHS_VALID,
    earnedPoints: pathPoints,
    passed: pathRatio >= 0.8,
    detail: paths.total === 0
      ? 'No file paths documented'
      : `${paths.valid.length}/${paths.total} paths verified`,
    suggestion: paths.invalid.length > 0
      ? `Remove these non-existent paths from CLAUDE.md: ${paths.invalid.join('; ')}`
      : undefined,
  });

  // 3. Config drift — has code changed without config update?
  const drift = detectConfigDrift(dir);
  let driftPoints = POINTS_CONFIG_DRIFT;
  if (drift.driftDays > 30) driftPoints = 0;
  else if (drift.driftDays > 14) driftPoints = Math.round(POINTS_CONFIG_DRIFT * 0.25);
  else if (drift.driftDays > 7) driftPoints = Math.round(POINTS_CONFIG_DRIFT * 0.5);
  else if (drift.driftDays > 3) driftPoints = Math.round(POINTS_CONFIG_DRIFT * 0.75);

  checks.push({
    id: 'config_drift',
    name: 'Config freshness vs code',
    category: 'accuracy',
    maxPoints: POINTS_CONFIG_DRIFT,
    earnedPoints: driftPoints,
    passed: drift.driftDays <= 7,
    detail: drift.srcLastModified && drift.configLastModified
      ? drift.driftDays === 0
        ? 'Config is up to date with code changes'
        : `Code changed ${drift.driftDays} day${drift.driftDays === 1 ? '' : 's'} after last config update`
      : 'Could not determine drift',
    suggestion: drift.driftDays > 7
      ? `Code has changed since last config update — run \`caliber refresh\` to sync`
      : undefined,
  });

  return checks;
}
