import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Check } from '../index.js';
import {
  POINTS_CLAUDE_MD_EXISTS,
  POINTS_CURSOR_RULES_EXIST,
  POINTS_SKILLS_EXIST,
  POINTS_SKILLS_BONUS_PER_EXTRA,
  POINTS_SKILLS_BONUS_CAP,
  POINTS_CURSOR_MDC_RULES,
  POINTS_MCP_SERVERS,
  POINTS_CROSS_PLATFORM_PARITY,
} from '../constants.js';
import { hasExternalServices } from './coverage.js';

function countFiles(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => pattern.test(f));
  } catch {
    return [];
  }
}

function hasMcpServers(dir: string): { count: number; sources: string[] } {
  const sources: string[] = [];
  let count = 0;

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
      const servers = parsed.mcpServers as Record<string, unknown> | undefined;
      if (servers && Object.keys(servers).length > 0) {
        count += Object.keys(servers).length;
        sources.push(rel);
      }
    } catch {
      // file doesn't exist or isn't valid JSON
    }
  }

  return { count, sources };
}

export function checkExistence(dir: string): Check[] {
  const checks: Check[] = [];

  // 1. CLAUDE.md exists
  const claudeMdExists = existsSync(join(dir, 'CLAUDE.md'));
  checks.push({
    id: 'claude_md_exists',
    name: 'CLAUDE.md exists',
    category: 'existence',
    maxPoints: POINTS_CLAUDE_MD_EXISTS,
    earnedPoints: claudeMdExists ? POINTS_CLAUDE_MD_EXISTS : 0,
    passed: claudeMdExists,
    detail: claudeMdExists ? 'Found at project root' : 'Not found',
    suggestion: claudeMdExists ? undefined : 'Create a CLAUDE.md with project context and commands',
  });

  // 2. .cursorrules or .cursor/rules/ exists
  const hasCursorrules = existsSync(join(dir, '.cursorrules'));
  const cursorRulesDir = existsSync(join(dir, '.cursor', 'rules'));
  const cursorRulesExist = hasCursorrules || cursorRulesDir;
  checks.push({
    id: 'cursor_rules_exist',
    name: 'Cursor rules exist',
    category: 'existence',
    maxPoints: POINTS_CURSOR_RULES_EXIST,
    earnedPoints: cursorRulesExist ? POINTS_CURSOR_RULES_EXIST : 0,
    passed: cursorRulesExist,
    detail: hasCursorrules
      ? '.cursorrules found'
      : cursorRulesDir
        ? '.cursor/rules/ found'
        : 'No Cursor rules',
    suggestion: cursorRulesExist
      ? undefined
      : 'Add .cursor/rules/ for Cursor users on your team',
  });

  // 2b. AGENTS.md exists (primary config for Codex)
  const agentsMdExists = existsSync(join(dir, 'AGENTS.md'));
  checks.push({
    id: 'codex_agents_md_exists',
    name: 'AGENTS.md exists',
    category: 'existence',
    maxPoints: POINTS_CLAUDE_MD_EXISTS,
    earnedPoints: agentsMdExists ? POINTS_CLAUDE_MD_EXISTS : 0,
    passed: agentsMdExists,
    detail: agentsMdExists ? 'Found at project root' : 'Not found',
    suggestion: agentsMdExists ? undefined : 'Create AGENTS.md with project context for Codex',
  });

  // 3. Skills exist (.claude/skills/ or .agents/skills/)
  const claudeSkills = countFiles(join(dir, '.claude', 'skills'), /\.(md|SKILL\.md)$/);
  const codexSkills = countFiles(join(dir, '.agents', 'skills'), /SKILL\.md$/);
  const skillCount = claudeSkills.length + codexSkills.length;
  const skillBase = skillCount >= 1 ? POINTS_SKILLS_EXIST : 0;
  const skillBonus = Math.min((skillCount - 1) * POINTS_SKILLS_BONUS_PER_EXTRA, POINTS_SKILLS_BONUS_CAP);
  const skillPoints = skillCount >= 1 ? skillBase + Math.max(0, skillBonus) : 0;
  // Cap at the category allowance for this check
  const maxSkillPoints = POINTS_SKILLS_EXIST + POINTS_SKILLS_BONUS_CAP;
  checks.push({
    id: 'skills_exist',
    name: 'Skills configured',
    category: 'existence',
    maxPoints: maxSkillPoints,
    earnedPoints: Math.min(skillPoints, maxSkillPoints),
    passed: skillCount >= 1,
    detail:
      skillCount === 0
        ? 'No skills found'
        : `${skillCount} skill${skillCount === 1 ? '' : 's'} found`,
    suggestion:
      skillCount === 0
        ? 'Add .claude/skills/ with project-specific workflows'
        : skillCount < 3
          ? 'Optimal is 2-3 focused skills (SkillsBench research)'
          : undefined,
  });

  // 4. Cursor .mdc rules
  const mdcFiles = countFiles(join(dir, '.cursor', 'rules'), /\.mdc$/);
  const mdcCount = mdcFiles.length;
  checks.push({
    id: 'cursor_mdc_rules',
    name: 'Cursor .mdc rules',
    category: 'existence',
    maxPoints: POINTS_CURSOR_MDC_RULES,
    earnedPoints: mdcCount >= 1 ? POINTS_CURSOR_MDC_RULES : 0,
    passed: mdcCount >= 1,
    detail:
      mdcCount === 0
        ? 'No .mdc rule files'
        : `${mdcCount} .mdc rule${mdcCount === 1 ? '' : 's'} found`,
    suggestion:
      mdcCount === 0
        ? 'Add .cursor/rules/*.mdc with frontmatter for Cursor'
        : undefined,
  });

  // 5. MCP servers (only penalize if project has external services)
  const mcp = hasMcpServers(dir);
  const hasServices = hasExternalServices(dir);
  const mcpPassed = mcp.count >= 1 || !hasServices;
  checks.push({
    id: 'mcp_servers',
    name: 'MCP servers configured',
    category: 'existence',
    maxPoints: POINTS_MCP_SERVERS,
    earnedPoints: mcpPassed ? POINTS_MCP_SERVERS : 0,
    passed: mcpPassed,
    detail:
      mcp.count > 0
        ? `${mcp.count} server${mcp.count === 1 ? '' : 's'} in ${mcp.sources.join(', ')}`
        : hasServices
          ? 'No MCP servers (external services detected)'
          : 'No MCP servers needed (no external services detected)',
    suggestion:
      !mcpPassed
        ? 'Configure MCP servers in .mcp.json for detected external services'
        : undefined,
  });

  // 6. Cross-platform parity
  const hasClaudeConfigs = claudeMdExists || skillCount > 0;
  const hasCursorConfigs = cursorRulesExist || mdcCount > 0;
  const hasParity = hasClaudeConfigs && hasCursorConfigs;
  checks.push({
    id: 'cross_platform_parity',
    name: 'Cross-platform parity',
    category: 'existence',
    maxPoints: POINTS_CROSS_PLATFORM_PARITY,
    earnedPoints: hasParity ? POINTS_CROSS_PLATFORM_PARITY : 0,
    passed: hasParity,
    detail: hasParity
      ? 'Both Claude Code and Cursor configured'
      : hasClaudeConfigs
        ? 'Only Claude Code — no Cursor configs'
        : hasCursorConfigs
          ? 'Only Cursor — no Claude Code configs'
          : 'Neither platform configured',
    suggestion: hasParity
      ? undefined
      : 'Add configs for both platforms so all teammates get context',
  });

  return checks;
}
