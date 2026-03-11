# CLAUDE.md — Caliber

## What Is This

`@rely-ai/caliber` — open-source CLI that fingerprints coding projects and generates optimized AI agent configs (CLAUDE.md, .cursor/rules/, skills). Supports Anthropic, OpenAI, Google Vertex AI, and any OpenAI-compatible endpoint.

## Monorepo Layout

| Dir | Purpose |
|-----|---------|
| `src/` | Main CLI source (published package) |
| `apps/api/` | Internal API server |
| `apps/web/` | Internal web frontend |
| `packages/mcp-server/` | MCP server package |
| `packages/shared/` | Shared utilities |

## Commands

```bash
npm run build                    # Compile via tsup → dist/
npm run dev                      # Watch mode (tsup --watch)
npm run test                     # Run Vitest suite
npm run test -- --coverage       # v8 coverage report
npx tsc --noEmit                 # Type-check only
npx vitest run src/scoring/__tests__/accuracy.test.ts  # Single file
```

## Architecture

**Entry**: `src/bin.ts` (version check) → `src/cli.ts` (Commander, registers all commands)

**LLM layer** (`src/llm/`):
- `types.ts` — `LLMProvider` interface, `LLMConfig`, `LLMCallOptions`, `LLMStreamCallbacks`
- `config.ts` — env vars → `~/.caliber/config.json`; `DEFAULT_MODELS`, `loadConfig()`, `resolveFromEnv()`
- `anthropic.ts` (`@anthropic-ai/sdk`), `vertex.ts` (`@anthropic-ai/vertex-sdk`, `google-auth-library`), `openai-compat.ts` (`openai`)
- `utils.ts` — `extractJson()` bracket-balancing parser, `stripMarkdownFences()`, `parseJsonResponse()`, `estimateTokens()`
- `index.ts` — `llmCall()`, `llmJsonCall()`, `getProvider()`, retry + backoff, `TRANSIENT_ERRORS`

**AI logic** (`src/ai/`):
- `generate.ts` — streaming init via `generateSetup()`
- `refine.ts` — conversation refinement via `refineSetup()`
- `refresh.ts` — diff-based updates via `refreshDocs()`
- `learn.ts` — session event analysis via `analyzeEvents()`
- `detect.ts` — LLM-based framework detection via `detectFrameworks()`
- `prompts.ts` — all system prompts (`GENERATION_SYSTEM_PROMPT`, `REFINE_SYSTEM_PROMPT`, `REFRESH_SYSTEM_PROMPT`, `LEARN_SYSTEM_PROMPT`, `FINGERPRINT_SYSTEM_PROMPT`)

**Commands** (`src/commands/`): `init`, `regenerate` (alias: `update`/`regen`), `status`, `undo`, `config`, `recommend`, `score`, `refresh`, `hooks`, `learn`

**Fingerprinting** (`src/fingerprint/`):
- `git.ts`, `languages.ts`, `package-json.ts` (uses `glob`/`globSync`), `file-tree.ts`, `existing-config.ts`, `code-analysis.ts`
- `index.ts` — orchestrates all above, then calls `enrichFingerprintWithLLM()`
- Hash stored in `Fingerprint.hash` for drift detection

**Writers** (`src/writers/`):
- `claude/index.ts`, `cursor/index.ts` — write config files
- `staging.ts` — buffers writes before user confirmation
- `manifest.ts` — tracks written files in `.caliber/manifest.json`
- `backup.ts` — timestamped backups in `.caliber/backups/`
- `refresh.ts` — diff-targeted doc updates

**Scoring** (`src/scoring/`): Deterministic, no LLM. Checks: `existence`, `quality`, `coverage`, `accuracy`, `freshness`, `bonus`. Run via `caliber score`. Constants in `scoring/constants.ts`.

**Learner** (`src/learner/`):
- `storage.ts` — captures Claude Code session tool events → `.caliber/learning/`
- `writer.ts` — writes learned skills/instructions to CLAUDE.md
- `stdin.ts` — reads hook-piped events
- Finalized via `caliber learn finalize`

**Scanner** (`src/scanner/index.ts`): `detectPlatforms()`, `scanLocalState()`, `compareState()` — detects installed claude/cursor configs.

## LLM Provider Config

Resolution order (highest priority first):
1. `ANTHROPIC_API_KEY` → Anthropic (`claude-sonnet-4-6` default)
2. `VERTEX_PROJECT_ID` / `GCP_PROJECT_ID` → Vertex AI (`us-east5`; ADC, `VERTEX_SA_CREDENTIALS`, or `GOOGLE_APPLICATION_CREDENTIALS`)
3. `OPENAI_API_KEY` → OpenAI (`gpt-4.1`; `OPENAI_BASE_URL` for custom endpoints)
4. `~/.caliber/config.json` — written by `caliber config`
5. `CALIBER_MODEL` — overrides model for any provider

## Testing

- **Framework**: Vitest (`globals: true`, `environment: node`)
- **Setup**: `src/test/setup.ts` — globally mocks LLM provider (no real API calls)
- **Location**: `src/**/__tests__/*.test.ts`
- **Coverage**: v8; excludes `src/test/`, `src/bin.ts`, `src/cli.ts`, `src/commands/**`, `dist/**`
- Focus: `src/llm/`, `src/scoring/`, `src/fingerprint/`, `src/ai/`

## TypeScript Conventions

- Strict mode, ES2022 target, `moduleResolution: bundler`
- **ES module imports require `.js` extension** even for `.ts` source files
- Prefer `unknown` over `any`; explicit types on params and return values
- Key deps: `commander`, `chalk`, `ora`, `@inquirer/confirm`, `@inquirer/select`, `glob`, `tsup`

## Error Handling

- `throw new Error('__exit__')` — clean CLI exit, no stack trace
- Use `ora` spinner `.fail()` before rethrowing async errors
- Transient LLM errors (overload, rate limit) auto-retry in `llmCall()`

## Commit Convention

`feat:` → minor, `fix:`/`refactor:`/`chore:` → patch, `feat!:` → major
Scope optional: `feat(scanner): detect Cursor config`

## Permissions

See `.claude/settings.json`. Never commit API keys or credentials.
