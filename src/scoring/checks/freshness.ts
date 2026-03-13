import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { Check } from '../index.js';
import {
  POINTS_FRESHNESS,
  POINTS_NO_SECRETS,
  POINTS_PERMISSIONS,
  FRESHNESS_THRESHOLDS,
  SECRET_PATTERNS,
} from '../constants.js';

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function daysSinceModified(filePath: string): number | null {
  try {
    const stat = statSync(filePath);
    const now = Date.now();
    const mtime = stat.mtime.getTime();
    return Math.floor((now - mtime) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

export function checkFreshness(dir: string): Check[] {
  const checks: Check[] = [];

  // 1. Instructions file freshness (CLAUDE.md or AGENTS.md)
  const claudeMdPath = join(dir, 'CLAUDE.md');
  const agentsMdPath = join(dir, 'AGENTS.md');
  const primaryPath = existsSync(claudeMdPath) ? claudeMdPath : agentsMdPath;
  const primaryName = existsSync(claudeMdPath) ? 'CLAUDE.md' : 'AGENTS.md';
  const daysOld = daysSinceModified(primaryPath);
  let freshnessPoints = 0;
  let freshnessDetail = '';

  if (daysOld === null) {
    freshnessDetail = 'No instructions file to check';
  } else {
    const threshold = FRESHNESS_THRESHOLDS.find((t) => daysOld <= t.maxDaysOld);
    freshnessPoints = threshold ? threshold.points : 0;
    freshnessDetail =
      daysOld === 0
        ? 'Modified today'
        : daysOld === 1
          ? 'Modified yesterday'
          : `Modified ${daysOld} days ago`;
  }

  checks.push({
    id: 'claude_md_freshness',
    name: `${primaryName} freshness`,
    category: 'freshness',
    maxPoints: POINTS_FRESHNESS,
    earnedPoints: freshnessPoints,
    passed: freshnessPoints >= 4,
    detail: freshnessDetail,
    suggestion:
      daysOld !== null && freshnessPoints < 4
        ? `${primaryName} is ${daysOld} days old — run \`caliber refresh\` to update it`
        : undefined,
  });

  // 2. No secrets in config files
  const filesToScan = [
    'CLAUDE.md',
    'AGENTS.md',
    '.cursorrules',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.mcp.json',
    '.cursor/mcp.json',
  ];

  const secretFindings: Array<{ file: string; line: number; pattern: string }> = [];

  for (const rel of filesToScan) {
    const content = readFileOrNull(join(dir, rel));
    if (!content) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.test(lines[i])) {
          // Don't include the actual secret in the output
          secretFindings.push({
            file: rel,
            line: i + 1,
            pattern: pattern.source.slice(0, 20) + '...',
          });
          break;
        }
      }
    }
  }

  const hasSecrets = secretFindings.length > 0;
  checks.push({
    id: 'no_secrets',
    name: 'No secrets in config files',
    category: 'freshness',
    maxPoints: POINTS_NO_SECRETS,
    // This is a penalty: -8 if secrets found, +8 if clean
    earnedPoints: hasSecrets ? -POINTS_NO_SECRETS : POINTS_NO_SECRETS,
    passed: !hasSecrets,
    detail: hasSecrets
      ? `${secretFindings.length} potential secret${secretFindings.length === 1 ? '' : 's'} found in ${secretFindings[0].file}:${secretFindings[0].line}`
      : 'No secrets detected',
    suggestion: hasSecrets
      ? `Remove secrets from ${secretFindings[0].file}:${secretFindings[0].line} — use environment variables instead`
      : undefined,
  });

  // 3. Settings permissions configured
  const settingsPath = join(dir, '.claude', 'settings.json');
  let hasPermissions = false;
  let permissionDetail = '';

  const settingsContent = readFileOrNull(settingsPath);
  if (settingsContent) {
    try {
      const settings = JSON.parse(settingsContent) as Record<string, unknown>;
      const permissions = settings.permissions as Record<string, unknown> | undefined;
      const allowList = permissions?.allow as unknown[] | undefined;
      hasPermissions = Array.isArray(allowList) && allowList.length > 0;
      permissionDetail = hasPermissions
        ? `${allowList!.length} permission${allowList!.length === 1 ? '' : 's'} configured`
        : 'permissions.allow is empty or missing';
    } catch {
      permissionDetail = 'settings.json is not valid JSON';
    }
  } else {
    permissionDetail = 'No .claude/settings.json';
  }

  checks.push({
    id: 'permissions_configured',
    name: 'Permissions configured',
    category: 'freshness',
    maxPoints: POINTS_PERMISSIONS,
    earnedPoints: hasPermissions ? POINTS_PERMISSIONS : 0,
    passed: hasPermissions,
    detail: permissionDetail,
    suggestion: hasPermissions
      ? undefined
      : 'Add permissions.allow to .claude/settings.json for safer agent execution',
  });

  return checks;
}
