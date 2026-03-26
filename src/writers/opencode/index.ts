import fs from 'fs';
import path from 'path';

interface OpenCodeConfig {
  opencodeJson: string;
  skills?: Array<{ name: string; description: string; content: string }>;
  commands?: Array<{ name: string; description: string; content: string }>;
  agents?: Array<{ name: string; description: string; content: string }>;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export function writeOpenCodeConfig(config: OpenCodeConfig): string[] {
  const written: string[] = [];

  fs.writeFileSync('opencode.json', config.opencodeJson);
  written.push('opencode.json');

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    let existingServers: Record<string, unknown> = {};
    try {
      if (fs.existsSync('opencode.json')) {
        const existing = JSON.parse(fs.readFileSync('opencode.json', 'utf-8'));
        if (existing.mcp) existingServers = existing.mcp;
      }
    } catch {}
    const mergedServers = { ...existingServers, ...config.mcpServers };
    const configObj = JSON.parse(fs.readFileSync('opencode.json', 'utf-8'));
    configObj.mcp = mergedServers;
    fs.writeFileSync('opencode.json', JSON.stringify(configObj, null, 2));
  }

  if (config.skills?.length) {
    for (const skill of config.skills) {
      const skillDir = path.join('.opencode', 'skills', skill.name);
      if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');
      const frontmatter = [
        '---',
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        '---',
        '',
      ].join('\n');
      fs.writeFileSync(skillPath, frontmatter + skill.content);
      written.push(skillPath);
    }
  }

  if (config.commands?.length) {
    const commandsDir = path.join('.opencode', 'commands');
    if (!fs.existsSync(commandsDir)) fs.mkdirSync(commandsDir, { recursive: true });
    for (const cmd of config.commands) {
      const cmdPath = path.join(commandsDir, `${cmd.name}.md`);
      const content = `---
name: ${cmd.name}
description: ${cmd.description}
---
${cmd.content}`;
      fs.writeFileSync(cmdPath, content);
      written.push(cmdPath);
    }
  }

  if (config.agents?.length) {
    const agentsDir = path.join('.opencode', 'agents');
    if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
    for (const agent of config.agents) {
      const agentPath = path.join(agentsDir, `${agent.name}.md`);
      const content = `---
name: ${agent.name}
description: ${agent.description}
---
${agent.content}`;
      fs.writeFileSync(agentPath, content);
      written.push(agentPath);
    }
  }

  return written;
}