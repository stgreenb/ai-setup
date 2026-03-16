import { getProvider } from '../llm/index.js';
import { REFINE_SYSTEM_PROMPT } from './prompts.js';
import { stripMarkdownFences } from '../llm/utils.js';

interface RefineCallbacks {
  onComplete: (setup: Record<string, unknown>) => void;
  onError: (error: string) => void;
}

export async function refineSetup(
  currentSetup: Record<string, unknown>,
  message: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
  callbacks?: RefineCallbacks
): Promise<Record<string, unknown> | null> {
  const provider = getProvider();

  const prompt = `Current setup:\n${JSON.stringify(currentSetup, null, 2)}\n\nUser request: ${message}\n\nReturn the complete updated AgentSetup JSON incorporating the user's changes. Respond with ONLY the JSON.`;

  return new Promise((resolve) => {
    let buffer = '';

    provider.stream(
      {
        system: REFINE_SYSTEM_PROMPT,
        prompt,
        messages: conversationHistory,
        maxTokens: 16000,
      },
      {
        onText: (text) => {
          buffer += text;
        },
        onEnd: () => {
          const cleaned = stripMarkdownFences(buffer);
          const jsonStart = cleaned.indexOf('{');
          const jsonToParse = jsonStart !== -1 ? cleaned.slice(jsonStart) : cleaned;
          try {
            const setup = JSON.parse(jsonToParse);
            if (callbacks) callbacks.onComplete(setup);
            resolve(setup);
          } catch {
            if (callbacks) callbacks.onError('Failed to parse AI response. Try rephrasing your request.');
            resolve(null);
          }
        },
        onError: (error) => {
          if (callbacks) callbacks.onError(error.message);
          resolve(null);
        },
      }
    ).catch((error: Error) => {
      if (callbacks) callbacks.onError(error.message);
      resolve(null);
    });
  });
}
