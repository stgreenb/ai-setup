# ai-setup (OpenCode Fork)

This is a fork of [caliber-ai-org/ai-setup](https://github.com/caliber-ai-org/ai-setup) that adds **OpenCode** as a supported target agent for config generation and scoring.

## What's Added

- OpenCode config writer (generates `opencode.json`, `.opencode/skills/`, `.opencode/commands/`, `.opencode/agents/`)
- OpenCode scoring checks (deterministic config scoring)
- CLI support: `--agent opencode` for `init` and `score` commands

## Getting Started

```bash
# Clone and build locally (recommended)
git clone https://github.com/stgreenb/ai-setup.git
cd ai-setup
npm install && npm run build
node dist/bin.js score --agent opencode
node dist/bin.js init --agent opencode
```

## Full Documentation

For complete usage instructions, feature details, and contribution guidelines, see the main repo:
**https://github.com/caliber-ai-org/ai-setup**

## License

Same as the base project — see LICENSE file.