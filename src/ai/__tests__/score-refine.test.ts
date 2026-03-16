import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { validateSetup, scoreAndRefine } from '../score-refine.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('../../llm/index.js', () => ({
  llmCall: vi.fn(),
  getProvider: vi.fn(),
}));

vi.mock('../../llm/utils.js', () => ({
  stripMarkdownFences: (text: string) => text,
}));

import { llmCall } from '../../llm/index.js';

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockLlmCall = llmCall as ReturnType<typeof vi.fn>;

function makeSetup(claudeMd: string): Record<string, unknown> {
  return {
    targetAgent: ['claude'],
    claude: { claudeMd },
    fileDescriptions: { 'CLAUDE.md': 'test' },
  };
}

describe('validateSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('returns no issues for a well-formed setup', () => {
    mockExistsSync.mockReturnValue(true);
    const setup = makeSetup([
      '# Project',
      '',
      '## Commands',
      '',
      '```bash',
      'npm run build',
      '```',
      '',
      '```bash',
      'npm run test',
      '```',
      '',
      '```bash',
      'npm run lint',
      '```',
      '',
      '## Architecture',
      '',
      '- Entry: `src/index.ts`',
      '- Config: `tsconfig.json`',
      '- Tests: `src/__tests__/`',
      '',
      '## Conventions',
      '',
      '- Use `vitest` for testing',
      '- Run `npm run build` before deploying',
    ].join('\n'));

    const issues = validateSetup(setup, '/project');
    expect(issues).toHaveLength(0);
  });

  it('detects invalid references', () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('real-file.ts')) return true;
      return false;
    });

    const setup = makeSetup([
      '## Files',
      '',
      '- `src/real-file.ts` exists',
      '- `src/fake-file.ts` does not exist',
      '- `nonexistent/path/` missing',
    ].join('\n'));

    const issues = validateSetup(setup, '/project');
    const refIssue = issues.find(i => i.check === 'References valid');
    expect(refIssue).toBeDefined();
    expect(refIssue!.fixInstruction).toContain('fake-file.ts');
    expect(refIssue!.fixInstruction).toContain('nonexistent/path');
    expect(refIssue!.pointsLost).toBeGreaterThan(0);
  });

  it('detects directory tree listings', () => {
    const treeLines = Array.from({ length: 15 }, (_, i) =>
      `│   ├── file${i}.ts`
    );
    const setup = makeSetup([
      '## Structure',
      '',
      '```',
      ...treeLines,
      '```',
    ].join('\n'));

    const issues = validateSetup(setup, '/project');
    const treeIssue = issues.find(i => i.check === 'No directory tree listings');
    expect(treeIssue).toBeDefined();
    expect(treeIssue!.pointsLost).toBe(3);
  });

  it('detects missing code blocks', () => {
    mockExistsSync.mockReturnValue(true);
    const setup = makeSetup([
      '## Commands',
      '',
      '- Run `npm run build` to build',
      '- Run `npm run test` to test',
      '',
      '## Architecture',
      '',
      '- Entry: `src/index.ts`',
      '',
      '## Conventions',
      '',
      '- Use TypeScript',
    ].join('\n'));

    const issues = validateSetup(setup, '/project');
    const blockIssue = issues.find(i => i.check === 'Executable content');
    expect(blockIssue).toBeDefined();
    expect(blockIssue!.pointsLost).toBeGreaterThan(0);
  });

  it('detects low concreteness', () => {
    const setup = makeSetup([
      '## Guidelines',
      '',
      'Always write clean code.',
      'Follow best practices for testing.',
      'Ensure code quality is maintained.',
      'Use proper error handling.',
      'Write documentation for all functions.',
      'Keep the codebase organized.',
      'Review code before merging.',
      'Test thoroughly before deploying.',
    ].join('\n'));

    const issues = validateSetup(setup, '/project');
    const concIssue = issues.find(i => i.check === 'Concrete instructions');
    expect(concIssue).toBeDefined();
    expect(concIssue!.pointsLost).toBeGreaterThan(0);
  });

  it('returns empty for setup with no config content', () => {
    const setup = { targetAgent: ['claude'], claude: {} };
    const issues = validateSetup(setup, '/project');
    expect(issues).toHaveLength(0);
  });

  it('sorts issues by points lost descending', () => {
    mockExistsSync.mockReturnValue(false);
    const setup = makeSetup([
      '## Stuff',
      '',
      'Generic prose line.',
      '- `src/nonexistent.ts` a path',
      '- `src/also-fake.ts` another path',
    ].join('\n'));

    const issues = validateSetup(setup, '/project');
    for (let i = 1; i < issues.length; i++) {
      expect(issues[i - 1].pointsLost).toBeGreaterThanOrEqual(issues[i].pointsLost);
    }
  });
});

describe('scoreAndRefine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('returns setup unchanged when no issues found', async () => {
    const setup = makeSetup([
      '## Commands',
      '',
      '```bash',
      'npm run build',
      '```',
      '',
      '```bash',
      'npm run test',
      '```',
      '',
      '```bash',
      'npm run lint',
      '```',
      '',
      '## Architecture',
      '',
      '- Entry: `src/index.ts`',
      '- Config: `tsconfig.json`',
      '- Tests: `src/__tests__/`',
      '',
      '## Conventions',
      '',
      '- Use `vitest` for testing',
      '- Run `npm run build` before deploying',
    ].join('\n'));

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const result = await scoreAndRefine(setup, '/project', history);
    expect(result).toBe(setup);
    expect(mockLlmCall).not.toHaveBeenCalled();
  });

  it('calls llmCall with targeted content when issues are found', async () => {
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('nonexistent')) return false;
      return true;
    });

    const originalSetup = makeSetup('## Files\n\n- `src/nonexistent.ts` bad ref\n- `src/index.ts` good ref\n- `tsconfig.json` good ref\n\n## Commands\n\n## Architecture\n\n## Conventions\n\n```bash\nnpm test\n```\n\n```bash\nnpm build\n```\n\n```bash\nnpm lint\n```');

    const fixedContent = '## Files\n\n- `src/index.ts` good ref\n- `tsconfig.json` good ref\n- `package.json` good ref\n\n## Commands\n\n## Architecture\n\n## Conventions\n\n```bash\nnpm test\n```\n\n```bash\nnpm build\n```\n\n```bash\nnpm lint\n```';

    mockLlmCall.mockResolvedValueOnce(JSON.stringify({ claudeMd: fixedContent }));

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const result = await scoreAndRefine(originalSetup, '/project', history);

    expect(mockLlmCall).toHaveBeenCalled();
    const claude = result.claude as Record<string, unknown>;
    expect(claude.claudeMd).toBe(fixedContent);
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('returns best setup when refinement makes things worse', async () => {
    mockExistsSync.mockReturnValue(false);

    const originalSetup = makeSetup('## A\n\n## B\n\n## C\n\n- `src/one-bad.ts` ref\n\n```bash\nnpm test\n```\n\n```bash\nnpm build\n```\n\n```bash\nnpm lint\n```');
    const worseContent = '## A\n\n- `bad1.ts` ref\n- `bad2.ts` ref\n- `bad3.ts` ref';

    mockLlmCall.mockResolvedValueOnce(worseContent);
    mockLlmCall.mockResolvedValueOnce(worseContent);

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const result = await scoreAndRefine(originalSetup, '/project', history);
    expect(result).toBe(originalSetup);
  });

  it('handles llmCall throwing gracefully', async () => {
    mockExistsSync.mockReturnValue(false);

    const setup = makeSetup('## A\n\n- `src/nonexistent.ts` ref');
    mockLlmCall.mockRejectedValueOnce(new Error('LLM error'));

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const result = await scoreAndRefine(setup, '/project', history);
    expect(result).toBe(setup);
  });

  it('respects max iteration limit', async () => {
    mockExistsSync.mockReset();
    mockLlmCall.mockReset();
    mockExistsSync.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('fake')) return false;
      return true;
    });

    const baseContent = [
      '## Files',
      '',
      '- `src/fake.ts` bad ref',
      '- `src/other.ts` good ref',
      '- `src/another.ts` good ref',
    ].join('\n');
    const setup = makeSetup(baseContent);

    const stillBadContent = baseContent.replace('fake.ts', 'still-fake.ts');
    mockLlmCall.mockResolvedValue(JSON.stringify({ claudeMd: stillBadContent }));

    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    await scoreAndRefine(setup, '/project', history);
    expect(mockLlmCall).toHaveBeenCalledTimes(2);
  });
});
