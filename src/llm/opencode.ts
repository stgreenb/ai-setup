import { spawn, execSync, type ChildProcess } from 'node:child_process';
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig } from './types.js';

const OPENCODE_BIN = 'opencode';
const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class OpenCodeProvider implements LLMProvider {
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: LLMConfig) {
    this.defaultModel = config.model || '';
    
    const envTimeout = process.env.CALIBER_OPENCODE_TIMEOUT_MS;
    this.timeoutMs = envTimeout ? parseInt(envTimeout, 10) : DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1000) {
      this.timeoutMs = DEFAULT_TIMEOUT_MS;
    }
  }

  async call(options: LLMCallOptions): Promise<string> {
    const fullPrompt = options.system 
      ? `${options.system}\n\n${options.prompt}`
      : options.prompt;
    
    return this.runCommand(fullPrompt, undefined);
  }

  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> {
    const fullPrompt = options.system 
      ? `${options.system}\n\n${options.prompt}`
      : options.prompt;
    
    return this.runCommandStream(fullPrompt, undefined, callbacks);
  }

  private async runCommand(prompt: string, model?: string): Promise<string> {
    const args = ['run', '--format', 'json'];
    const modelToUse = model && model !== 'default' ? model : undefined;
    if (modelToUse) args.push('--model', modelToUse);
    
    return new Promise((resolve, reject) => {
      const child = this.spawnOpenCode(args);
      child.stdin!.end(prompt);
      
      const chunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      
      child.stdout!.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      
      child.stderr!.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`OpenCode timed out after ${this.timeoutMs / 1000}s`));
      }, this.timeoutMs);
      
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      
      child.on('close', (code) => {
        clearTimeout(timer);
        
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');
        const output = Buffer.concat(chunks).toString('utf-8');
        
        if (code !== 0) {
          reject(new Error(`OpenCode exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        
        // Log stderr for debugging
        if (stderr.trim()) {
          console.error('[OpenCode stderr]:', stderr.slice(0, 500));
        }
        
        const text = this.parseJsonOutput(output);
        if (!text.trim()) {
          reject(new Error(`OpenCode returned empty response. stdout: ${output.slice(0, 500)}, stderr: ${stderr.slice(0, 500)}`));
          return;
        }
        
        resolve(text);
      });
    });
  }

  private async runCommandStream(prompt: string, model: string | undefined, callbacks: LLMStreamCallbacks): Promise<void> {
    const args = ['run', '--format', 'default'];
    const modelToUse = model && model !== 'default' ? model : undefined;
    if (modelToUse) args.push('--model', modelToUse);
    
    return new Promise((resolve, reject) => {
      const child = this.spawnOpenCode(args);
      child.stdin!.end(prompt);
      
      let settled = false;
      const stderrChunks: Buffer[] = [];
      
      child.stdout!.on('data', (chunk: Buffer) => {
        if (settled) return;
        
        const lines = chunk.toString('utf-8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const event = JSON.parse(line);
            if (event.type === 'text' && event.part?.text) {
              callbacks.onText(event.part.text);
            } else if (event.type === 'error') {
              settled = true;
              callbacks.onError(new Error(event.error?.data?.message || 'Unknown error'));
              child.kill();
              return;
            }
          } catch {
            // Not JSON, ignore
          }
        }
      });
      
      child.stderr!.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          callbacks.onError(new Error(`OpenCode timed out after ${this.timeoutMs / 1000}s`));
          child.kill('SIGTERM');
        }
      }, this.timeoutMs);
      
      child.on('error', (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          callbacks.onError(err);
        }
      });
      
      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        
        if (code !== 0 && code !== null) {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8');
          callbacks.onError(new Error(`OpenCode exited with code ${code}: ${stderr.slice(0, 500)}`));
        } else {
          callbacks.onEnd({ stopReason: 'end_turn' });
        }
        resolve();
      });
    });
  }

  private spawnOpenCode(args: string[]): ChildProcess {
    const env = { ...process.env, OPENCODE_DISABLE_AUTOCOMPACT: 'true' };
    
    if (IS_WINDOWS) {
      return spawn([OPENCODE_BIN, ...args].join(' '), {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'] as const,
        env,
        shell: true,
      });
    }
    return spawn(OPENCODE_BIN, args, {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
  }

  private parseJsonOutput(output: string): string {
    const textParts: string[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Skip markdown code fences and empty markers
      if (trimmed.startsWith('```') || trimmed === '```') continue;
      if (trimmed === '> build · auto-fastest') continue;
      if (trimmed.startsWith('> ')) continue;
      
      // Try to parse as JSON event
      try {
        const event = JSON.parse(trimmed);
        if (event.type === 'text' && event.part?.text) {
          textParts.push(event.part.text);
        } else if (event.type === 'step_finish' || event.type === 'step_start') {
          continue;
        }
      } catch {
        // Not JSON - treat as plain text if it looks like content
        if (trimmed.length > 5 && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
          textParts.push(trimmed);
        }
      }
    }
    
    const result = textParts.join('');
    
    // Try to find JSON object in the result
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }
    
    return result;
  }
}

export function isOpenCodeAvailable(): boolean {
  try {
    const cmd = IS_WINDOWS ? `where ${OPENCODE_BIN}` : `which ${OPENCODE_BIN}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}