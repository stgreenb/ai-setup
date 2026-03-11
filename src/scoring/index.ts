import { existsSync } from 'fs';
import { join } from 'path';
import { checkExistence } from './checks/existence.js';
import { checkQuality } from './checks/quality.js';
import { checkCoverage } from './checks/coverage.js';
import { checkAccuracy } from './checks/accuracy.js';
import { checkFreshness } from './checks/freshness.js';
import { checkBonus } from './checks/bonus.js';
import { computeGrade, CURSOR_ONLY_CHECKS, CLAUDE_ONLY_CHECKS, BOTH_ONLY_CHECKS } from './constants.js';

export type TargetAgent = 'claude' | 'cursor' | 'both';
export type CheckCategory = 'existence' | 'quality' | 'coverage' | 'accuracy' | 'freshness' | 'bonus';

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly category: CheckCategory;
  readonly maxPoints: number;
  readonly earnedPoints: number;
  readonly passed: boolean;
  readonly detail: string;
  readonly suggestion?: string;
}

export interface CategorySummary {
  readonly earned: number;
  readonly max: number;
}

export interface ScoreResult {
  readonly score: number;
  readonly maxScore: number;
  readonly grade: string;
  readonly checks: readonly Check[];
  readonly categories: {
    readonly existence: CategorySummary;
    readonly quality: CategorySummary;
    readonly coverage: CategorySummary;
    readonly accuracy: CategorySummary;
    readonly freshness: CategorySummary;
    readonly bonus: CategorySummary;
  };
  readonly targetAgent: TargetAgent;
  readonly timestamp: string;
}

function sumCategory(checks: readonly Check[], category: CheckCategory): CategorySummary {
  const categoryChecks = checks.filter((c) => c.category === category);
  return {
    earned: categoryChecks.reduce((s, c) => s + c.earnedPoints, 0),
    max: categoryChecks.reduce((s, c) => s + c.maxPoints, 0),
  };
}

function filterChecksForTarget(checks: Check[], target: TargetAgent): Check[] {
  return checks.filter((c) => {
    if (target === 'claude') {
      return !CURSOR_ONLY_CHECKS.has(c.id) && !BOTH_ONLY_CHECKS.has(c.id);
    }
    if (target === 'cursor') {
      return !CLAUDE_ONLY_CHECKS.has(c.id) && !BOTH_ONLY_CHECKS.has(c.id);
    }
    return true; // 'both' — keep all checks
  });
}

/** Auto-detect target agent from existing config files on disk. */
export function detectTargetAgent(dir: string): TargetAgent {
  const hasClaude = existsSync(join(dir, 'CLAUDE.md')) || existsSync(join(dir, '.claude', 'skills'));
  const hasCursor = existsSync(join(dir, '.cursorrules')) || existsSync(join(dir, '.cursor', 'rules'));

  if (hasClaude && hasCursor) return 'both';
  if (hasCursor) return 'cursor';
  return 'claude'; // default to claude
}

/**
 * Compute a fully deterministic local score for the agent config in `dir`.
 * No network calls, no LLM — pure filesystem checks.
 *
 * When `targetAgent` is provided, only checks relevant to that platform
 * are included and the score is normalized to 0-100.
 */
export function computeLocalScore(dir: string, targetAgent?: TargetAgent): ScoreResult {
  const target = targetAgent ?? detectTargetAgent(dir);

  const allChecks: Check[] = [
    ...checkExistence(dir),
    ...checkQuality(dir),
    ...checkCoverage(dir),
    ...checkAccuracy(dir),
    ...checkFreshness(dir),
    ...checkBonus(dir),
  ];

  const checks = filterChecksForTarget(allChecks, target);
  const maxPossible = checks.reduce((s, c) => s + c.maxPoints, 0);
  const earned = checks.reduce((s, c) => s + c.earnedPoints, 0);

  const score = maxPossible > 0
    ? Math.min(100, Math.max(0, Math.round((earned / maxPossible) * 100)))
    : 0;

  return {
    score,
    maxScore: 100,
    grade: computeGrade(score),
    checks,
    categories: {
      existence: sumCategory(checks, 'existence'),
      quality: sumCategory(checks, 'quality'),
      coverage: sumCategory(checks, 'coverage'),
      accuracy: sumCategory(checks, 'accuracy'),
      freshness: sumCategory(checks, 'freshness'),
      bonus: sumCategory(checks, 'bonus'),
    },
    targetAgent: target,
    timestamp: new Date().toISOString(),
  };
}
