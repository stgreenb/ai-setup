import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import confirm from '@inquirer/confirm';

const __dirname_vc = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname_vc, '..', 'package.json'), 'utf-8')
);

function getInstalledVersion(): string | null {
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const pkgPath = path.join(globalRoot, '@rely-ai', 'caliber', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return null;
  }
}

export async function checkForUpdates(): Promise<void> {
  if (process.env.CALIBER_SKIP_UPDATE_CHECK) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch('https://registry.npmjs.org/@rely-ai/caliber/latest', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return;

    const data = (await res.json()) as { version?: string };
    const latest = data.version;
    if (!latest) return;

    const current = pkg.version as string;
    if (current === latest) return;

    const isInteractive = process.stdin.isTTY === true;

    if (!isInteractive) {
      console.log(
        chalk.yellow(
          `\nUpdate available: ${current} -> ${latest}\nRun ${chalk.bold('npm install -g @rely-ai/caliber')} to upgrade.\n`
        )
      );
      return;
    }

    console.log(
      chalk.yellow(`\nUpdate available: ${current} -> ${latest}`)
    );

    const shouldUpdate = await confirm({ message: 'Would you like to update now? (Y/n)', default: true });
    if (!shouldUpdate) {
      console.log();
      return;
    }

    const spinner = ora('Updating caliber...').start();
    try {
      execSync(`npm install -g @rely-ai/caliber@${latest} --prefer-online`, { stdio: 'pipe', timeout: 60_000 });

      const installed = getInstalledVersion();
      if (installed !== latest) {
        spinner.fail(`Update incomplete — got ${installed ?? 'unknown'}, expected ${latest}`);
        console.log(chalk.yellow(`Run ${chalk.bold(`npm install -g @rely-ai/caliber@${latest}`)} manually.\n`));
        return;
      }

      spinner.succeed(chalk.green(`Updated to ${latest}`));

      const args = process.argv.slice(2);
      console.log(chalk.dim(`\nRestarting: caliber ${args.join(' ')}\n`));
      execSync(`caliber ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
        stdio: 'inherit',
        env: { ...process.env, CALIBER_SKIP_UPDATE_CHECK: '1' },
      });
      process.exit(0);
    } catch (err) {
      spinner.fail('Update failed');
      const msg = err instanceof Error ? err.message : '';
      if (msg && !msg.includes('SIGTERM')) console.log(chalk.dim(`  ${msg.split('\n')[0]}`));
      console.log(
        chalk.yellow(
          `Run ${chalk.bold(`npm install -g @rely-ai/caliber@${latest}`)} manually to upgrade.\n`
        )
      );
    }
  } catch {
    // Silently ignore — offline, timeout, registry down, etc.
  }
}
