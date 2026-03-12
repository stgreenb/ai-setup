import { llmJsonCall } from '../llm/index.js';
import { FINGERPRINT_SYSTEM_PROMPT } from './prompts.js';

interface DetectResult {
  languages: string[];
  frameworks: string[];
}

export async function detectFrameworks(
  fileTree: string[],
  fileContents: Record<string, string>
): Promise<DetectResult> {
  const parts: string[] = ['Analyze this project and detect languages and frameworks.\n'];

  if (fileTree.length > 0) {
    parts.push('File tree:');
    parts.push(fileTree.join('\n'));
  }

  if (Object.keys(fileContents).length > 0) {
    parts.push('\nDependency file contents:');
    for (const [filePath, content] of Object.entries(fileContents)) {
      parts.push(`\n[${filePath}]`);
      parts.push(content);
    }
  }

  const fastModel = process.env.ANTHROPIC_SMALL_FAST_MODEL;

  const result = await llmJsonCall<DetectResult>({
    system: FINGERPRINT_SYSTEM_PROMPT,
    prompt: parts.join('\n'),
    ...(fastModel ? { model: fastModel } : {}),
  });

  return {
    languages: Array.isArray(result.languages) ? result.languages : [],
    frameworks: Array.isArray(result.frameworks) ? result.frameworks : [],
  };
}
