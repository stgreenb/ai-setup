import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { searchAllMcpSources } from './search.js';
import { validateAndScore } from './validate.js';
import { fetchReadme, extractMcpConfig } from './config-extract.js';
import type { Fingerprint } from '../fingerprint/index.js';
import type { McpCandidate, McpServerConfig, McpDiscoveryResult } from './types.js';

type TargetAgent = 'claude' | 'cursor' | 'codex' | 'both';

/**
 * Main orchestrator: discover and install MCP servers during init.
 * Uses fingerprint.tools (detected by LLM during discovery) instead of
 * hardcoded package file parsing.
 */
export async function discoverAndInstallMcps(
  targetAgent: TargetAgent,
  fingerprint: Fingerprint,
  dir: string,
): Promise<McpDiscoveryResult> {
  console.log(chalk.hex('#6366f1').bold('\n  MCP Server Discovery\n'));

  const toolDeps = fingerprint.tools;

  if (toolDeps.length === 0) {
    console.log(chalk.dim('  No external tools or services detected — skipping MCP discovery'));
    return { installed: 0, names: [] };
  }

  const spinner = ora(`Searching MCP servers for ${toolDeps.length} detected tool${toolDeps.length === 1 ? '' : 's'}...`).start();
  console.log(chalk.dim(`  Detected: ${toolDeps.join(', ')}`));

  // Filter out tools that already have MCP servers configured
  const existingMcps = getExistingMcpNames(fingerprint, targetAgent);
  const filteredDeps = toolDeps.filter(d => {
    const lower = d.toLowerCase();
    return !existingMcps.some(name => name.includes(lower) || lower.includes(name));
  });

  if (filteredDeps.length === 0) {
    spinner.succeed(chalk.dim('All detected tools already have MCP servers configured'));
    return { installed: 0, names: [] };
  }

  // Search for MCP servers
  const candidates = await searchAllMcpSources(filteredDeps);

  if (candidates.length === 0) {
    spinner.succeed(chalk.dim('No MCP servers found for detected tools'));
    return { installed: 0, names: [] };
  }

  spinner.succeed(`Found ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} for ${filteredDeps.join(', ')}`);

  // Validate and score
  const scoreSpinner = ora('Scoring MCP candidates...').start();
  const scored = await validateAndScore(candidates, filteredDeps);

  if (scored.length === 0) {
    scoreSpinner.succeed(chalk.dim('No quality MCP servers passed validation'));
    console.log(chalk.dim(`  Candidates checked: ${candidates.map(c => c.name).join(', ')}`));
    return { installed: 0, names: [] };
  }

  scoreSpinner.succeed(`${scored.length} quality MCP server${scored.length === 1 ? '' : 's'} found`);
  console.log(chalk.dim(`  Scored: ${scored.map(c => `${c.name} (${c.score})`).join(', ')}`));

  // Step 6: Interactive selection
  const selected = await interactiveSelect(scored);
  if (!selected || selected.length === 0) {
    return { installed: 0, names: [] };
  }

  // Step 7: Configure each selected MCP
  const mcpServers: Record<string, McpServerConfig> = {};
  const installedNames: string[] = [];

  for (const mcp of selected) {
    console.log(chalk.bold(`\n  Configuring ${mcp.name}...`));

    const readme = await fetchReadme(mcp.repoFullName);
    if (!readme) {
      console.log(chalk.yellow(`  Could not fetch README for ${mcp.repoFullName} — skipping`));
      console.log(chalk.dim(`  Manual setup: ${mcp.url}`));
      continue;
    }

    const config = await extractMcpConfig(readme, mcp.name);
    if (!config || !config.command) {
      console.log(chalk.yellow(`  Could not extract config for ${mcp.name} — skipping`));
      console.log(chalk.dim(`  Manual setup: ${mcp.url}`));
      continue;
    }

    // Prompt for env vars
    const env: Record<string, string> = {};
    for (const envVar of config.env) {
      if (!envVar.required) continue;
      const value = await promptInput(`  ? ${envVar.key} (${envVar.description})`);
      if (value) {
        env[envVar.key] = value;
      }
    }

    const serverConfig: McpServerConfig = {
      command: config.command,
    };
    if (config.args.length > 0) serverConfig.args = config.args;
    if (Object.keys(env).length > 0) serverConfig.env = env;

    mcpServers[mcp.name] = serverConfig;
    installedNames.push(mcp.name);
    console.log(`  ${chalk.green('✓')} ${mcp.name} configured`);
  }

  if (installedNames.length === 0) {
    return { installed: 0, names: [] };
  }

  // Step 8: Write MCP configs directly (merge with existing)
  if (targetAgent === 'claude' || targetAgent === 'both') {
    writeMcpJson(path.join(dir, '.mcp.json'), mcpServers);
  }
  if (targetAgent === 'cursor' || targetAgent === 'both') {
    const cursorDir = path.join(dir, '.cursor');
    if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
    writeMcpJson(path.join(cursorDir, 'mcp.json'), mcpServers);
  }
  if (targetAgent === 'codex') {
    // Codex uses .mcp.json at project root (same as Claude)
    writeMcpJson(path.join(dir, '.mcp.json'), mcpServers);
  }

  return { installed: installedNames.length, names: installedNames };
}

function writeMcpJson(filePath: string, mcpServers: Record<string, McpServerConfig>): void {
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (parsed.mcpServers) existing = parsed.mcpServers;
    }
  } catch { /* ignore */ }

  const merged = { ...existing, ...mcpServers };
  fs.writeFileSync(filePath, JSON.stringify({ mcpServers: merged }, null, 2) + '\n');
}

function getExistingMcpNames(fingerprint: Fingerprint, targetAgent: TargetAgent): string[] {
  const names: string[] = [];

  if (targetAgent === 'claude' || targetAgent === 'both') {
    if (fingerprint.existingConfigs.claudeMcpServers) {
      names.push(...Object.keys(fingerprint.existingConfigs.claudeMcpServers).map(k => k.toLowerCase()));
    }
  }

  if (targetAgent === 'cursor' || targetAgent === 'both') {
    if (fingerprint.existingConfigs.cursorMcpServers) {
      names.push(...Object.keys(fingerprint.existingConfigs.cursorMcpServers).map(k => k.toLowerCase()));
    }
  }

  return names;
}

function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.cyan(`${question}: `), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function interactiveSelect(candidates: McpCandidate[]): Promise<McpCandidate[] | null> {
  if (!process.stdin.isTTY) {
    // Non-interactive: print and return null
    console.log(chalk.bold('\n  Available MCP servers:\n'));
    for (const c of candidates) {
      const vendorTag = c.vendor ? chalk.blue(' (vendor)') : '';
      console.log(`  ${String(c.score).padStart(3)}  ${c.name}${vendorTag}  ${chalk.dim(c.reason)}`);
    }
    console.log('');
    return null;
  }

  const selected = new Set<number>();
  let cursor = 0;
  const { stdin, stdout } = process;
  let lineCount = 0;

  function render(): string {
    const lines: string[] = [];
    lines.push(chalk.bold('  Select MCP servers to install:'));
    lines.push('');

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const check = selected.has(i) ? chalk.green('[x]') : '[ ]';
      const ptr = i === cursor ? chalk.cyan('>') : ' ';
      const scoreColor = c.score >= 90 ? chalk.green : c.score >= 70 ? chalk.yellow : chalk.dim;
      const vendorTag = c.vendor ? chalk.blue(' (vendor)') : '';
      lines.push(`  ${ptr} ${check} ${scoreColor(String(c.score).padStart(3))}  ${c.name}${vendorTag}  ${chalk.dim(c.reason.slice(0, 40))}`);
    }

    lines.push('');
    lines.push(chalk.dim('  ↑↓ navigate  ⎵ toggle  a all  n none  ⏎ install  q skip'));
    return lines.join('\n');
  }

  function draw(initial: boolean) {
    if (!initial && lineCount > 0) {
      stdout.write(`\x1b[${lineCount}A`);
    }
    stdout.write('\x1b[0J');
    const output = render();
    stdout.write(output + '\n');
    lineCount = output.split('\n').length;
  }

  return new Promise((resolve) => {
    console.log('');
    draw(true);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function onData(key: string) {
      switch (key) {
        case '\x1b[A':
          cursor = (cursor - 1 + candidates.length) % candidates.length;
          draw(false);
          break;
        case '\x1b[B':
          cursor = (cursor + 1) % candidates.length;
          draw(false);
          break;
        case ' ':
          selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor);
          draw(false);
          break;
        case 'a':
          candidates.forEach((_, i) => selected.add(i));
          draw(false);
          break;
        case 'n':
          selected.clear();
          draw(false);
          break;
        case '\r':
        case '\n':
          cleanup();
          if (selected.size === 0) {
            console.log(chalk.dim('\n  No MCP servers selected.\n'));
            resolve(null);
          } else {
            resolve(Array.from(selected).sort().map(i => candidates[i]));
          }
          break;
        case 'q':
        case '\x1b':
        case '\x03':
          cleanup();
          console.log(chalk.dim('\n  Skipped MCP server installation.\n'));
          resolve(null);
          break;
      }
    }

    stdin.on('data', onData);
  });
}
