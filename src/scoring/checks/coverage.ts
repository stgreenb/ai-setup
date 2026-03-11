import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Check } from '../index.js';
import {
  POINTS_DEP_COVERAGE,
  POINTS_SERVICE_COVERAGE,
  POINTS_MCP_COVERAGE,
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

/** Extract major dependencies from package.json (top 15 non-trivial deps). */
function extractNpmDeps(dir: string): string[] {
  const pkg = readJsonOrNull(join(dir, 'package.json'));
  if (!pkg) return [];

  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  // Filter out trivial/meta packages
  const trivial = new Set([
    'typescript', '@types/node', 'tslib', 'ts-node', 'tsx',
    'prettier', 'eslint', '@eslint/js',
    'rimraf', 'cross-env', 'dotenv', 'nodemon',
  ]);

  return Object.keys(deps)
    .filter(d => !trivial.has(d) && !d.startsWith('@types/'))
    .slice(0, 30);
}

/** Extract dependencies from pyproject.toml or requirements.txt. */
function extractPythonDeps(dir: string): string[] {
  // Try requirements.txt first
  const reqTxt = readFileOrNull(join(dir, 'requirements.txt'));
  if (reqTxt) {
    return reqTxt
      .split('\n')
      .map(l => l.trim().split(/[=<>!~\[]/)[0].trim())
      .filter(l => l && !l.startsWith('#'))
      .slice(0, 30);
  }

  // Try pyproject.toml
  const pyproject = readFileOrNull(join(dir, 'pyproject.toml'));
  if (pyproject) {
    const depMatch = pyproject.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depMatch) {
      return depMatch[1]
        .split('\n')
        .map(l => l.trim().replace(/["',]/g, '').split(/[=<>!~\[]/)[0].trim())
        .filter(l => l.length > 0)
        .slice(0, 30);
    }
  }

  return [];
}

/** Extract dependencies from go.mod. */
function extractGoDeps(dir: string): string[] {
  const goMod = readFileOrNull(join(dir, 'go.mod'));
  if (!goMod) return [];

  const requireBlock = goMod.match(/require\s*\(([\s\S]*?)\)/);
  if (!requireBlock) return [];

  return requireBlock[1]
    .split('\n')
    .map(l => l.trim().split(/\s/)[0])
    .filter(l => l && !l.startsWith('//'))
    .map(l => l.split('/').pop() || l) // use last segment as name
    .slice(0, 30);
}

/** Extract dependencies from Cargo.toml. */
function extractRustDeps(dir: string): string[] {
  const cargo = readFileOrNull(join(dir, 'Cargo.toml'));
  if (!cargo) return [];

  const depSection = cargo.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
  if (!depSection) return [];

  return depSection[1]
    .split('\n')
    .map(l => l.trim().split(/\s*=/)[0].trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
    .slice(0, 30);
}

/** Collect all config content (CLAUDE.md, skills, cursor rules, etc.). */
function collectAllConfigContent(dir: string): string {
  const parts: string[] = [];

  const claudeMd = readFileOrNull(join(dir, 'CLAUDE.md'));
  if (claudeMd) parts.push(claudeMd);

  const cursorrules = readFileOrNull(join(dir, '.cursorrules'));
  if (cursorrules) parts.push(cursorrules);

  // Read all skills
  for (const skillsDir of [join(dir, '.claude', 'skills'), join(dir, '.cursor', 'skills')]) {
    try {
      const entries = readdirSync(skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skill = readFileOrNull(join(skillsDir, entry.name, 'SKILL.md'));
          if (skill) parts.push(skill);
        }
      }
    } catch { /* dir doesn't exist */ }
  }

  // Read cursor .mdc rules
  try {
    const rulesDir = join(dir, '.cursor', 'rules');
    const mdcFiles = readdirSync(rulesDir).filter(f => f.endsWith('.mdc'));
    for (const f of mdcFiles) {
      const content = readFileOrNull(join(rulesDir, f));
      if (content) parts.push(content);
    }
  } catch { /* dir doesn't exist */ }

  return parts.join('\n').toLowerCase();
}

/** Check if the project has any external services detected from dependencies. */
export function hasExternalServices(dir: string): boolean {
  const allDeps = [
    ...extractNpmDeps(dir),
    ...extractPythonDeps(dir),
    ...extractGoDeps(dir),
    ...extractRustDeps(dir),
  ];
  return detectServices(dir, allDeps).length > 0;
}

/** Detect services that should have MCP servers. */
function detectServices(dir: string, deps: string[]): string[] {
  const serviceMap: Record<string, string[]> = {
    'postgresql': ['pg', 'postgres', 'knex', 'drizzle-orm', 'prisma', 'sequelize', 'typeorm', 'psycopg2', 'sqlalchemy', 'diesel'],
    'mongodb': ['mongoose', 'mongodb', 'mongod', 'pymongo', 'motor'],
    'redis': ['redis', 'ioredis', 'bull', 'bullmq', 'aioredis'],
    'supabase': ['@supabase/supabase-js', 'supabase', 'supabase-py'],
    'firebase': ['firebase', 'firebase-admin', '@firebase/app'],
    'aws': ['aws-sdk', '@aws-sdk/client-s3', 'boto3', 'aws-cdk'],
    'stripe': ['stripe', '@stripe/stripe-js'],
    'github': ['@octokit/rest', 'octokit', 'pygithub'],
    'slack': ['@slack/web-api', '@slack/bolt', 'slack-sdk'],
    'sentry': ['@sentry/node', '@sentry/react', 'sentry-sdk'],
  };

  const detected: string[] = [];
  const depSet = new Set(deps.map(d => d.toLowerCase()));

  for (const [service, markers] of Object.entries(serviceMap)) {
    if (markers.some(m => depSet.has(m))) {
      detected.push(service);
    }
  }

  return detected;
}

/** Count configured MCP servers. */
function getConfiguredMcpServers(dir: string): Set<string> {
  const servers = new Set<string>();
  const mcpFiles = [
    '.mcp.json',
    '.cursor/mcp.json',
    '.claude/settings.local.json',
    '.claude/settings.json',
  ];

  for (const rel of mcpFiles) {
    try {
      const content = readFileSync(join(dir, rel), 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const mcpServers = parsed.mcpServers as Record<string, unknown> | undefined;
      if (mcpServers) {
        for (const name of Object.keys(mcpServers)) {
          servers.add(name.toLowerCase());
        }
      }
    } catch { /* file doesn't exist or isn't valid JSON */ }
  }

  return servers;
}

export function checkCoverage(dir: string): Check[] {
  const checks: Check[] = [];

  // Collect all dependencies across ecosystems
  const allDeps = [
    ...extractNpmDeps(dir),
    ...extractPythonDeps(dir),
    ...extractGoDeps(dir),
    ...extractRustDeps(dir),
  ];

  const configContent = collectAllConfigContent(dir);

  // 1. Dependency coverage — are major deps mentioned in config?
  const mentionedDeps: string[] = [];
  const unmatchedDeps: string[] = [];

  for (const dep of allDeps) {
    // Normalize: @scope/package -> package, hyphens/underscores interchangeable
    const normalized = dep.replace(/^@[^/]+\//, '').toLowerCase();
    const variants = [
      normalized,
      normalized.replace(/-/g, '_'),
      normalized.replace(/_/g, '-'),
      normalized.replace(/-/g, ''),
    ];

    if (variants.some(v => configContent.includes(v))) {
      mentionedDeps.push(dep);
    } else {
      unmatchedDeps.push(dep);
    }
  }

  const depCoverageRatio = allDeps.length > 0 ? mentionedDeps.length / allDeps.length : 1;
  const effectiveRatio = depCoverageRatio >= 0.85 ? 1 : depCoverageRatio;
  const depPoints = allDeps.length === 0
    ? POINTS_DEP_COVERAGE
    : Math.round(effectiveRatio * POINTS_DEP_COVERAGE);

  const topUnmatched = unmatchedDeps.slice(0, 3);

  checks.push({
    id: 'dep_coverage',
    name: 'Dependency coverage',
    category: 'coverage',
    maxPoints: POINTS_DEP_COVERAGE,
    earnedPoints: depPoints,
    passed: depCoverageRatio >= 0.5,
    detail: allDeps.length === 0
      ? 'No dependencies detected'
      : `${mentionedDeps.length}/${allDeps.length} deps mentioned in configs (${Math.round(depCoverageRatio * 100)}%)`,
    suggestion: topUnmatched.length > 0
      ? `Missing coverage for: ${topUnmatched.join(', ')}${unmatchedDeps.length > 3 ? ` (+${unmatchedDeps.length - 3} more)` : ''}`
      : undefined,
  });

  // 2. Service coverage — do detected services have corresponding MCP servers?
  const detectedServices = detectServices(dir, allDeps);
  const mcpServers = getConfiguredMcpServers(dir);
  const mcpServerNames = Array.from(mcpServers).join(' ');

  const coveredServices: string[] = [];
  const uncoveredServices: string[] = [];

  for (const service of detectedServices) {
    // Check if any MCP server name contains the service name
    if (mcpServerNames.includes(service) || configContent.includes(`${service} mcp`) || configContent.includes(`mcp.*${service}`)) {
      coveredServices.push(service);
    } else {
      uncoveredServices.push(service);
    }
  }

  const serviceCoverageRatio = detectedServices.length > 0
    ? coveredServices.length / detectedServices.length
    : 1;
  const servicePoints = detectedServices.length === 0
    ? POINTS_SERVICE_COVERAGE
    : Math.round(serviceCoverageRatio * POINTS_SERVICE_COVERAGE);

  checks.push({
    id: 'service_coverage',
    name: 'Service/MCP coverage',
    category: 'coverage',
    maxPoints: POINTS_SERVICE_COVERAGE,
    earnedPoints: servicePoints,
    passed: serviceCoverageRatio >= 0.5,
    detail: detectedServices.length === 0
      ? 'No external services detected'
      : `${coveredServices.length}/${detectedServices.length} services have MCP/config coverage`,
    suggestion: uncoveredServices.length > 0
      ? `No MCP server for: ${uncoveredServices.join(', ')} — consider adding MCP servers for these`
      : undefined,
  });

  // 3. MCP completeness — do configured MCPs match what the project actually uses?
  //    Full points if no services detected (MCP not needed) or if MCP servers cover services.
  let mcpPoints: number;
  if (detectedServices.length === 0) {
    mcpPoints = POINTS_MCP_COVERAGE; // no services = MCP not needed
  } else if (mcpServers.size > 0) {
    mcpPoints = Math.round(serviceCoverageRatio * POINTS_MCP_COVERAGE);
  } else {
    mcpPoints = 0;
  }

  checks.push({
    id: 'mcp_completeness',
    name: 'MCP completeness',
    category: 'coverage',
    maxPoints: POINTS_MCP_COVERAGE,
    earnedPoints: mcpPoints,
    passed: mcpPoints >= POINTS_MCP_COVERAGE / 2,
    detail: detectedServices.length === 0
      ? 'No external services detected (MCP not needed)'
      : mcpServers.size === 0
        ? 'No MCP servers configured'
        : `${mcpServers.size} MCP server${mcpServers.size === 1 ? '' : 's'} configured`,
    suggestion: mcpServers.size === 0 && detectedServices.length > 0
      ? `Project uses ${detectedServices.join(', ')} but has no MCP servers`
      : undefined,
  });

  return checks;
}
