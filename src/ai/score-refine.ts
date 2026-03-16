import { existsSync } from 'fs';
import ora from 'ora';
import {
  validateFileReferences,
  estimateTokens,
  analyzeMarkdownStructure,
  countConcreteness,
  countTreeLines,
} from '../scoring/utils.js';
import {
  TOKEN_BUDGET_THRESHOLDS,
  CODE_BLOCK_THRESHOLDS,
  CONCRETENESS_THRESHOLDS,
  POINTS_REFERENCES_VALID,
  POINTS_NO_DIR_TREE,
  POINTS_HAS_STRUCTURE,
} from '../scoring/constants.js';
import { llmCall } from '../llm/index.js';
import { stripMarkdownFences } from '../llm/utils.js';

const MAX_REFINE_ITERATIONS = 2;

export interface ScoringIssue {
  readonly check: string;
  readonly detail: string;
  readonly fixInstruction: string;
  readonly pointsLost: number;
}

interface ScoreRefineCallbacks {
  onStatus?: (message: string) => void;
}

function extractConfigContent(setup: Record<string, unknown>): { claudeMd: string | null; agentsMd: string | null } {
  const claude = setup.claude as Record<string, unknown> | undefined;
  const codex = setup.codex as Record<string, unknown> | undefined;
  return {
    claudeMd: (claude?.claudeMd as string) ?? null,
    agentsMd: (codex?.agentsMd as string) ?? null,
  };
}

export function validateSetup(
  setup: Record<string, unknown>,
  dir: string,
  checkExists: (path: string) => boolean = existsSync,
): ScoringIssue[] {
  const issues: ScoringIssue[] = [];
  const { claudeMd, agentsMd } = extractConfigContent(setup);
  const primaryContent = [claudeMd, agentsMd].filter(Boolean).join('\n');

  if (!primaryContent) return issues;

  // 1. References valid
  const refs = validateFileReferences(primaryContent, dir, checkExists);
  if (refs.invalid.length > 0 && refs.total > 0) {
    const ratio = refs.valid.length / refs.total;
    const earnedPoints = Math.round(ratio * POINTS_REFERENCES_VALID);
    const lost = POINTS_REFERENCES_VALID - earnedPoints;
    if (lost > 0) {
      issues.push({
        check: 'References valid',
        detail: `${refs.valid.length}/${refs.total} references verified, ${refs.invalid.length} invalid`,
        fixInstruction: `Remove these non-existent paths from the config: ${refs.invalid.map(r => `\`${r}\``).join(', ')}. Do NOT guess replacements — just delete them.`,
        pointsLost: lost,
      });
    }
  }

  // 2. Token budget
  const totalTokens = estimateTokens(primaryContent);
  const tokenThreshold = TOKEN_BUDGET_THRESHOLDS.find(t => totalTokens <= t.maxTokens);
  const tokenPoints = tokenThreshold?.points ?? 0;
  const maxTokenPoints = TOKEN_BUDGET_THRESHOLDS[0].points;
  if (tokenPoints < maxTokenPoints) {
    issues.push({
      check: 'Token budget',
      detail: `~${totalTokens} tokens (target: ≤${TOKEN_BUDGET_THRESHOLDS[0].maxTokens} for full points)`,
      fixInstruction: `Config is ~${totalTokens} tokens. Remove the least important lines to get under ${TOKEN_BUDGET_THRESHOLDS[0].maxTokens} tokens. Prioritize removing verbose prose over code blocks or path references.`,
      pointsLost: maxTokenPoints - tokenPoints,
    });
  }

  // 3. Code blocks
  const content = claudeMd ?? agentsMd ?? '';
  if (content) {
    const structure = analyzeMarkdownStructure(content);
    const blockThreshold = CODE_BLOCK_THRESHOLDS.find(t => structure.codeBlockCount >= t.minBlocks);
    const blockPoints = blockThreshold?.points ?? 0;
    const maxBlockPoints = CODE_BLOCK_THRESHOLDS[0].points;
    if (blockPoints < maxBlockPoints && structure.codeBlockCount < CODE_BLOCK_THRESHOLDS[0].minBlocks) {
      issues.push({
        check: 'Executable content',
        detail: `${structure.codeBlockCount} code block${structure.codeBlockCount === 1 ? '' : 's'} (need ≥${CODE_BLOCK_THRESHOLDS[0].minBlocks} for full points)`,
        fixInstruction: `Add ${CODE_BLOCK_THRESHOLDS[0].minBlocks - structure.codeBlockCount} more code blocks with actual project commands (build, test, lint, deploy).`,
        pointsLost: maxBlockPoints - blockPoints,
      });
    }

    // 4. Concreteness
    const { concrete: concreteCount, abstract: abstractCount } = countConcreteness(content);
    const totalMeaningful = concreteCount + abstractCount;
    const concreteRatio = totalMeaningful > 0 ? concreteCount / totalMeaningful : 1;
    const concThreshold = CONCRETENESS_THRESHOLDS.find(t => concreteRatio >= t.minRatio);
    const concPoints = totalMeaningful === 0 ? 0 : concThreshold?.points ?? 0;
    const maxConcPoints = CONCRETENESS_THRESHOLDS[0].points;
    if (concPoints < maxConcPoints && totalMeaningful > 0 && concreteRatio < CONCRETENESS_THRESHOLDS[0].minRatio) {
      issues.push({
        check: 'Concrete instructions',
        detail: `${Math.round(concreteRatio * 100)}% concrete (need ≥${Math.round(CONCRETENESS_THRESHOLDS[0].minRatio * 100)}%)`,
        fixInstruction: `${abstractCount} lines are generic prose. Replace vague instructions with specific ones that reference project files, paths, or commands in backticks.`,
        pointsLost: maxConcPoints - concPoints,
      });
    }

    // 5. Directory trees
    const treeLineCount = countTreeLines(content);
    if (treeLineCount > 10) {
      issues.push({
        check: 'No directory tree listings',
        detail: `${treeLineCount}-line directory tree found in code blocks`,
        fixInstruction: 'Remove directory tree listings from code blocks. Reference key directories inline with backticks instead.',
        pointsLost: POINTS_NO_DIR_TREE,
      });
    }

    // 6. Structure
    if (structure.h2Count < 3 || structure.listItemCount < 3) {
      const parts: string[] = [];
      if (structure.h2Count < 3) parts.push(`add ${3 - structure.h2Count} more ## sections`);
      if (structure.listItemCount < 3) parts.push('use bullet lists for multi-item instructions');
      issues.push({
        check: 'Structured with headings',
        detail: `${structure.h2Count} sections, ${structure.listItemCount} list items`,
        fixInstruction: `Improve structure: ${parts.join(' and ')}.`,
        pointsLost: POINTS_HAS_STRUCTURE - ((structure.h2Count >= 3 ? 1 : 0) + (structure.listItemCount >= 3 ? 1 : 0)),
      });
    }
  }

  return issues.sort((a, b) => b.pointsLost - a.pointsLost);
}

function buildFeedbackMessage(issues: ScoringIssue[]): string {
  const lines: string[] = [
    'Fix ONLY these scoring issues — do not rewrite, restructure, or make cosmetic changes:\n',
  ];

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    lines.push(`${i + 1}. ${issue.check.toUpperCase()} (-${issue.pointsLost} pts): ${issue.detail}`);
    lines.push(`   Action: ${issue.fixInstruction}\n`);
  }

  return lines.join('\n');
}

function countIssuePoints(issues: ScoringIssue[]): number {
  return issues.reduce((sum, i) => sum + i.pointsLost, 0);
}

export async function scoreAndRefine(
  setup: Record<string, unknown>,
  dir: string,
  sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  callbacks?: ScoreRefineCallbacks,
): Promise<Record<string, unknown>> {
  const existsCache = new Map<string, boolean>();
  const cachedExists = (path: string): boolean => {
    const cached = existsCache.get(path);
    if (cached !== undefined) return cached;
    const result = existsSync(path);
    existsCache.set(path, result);
    return result;
  };

  let currentSetup = setup;
  let bestSetup = setup;
  let bestLostPoints = Infinity;

  for (let iteration = 0; iteration < MAX_REFINE_ITERATIONS; iteration++) {
    const issues = validateSetup(currentSetup, dir, cachedExists);
    const lostPoints = countIssuePoints(issues);

    if (lostPoints < bestLostPoints) {
      bestSetup = currentSetup;
      bestLostPoints = lostPoints;
    }

    if (issues.length === 0) {
      if (callbacks?.onStatus) callbacks.onStatus('Setup passes all scoring checks');
      return bestSetup;
    }

    if (callbacks?.onStatus) {
      const issueNames = issues.map(i => i.check).join(', ');
      callbacks.onStatus(`Fixing ${issues.length} scoring issue${issues.length === 1 ? '' : 's'}: ${issueNames}...`);
    }

    const refined = await applyTargetedFixes(currentSetup, issues);

    if (!refined) {
      if (callbacks?.onStatus) callbacks.onStatus('Refinement failed, keeping current setup');
      return bestSetup;
    }

    sessionHistory.push({
      role: 'user',
      content: `Fix scoring issues: ${issues.map(i => i.check).join(', ')}`,
    });
    sessionHistory.push({
      role: 'assistant',
      content: `Applied scoring fixes for: ${issues.map(i => i.check).join(', ')}`,
    });

    currentSetup = refined;
  }

  // Final check after last iteration
  const finalIssues = validateSetup(currentSetup, dir, cachedExists);
  const finalLostPoints = countIssuePoints(finalIssues);
  if (finalLostPoints < bestLostPoints) {
    bestSetup = currentSetup;
  }

  return bestSetup;
}

async function applyTargetedFixes(
  setup: Record<string, unknown>,
  issues: ScoringIssue[],
): Promise<Record<string, unknown> | null> {
  const { claudeMd, agentsMd } = extractConfigContent(setup);

  const targets: { key: 'claudeMd' | 'agentsMd'; label: string; content: string }[] = [];
  if (claudeMd) targets.push({ key: 'claudeMd', label: 'CLAUDE.md', content: claudeMd });
  if (agentsMd) targets.push({ key: 'agentsMd', label: 'AGENTS.md', content: agentsMd });
  if (targets.length === 0) return null;

  const feedbackMessage = buildFeedbackMessage(issues);

  const contentBlock = targets.map(t =>
    `### ${t.label}\n\`\`\`markdown\n${t.content}\n\`\`\``
  ).join('\n\n');

  const prompt = [
    'Here are the config files with scoring issues:\n',
    contentBlock,
    '\n',
    feedbackMessage,
    `\nReturn ONLY the fixed content as a JSON object with keys ${targets.map(t => `"${t.key}"`).join(', ')}. Each value is the fixed markdown string. No code fences, no explanations.`,
  ].join('\n');

  try {
    const raw = await llmCall({
      system: 'You fix scoring issues in AI agent configuration files. Return only a JSON object with the fixed content — no explanations, no code fences.',
      prompt,
      maxTokens: 8000,
    });

    const cleaned = stripMarkdownFences(raw);
    const jsonStart = cleaned.indexOf('{');
    const jsonToParse = jsonStart !== -1 ? cleaned.slice(jsonStart) : cleaned;
    const fixes = JSON.parse(jsonToParse) as Record<string, string>;

    const patched = structuredClone(setup);
    for (const target of targets) {
      if (typeof fixes[target.key] === 'string' && fixes[target.key].length > 50) {
        const parent = target.key === 'claudeMd'
          ? (patched.claude as Record<string, unknown>)
          : (patched.codex as Record<string, unknown>);
        if (parent) parent[target.key] = fixes[target.key];
      }
    }

    return patched;
  } catch {
    return null;
  }
}

export async function runScoreRefineWithSpinner(
  setup: Record<string, unknown>,
  dir: string,
  sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<Record<string, unknown>> {
  const spinner = ora('Validating setup against scoring criteria...').start();
  try {
    const refined = await scoreAndRefine(setup, dir, sessionHistory, {
      onStatus: (msg) => { spinner.text = msg; },
    });
    if (refined !== setup) {
      spinner.succeed('Setup refined based on scoring feedback');
    } else {
      spinner.succeed('Setup passes scoring validation');
    }
    return refined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    spinner.warn(`Scoring validation skipped: ${msg}`);
    return setup;
  }
}
