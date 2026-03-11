import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initCommand } from './commands/init.js';
import { undoCommand } from './commands/undo.js';
import { statusCommand } from './commands/status.js';
import { regenerateCommand } from './commands/regenerate.js';
import { recommendCommand } from './commands/recommend.js';
import { scoreCommand } from './commands/score.js';
import { refreshCommand } from './commands/refresh.js';
import { hooksInstallCommand, hooksRemoveCommand, hooksStatusCommand } from './commands/hooks.js';
import { configCommand } from './commands/config.js';
import {
  learnObserveCommand,
  learnFinalizeCommand,
  learnInstallCommand,
  learnRemoveCommand,
  learnStatusCommand,
} from './commands/learn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

const displayVersion = process.env.CALIBER_LOCAL ? `${pkg.version}-local` : pkg.version;

program
  .name(process.env.CALIBER_LOCAL ? 'caloc' : 'caliber')
  .description('Configure your coding agent environment')
  .version(displayVersion);

program
  .command('init')
  .description('Initialize coding agent setup for this project')
  .option('--agent <type>', 'Target agent: claude, cursor, or both')
  .option('--dry-run', 'Preview changes without writing files')
  .option('--force', 'Overwrite existing setup without prompting')
  .action(initCommand);

program
  .command('undo')
  .description('Revert all config changes made by Caliber')
  .action(undoCommand);

program
  .command('status')
  .description('Show current Caliber setup status')
  .option('--json', 'Output as JSON')
  .action(statusCommand);

program
  .command('regenerate')
  .alias('regen')
  .alias('re')
  .alias('update')
  .description('Re-analyze project and regenerate setup')
  .option('--dry-run', 'Preview changes without writing files')
  .action(regenerateCommand);

program
  .command('config')
  .description('Configure LLM provider, API key, and model')
  .action(configCommand);

program
  .command('recommend')
  .description('Discover and install skill recommendations')
  .option('--generate', 'Force fresh recommendation search')
  .action(recommendCommand);

program
  .command('score')
  .description('Score your current agent config setup (deterministic, no network)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'One-line output for scripts/hooks')
  .option('--agent <type>', 'Target agent: claude, cursor, or both')
  .action(scoreCommand);

program
  .command('refresh')
  .description('Update docs based on recent code changes')
  .option('--quiet', 'Suppress output (for use in hooks)')
  .option('--dry-run', 'Preview changes without writing files')
  .action(refreshCommand);

const hooks = program
  .command('hooks')
  .description('Manage Claude Code session hooks');

hooks
  .command('install')
  .description('Install auto-refresh SessionEnd hook')
  .action(hooksInstallCommand);

hooks
  .command('remove')
  .description('Remove auto-refresh SessionEnd hook')
  .action(hooksRemoveCommand);

hooks
  .command('status')
  .description('Check if auto-refresh hook is installed')
  .action(hooksStatusCommand);

const learn = program
  .command('learn')
  .description('Session learning — observe tool usage and extract reusable instructions');

learn
  .command('observe')
  .description('Record a tool event from stdin (called by hooks)')
  .option('--failure', 'Mark event as a tool failure')
  .action(learnObserveCommand);

learn
  .command('finalize')
  .description('Analyze session events and update CLAUDE.md (called on SessionEnd)')
  .action(learnFinalizeCommand);

learn
  .command('install')
  .description('Install learning hooks into .claude/settings.json')
  .action(learnInstallCommand);

learn
  .command('remove')
  .description('Remove learning hooks from .claude/settings.json')
  .action(learnRemoveCommand);

learn
  .command('status')
  .description('Show learning system status')
  .action(learnStatusCommand);

export { program };
