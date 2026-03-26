import { spawn, execSync, type ChildProcess, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig } from './types.js';

const OPENCODE_BIN = 'opencode';
const IS_WINDOWS = process.platform === 'win32';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export class OpenCodeProvider implements LLMProvider {
  private defaultModel: string;
  private timeoutMs: number;

  constructor(_config: LLMConfig) {
    // Always pass empty model - let OpenCode use its configured default from opencode.json
    this.defaultModel = '';
    
    const envTimeout = process.env.CALIBER_OPENCODE_TIMEOUT_MS;
    this.timeoutMs = envTimeout ? parseInt(envTimeout, 10) : DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1000) {
      this.timeoutMs = DEFAULT_TIMEOUT_MS;
    }
  }

  async call(options: LLMCallOptions): Promise<string> {
    const model = options.model || this.defaultModel;
    const fullPrompt = options.system 
      ? `${options.system}\n\n${options.prompt}`
      : options.prompt;
    
    return this.runOpenCode(fullPrompt, model);
  }

  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> {
    const model = options.model || this.defaultModel;
    const fullPrompt = options.system 
      ? `${options.system}\n\n${options.prompt}`
      : options.prompt;
    
    return this.runOpenCodeStream(fullPrompt, model, callbacks);
  }

  private runOpenCode(prompt: string, model: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = model ? ['run', '--format', 'json', '--model', model] : ['run', '--format', 'json'];
      const opts: SpawnSyncOptions = {
        timeout: this.timeoutMs,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB
        input: prompt,
        ...(IS_WINDOWS && { shell: true }),
      };

      const result = spawnSync(OPENCODE_BIN, args, opts);
      
      if (result.error) {
        reject(result.error);
        return;
      }

      if (result.status !== 0) {
        const stderr = typeof result.stderr === 'string' ? result.stderr : result.stderr?.toString() || '';
        reject(new Error(`opencode exited with code ${result.status}: ${stderr}`));
        return;
      }

      // Parse JSON events from output
      const stdout = result.stdout;
      const output = typeof stdout === 'string' ? stdout : stdout?.toString() || '';
      const events = output.split('\n').filter((line: string) => line.trim());
      let finalContent = '';

      for (const eventStr of events) {
        try {
          const event = JSON.parse(eventStr);
          if (event.type === 'result' && event.message?.content) {
            const content = event.message.content;
            if (Array.isArray(content)) {
              finalContent = content.map((c: { text?: string }) => c.text || '').join('');
            } else if (typeof content === 'string') {
              finalContent = content;
            }
          }
        } catch {
          // Skip non-JSON lines
        }
      }

      resolve(finalContent || output);
    });
  }

  private runOpenCodeStream(prompt: string, model: string, callbacks: LLMStreamCallbacks): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = model ? ['run', '--format', 'json', '--model', model] : ['run', '--format', 'json'];
      
      const child = spawn(OPENCODE_BIN, args, {
        timeout: this.timeoutMs,
        ...(IS_WINDOWS && { shell: true }),
      });

      child.on('error', (err) => {
        callbacks.onError(err);
        reject(err);
      });

      child.on('spawn', () => {
        child.stdin?.write(prompt);
        child.stdin?.end();
      });

      let buffer = '';

      child.stdout?.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'assistant' && event.message?.content) {
              const content = event.message.content;
              if (Array.isArray(content)) {
                callbacks.onText(content.map((c: { text?: string }) => c.text || '').join(''));
              } else if (typeof content === 'string') {
                callbacks.onText(content);
              }
            } else if (event.type === 'result') {
              callbacks.onEnd({ 
                stopReason: event.is_error ? 'error' : 'end_turn',
                usage: event.usage,
              });
            }
          } catch {
            // Not JSON, treat as text
            callbacks.onText(line);
          }
        }
      });

      child.stderr?.on('data', (data) => {
        // Log stderr but don't treat as error
      });

      child.on('error', (err) => {
        callbacks.onError(err);
        reject(err);
      });

      child.on('close', (code) => {
        if (code !== 0 && buffer.length === 0) {
          callbacks.onError(new Error(`opencode exited with code ${code}`));
        }
        resolve();
      });
    });
  }

  async dispose(): Promise<void> {
    // No persistent resources to clean up with CLI approach
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