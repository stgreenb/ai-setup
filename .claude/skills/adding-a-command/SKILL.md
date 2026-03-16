---
name: adding-a-command
description: Add a new CLI command to @rely-ai/caliber using Commander.js. Use when creating subcommands in src/commands/, wiring LLM calls via llmCall/llmJsonCall, displaying output with ora spinners and chalk colors, or writing command tests. Trigger phrases: 'add command', 'new command', 'create subcommand'. Do NOT use for modifying scoring checks or fingerprinting logic.
---
# Adding a Command

## Critical

- Commands live in `src/commands/` as named exports from a default export function (`export default function commandName(program: Command): void`)
- All commands must be registered in `src/cli.ts` via `commandName(program)` before `program.parse()`
- Always import and use `llmCall` or `llmJsonCall` from `src/llm/index.ts` for LLM interactions, never SDK clients directly
- Use `ora` spinner from `ora` package for long-running operations; always call `spinner.stop()` or `.succeed()` / `.fail()`
- Error handling: Wrap async operations in try/catch. Use `chalk.red()` for errors, exit with `process.exit(1)` on critical failure
- Verify the command works: `npm run build && node dist/bin.js <command> --help`

## Instructions

1. **Create the command file** at `src/commands/<command-name>.ts`
   - Export a default function: `export default function <commandName>(program: Command): void`
   - Inside, call `program.command('<command-name>')` and chain `.description()`, `.option()`, `.action()`
   - Verify: File exists and follows the naming pattern of `src/commands/init.ts`, `src/commands/status.ts`

2. **Define options and arguments** using `.option()` and `.argument()`
   - Examples: `.option('-f, --force', 'force action')` or `.argument('<project-path>', 'path to project')`
   - Verify: `.help()` output matches the pattern in existing commands

3. **Implement the action handler** with proper async/await and error handling
   - Signature: `.action(async (options: any, command: Command) => { ... })`
   - Always wrap main logic in `try/catch`. On error, log with `chalk.red()` and exit: `process.exit(1)`
   - Verify: No unhandled promise rejections

4. **Use spinners for long operations** (LLM calls, file I/O, fingerprinting)
   - Import: `import ora from 'ora'`
   - Pattern: `const spinner = ora('Loading...').start(); ... spinner.succeed('Done'); ... spinner.fail('Error')`
   - Verify: All code paths call `spinner.stop()` (or `.succeed()` / `.fail()`) before returning/exiting

5. **Call LLM via llmCall or llmJsonCall**
   - Import: `import { llmCall, llmJsonCall } from '../llm/index.js'`
   - For text: `const response = await llmCall({ systemPrompt: '...', userMessage: '...', model: 'auto' })`
   - For JSON: `const data = await llmJsonCall<MyType>({ systemPrompt: '...', userMessage: '...', model: 'auto' })`
   - Never call Anthropic/OpenAI SDK directly; llm/index.ts handles provider resolution
   - Verify: Response is not null before using; llmCall handles retries/backoff internally

6. **Import and use chalk for colored output**
   - Import: `import chalk from 'chalk'`
   - Pattern: `console.log(chalk.green('✓ Success'))`, `console.log(chalk.yellow('⚠ Warning'))`, `console.log(chalk.red('✗ Error'))`
   - Verify: Errors are red, warnings yellow, success green

7. **Register the command in src/cli.ts**
   - Open `src/cli.ts` and find the function that sets up all commands (near bottom)
   - Add: `commandName(program)` on a new line before `program.parse()`
   - Import at top: `import commandName from './commands/command-name.js'`
   - Verify: `npm run build && node dist/bin.js --help` shows the new command listed

8. **Write a test file** at `src/commands/__tests__/<command-name>.test.ts`
   - Use Vitest; mock `src/llm/index.ts` with `vi.mock()`
   - Test happy path, error handling, and option parsing
   - Verify: `npm run test -- <command-name>.test.ts` passes

## Examples

**User says:** "Add a 'validate' command that checks project structure using an LLM and outputs pass/fail."

**Actions taken:**
1. Create `src/commands/validate.ts`:
```typescript
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { llmCall } from '../llm/index.js';

export default function validate(program: Command): void {
  program
    .command('validate')
    .description('Validate project structure and configuration')
    .option('-p, --project <path>', 'project path', process.cwd())
    .action(async (options) => {
      const spinner = ora('Validating project...').start();
      try {
        const result = await llmCall({
          systemPrompt: 'You are a project structure validator.',
          userMessage: `Check if this project is valid: ${options.project}`,
          model: 'auto',
        });
        spinner.succeed('Validation complete');
        if (result.includes('valid')) {
          console.log(chalk.green('✓ Project is valid'));
        } else {
          console.log(chalk.red('✗ Project has issues'));
          console.log(result);
          process.exit(1);
        }
      } catch (err) {
        spinner.fail('Validation failed');
        console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}
```

2. Register in `src/cli.ts`: Add `validate(program)` before `program.parse()`

3. Test: `npm run build && node dist/bin.js validate --help`

**Result:** Command is callable, shows help, calls LLM, displays colored output, and exits cleanly.

## Common Issues

**"Command not found" after build**
- Cause: Command file exists but not registered in `src/cli.ts`
- Fix: Open `src/cli.ts`, verify import and function call exist before `program.parse()`. Rebuild: `npm run build`

**"Cannot find module 'src/llm/index.js'" or import errors**
- Cause: Import path missing `.js` extension or incorrect relative path
- Fix: Use `.js` extension in all relative imports (TypeScript/tsup requires it for ES modules). Verify: `import { llmCall } from '../llm/index.js'` (not `../llm`)

**Spinner not stopping; output looks frozen**
- Cause: Code path doesn't call `.stop()`, `.succeed()`, or `.fail()` on spinner
- Fix: Ensure all branches (success, error, early return) call `spinner.stop()` or `.succeed/.fail()` before returning

**LLM call hangs or returns null**
- Cause: Model resolution failed or network timeout; llmCall retries internally but may fail silently
- Fix: Check that an LLM provider is configured (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.). Verify: `caliber config list`. Add defensive check: `if (!response) { spinner.fail('LLM response empty'); process.exit(1); }`

**Test fails with "LLM is not mocked"**
- Cause: Forgot to mock `src/llm/index.ts` in test
- Fix: Add to test file: `vi.mock('../llm/index.js', () => ({ llmCall: vi.fn(async () => 'mocked response') }))`

**Chalk colors don't appear in CI/terminal**
- Cause: chalk auto-detects color support; may be disabled in piped output
- Fix: Explicitly enable if needed: `chalk.level = 3` at top of command. Usually not necessary; chalk handles it.