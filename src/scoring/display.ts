import chalk from 'chalk';
import type { ScoreResult, Check, CheckCategory } from './index.js';

const CATEGORY_LABELS: Record<CheckCategory, string> = {
  existence: 'FILES & SETUP',
  quality: 'QUALITY',
  coverage: 'COVERAGE',
  accuracy: 'ACCURACY',
  freshness: 'FRESHNESS & SAFETY',
  bonus: 'BONUS',
};

const CATEGORY_ORDER: CheckCategory[] = ['existence', 'quality', 'coverage', 'accuracy', 'freshness', 'bonus'];

function gradeColor(grade: string): (text: string) => string {
  switch (grade) {
    case 'A': return chalk.green;
    case 'B': return chalk.greenBright;
    case 'C': return chalk.yellow;
    case 'D': return chalk.hex('#f97316');
    case 'F': return chalk.red;
    default: return chalk.white;
  }
}

function progressBar(score: number, max: number, width = 40): string {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const bar = chalk.hex('#f97316')('▓'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return bar;
}

function formatCheck(check: Check): string {
  const icon = check.passed
    ? chalk.green('✓')
    : check.earnedPoints < 0
      ? chalk.red('✗')
      : chalk.gray('✗');

  const points = check.passed
    ? chalk.green(`+${check.earnedPoints}`.padStart(4))
    : check.earnedPoints < 0
      ? chalk.red(`${check.earnedPoints}`.padStart(4))
      : chalk.gray('  —');

  const name = check.passed
    ? chalk.white(check.name)
    : chalk.gray(check.name);

  const detail = check.detail ? chalk.gray(` (${check.detail})`) : '';
  const suggestion = !check.passed && check.suggestion
    ? chalk.gray(`\n       → ${check.suggestion}`)
    : '';

  return `  ${icon} ${name.padEnd(38)}${points}${detail}${suggestion}`;
}

/**
 * Render the full score breakdown to the terminal.
 */
export function displayScore(result: ScoreResult): void {
  const gc = gradeColor(result.grade);

  const agentLabel = result.targetAgent === 'both'
    ? 'Claude Code + Cursor'
    : result.targetAgent === 'claude'
      ? 'Claude Code'
      : result.targetAgent === 'codex'
        ? 'Codex'
        : 'Cursor';

  // Header box
  console.log('');
  console.log(chalk.gray('  ╭───────────────────────────────────────────────────╮'));
  console.log(chalk.gray('  │') + '                                                   ' + chalk.gray('│'));
  console.log(
    chalk.gray('  │') +
    '   Agent Config Score' +
    gc(`        ${String(result.score).padStart(3)} / ${result.maxScore}`) +
    '    Grade ' + gc(result.grade) +
    '   ' + chalk.gray('│')
  );
  console.log(chalk.gray('  │') + `   ${progressBar(result.score, result.maxScore)}   ` + chalk.gray('│'));
  console.log(chalk.gray('  │') + chalk.dim(`   Target: ${agentLabel}`) + ' '.repeat(Math.max(1, 40 - agentLabel.length)) + chalk.gray('│'));
  console.log(chalk.gray('  │') + '                                                   ' + chalk.gray('│'));
  console.log(chalk.gray('  ╰───────────────────────────────────────────────────╯'));
  console.log('');

  // Category sections
  for (const category of CATEGORY_ORDER) {
    const summary = result.categories[category];
    const categoryChecks = result.checks.filter((c) => c.category === category);

    console.log(
      chalk.gray(`  ${CATEGORY_LABELS[category]}`) +
      chalk.gray(' '.repeat(Math.max(1, 45 - CATEGORY_LABELS[category].length))) +
      chalk.white(`${summary.earned}`) +
      chalk.gray(` / ${summary.max}`)
    );

    for (const check of categoryChecks) {
      console.log(formatCheck(check));
    }
    console.log('');
  }
}

/**
 * Render a compact score summary for init flow — score box + top failing checks.
 */
export function displayScoreSummary(result: ScoreResult): void {
  const gc = gradeColor(result.grade);

  const agentLabel = result.targetAgent === 'both'
    ? 'Claude Code + Cursor'
    : result.targetAgent === 'claude'
      ? 'Claude Code'
      : result.targetAgent === 'codex'
        ? 'Codex'
        : 'Cursor';

  // Compact header
  console.log('');
  console.log(
    chalk.gray('  ') +
    gc(`${result.score}/${result.maxScore}`) +
    chalk.gray(` (Grade ${result.grade})`) +
    chalk.gray(`  ·  ${agentLabel}`) +
    chalk.gray(`  ·  ${progressBar(result.score, result.maxScore, 20)}`)
  );

  // Show failing check names (max 5)
  const failing = result.checks.filter(c => !c.passed);
  if (failing.length > 0) {
    const shown = failing.slice(0, 5);
    for (const check of shown) {
      console.log(chalk.gray(`  ✗ ${check.name}`));
    }
    const remaining = failing.length - shown.length;
    const moreText = remaining > 0 ? ` (+${remaining} more)` : '';
    console.log(chalk.dim(`\n  Run ${chalk.hex('#83D1EB')('caliber score')} for details.${moreText}`));
  }
  console.log('');
}

/**
 * Render a compact before/after comparison.
 */
export function displayScoreDelta(before: ScoreResult, after: ScoreResult): void {
  const delta = after.score - before.score;
  const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
  const deltaColor = delta >= 0 ? chalk.green : chalk.red;
  const beforeGc = gradeColor(before.grade);
  const afterGc = gradeColor(after.grade);

  const BOX_INNER = 51;

  const scorePart = `Score: ${before.score} > ${after.score}`;
  const deltaPart = `${deltaStr} pts`;
  const gradePart = `${before.grade} > ${after.grade}`;
  const contentLen = 3 + scorePart.length + deltaPart.length + gradePart.length + 8;
  const totalPad = BOX_INNER - contentLen;
  const pad1 = Math.max(2, Math.ceil(totalPad / 2));
  const pad2 = Math.max(1, totalPad - pad1);

  const scoreLineFormatted =
    '   Score: ' +
    beforeGc(`${before.score}`) +
    chalk.gray(' \u2192 ') +
    afterGc(`${after.score}`) +
    ' '.repeat(pad1) +
    deltaColor(deltaPart) +
    ' '.repeat(pad2) +
    beforeGc(before.grade) +
    chalk.gray(' \u2192 ') +
    afterGc(after.grade);

  // Pad to exact box width: visible chars = scorePart + pad1 + deltaPart + pad2 + gradePart + 3 leading spaces
  const visibleLen = 3 + scorePart.length + pad1 + deltaPart.length + pad2 + gradePart.length;
  const trailingPad = Math.max(0, BOX_INNER - visibleLen);

  const barWidth = Math.floor((BOX_INNER - 12) / 2);
  const barLine =
    `   ${progressBar(before.score, before.maxScore, barWidth)}` +
    chalk.gray('  \u2192  ') +
    progressBar(after.score, after.maxScore, barWidth) +
    '   ';

  console.log('');
  console.log(chalk.gray('  ╭' + '─'.repeat(BOX_INNER) + '╮'));
  console.log(chalk.gray('  │') + ' '.repeat(BOX_INNER) + chalk.gray('│'));
  console.log(chalk.gray('  │') + scoreLineFormatted + ' '.repeat(trailingPad) + chalk.gray('│'));
  console.log(chalk.gray('  │') + barLine + chalk.gray('│'));
  console.log(chalk.gray('  │') + ' '.repeat(BOX_INNER) + chalk.gray('│'));
  console.log(chalk.gray('  ╰' + '─'.repeat(BOX_INNER) + '╯'));
  console.log('');

  // Show what improved
  const improved = after.checks.filter((ac) => {
    const bc = before.checks.find((b) => b.id === ac.id);
    return bc && ac.earnedPoints > bc.earnedPoints;
  });

  if (improved.length > 0) {
    console.log(chalk.gray('  What improved:'));
    for (const check of improved) {
      const bc = before.checks.find((b) => b.id === check.id)!;
      const gain = check.earnedPoints - bc.earnedPoints;
      console.log(
        chalk.green('  +') +
        chalk.white(` ${check.name.padEnd(50)}`) +
        chalk.green(`+${gain}`)
      );
    }
    console.log('');
  }
}

/**
 * Render a one-line score for git hook output.
 */
export function displayScoreOneLiner(result: ScoreResult, drift?: string): void {
  const gc = gradeColor(result.grade);
  const driftMsg = drift
    ? chalk.yellow(` — ${drift}`)
    : chalk.green(' — no drift detected ✓');

  console.log(
    chalk.gray('  caliber ▸ ') +
    gc(`${result.score}/100 (${result.grade})`) +
    driftMsg
  );
}
