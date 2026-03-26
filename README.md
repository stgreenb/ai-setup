# ai-setup (OpenCode Fork)

This is a fork of [caliber-ai-org/ai-setup](https://github.com/caliber-ai-org/ai-setup) that adds **OpenCode** as a supported target agent for config generation and scoring.

## What's Added

- OpenCode config writer (generates `opencode.json`, `.opencode/skills/`, `.opencode/commands/`, `.opencode/agents/`)
- OpenCode scoring checks (deterministic config scoring)
- CLI support: `--agent opencode` for `init` and `score` commands

## Getting Started

```bash
npx @rely-ai/caliber score --agent opencode
npx @rely-ai/caliber init --agent opencode
```

## Full Documentation

For complete usage instructions, feature details, and contribution guidelines, see the main repo:
**https://github.com/caliber-ai-org/ai-setup**

## License

Same as the base project — see LICENSE file.