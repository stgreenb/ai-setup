import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

import { writeOpenCodeConfig } from '../opencode/index.js';

describe('writeOpenCodeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('writes opencode.json to project root', () => {
    const written = writeOpenCodeConfig({ 
      opencodeJson: '{"model":"anthropic/claude-sonnet-4-5","autoupdate":true}'
    });

    expect(written).toContain('opencode.json');
    const content = vi.mocked(fs.writeFileSync).mock.calls.find(c => 
      String(c[0]) === 'opencode.json'
    );
    expect(content).toBeDefined();
    expect(content![1]).toContain('"model":"anthropic/claude-sonnet-4-5"');
  });

  it('writes skills to .opencode/skills/{name}/SKILL.md with frontmatter', () => {
    const config = {
      opencodeJson: '{"model":"test"}',
      skills: [
        { name: 'testing-guide', description: 'How to write tests', content: 'Write tests' },
        { name: 'deploy', description: 'Deploy steps', content: 'Deploy steps' },
      ],
    };

    const written = writeOpenCodeConfig(config);

    expect(written).toContain(path.join('.opencode', 'skills', 'testing-guide', 'SKILL.md'));
    expect(written).toContain(path.join('.opencode', 'skills', 'deploy', 'SKILL.md'));

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join('.opencode', 'skills', 'testing-guide'),
      { recursive: true },
    );
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const skillCall = writeCalls.find((c) => String(c[0]).includes('testing-guide'));
    expect(skillCall).toBeDefined();
    expect(skillCall![1]).toContain('How to write tests');
  });

  it('writes opencode.json only when no skills provided', () => {
    const written = writeOpenCodeConfig({ opencodeJson: '{}' });

    expect(written).toContain('opencode.json');
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it('handles mcpServers config', () => {
    const config = {
      opencodeJson: '{"model":"test"}',
      mcpServers: { test: { command: 'test-server' } },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{"model":"test"}');

    const written = writeOpenCodeConfig(config);

    expect(written).toContain('opencode.json');
    // MCP config should be merged into opencode.json
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const jsonCall = writeCalls.find((c) => String(c[0]) === 'opencode.json' && String(c[1]).includes('mcp'));
    expect(jsonCall).toBeDefined();
  });
});
