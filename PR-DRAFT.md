# Add OpenCode as LLM Provider

## Summary

Adds OpenCode as an LLM provider to Caliber, enabling the CLI to use OpenCode for LLM calls (init, generate, refresh) alongside existing providers (Claude Code, Cursor, Anthropic, OpenAI, Vertex AI).

## Changes

- **New provider**: `src/llm/opencode.ts` - CLI-based LLM provider using `opencode run --format json`
- **Types**: Added 'opencode' to `ProviderType` in `src/llm/types.ts`
- **Registration**: Provider registered in `src/llm/index.ts`
- **Config**: Default model + `CALIBER_USE_OPENCODE` env var support in `src/llm/config.ts`
- **Model recovery**: Added opencode to known models in `src/llm/model-recovery.ts`
- **Interactive setup**: Added OpenCode option to `src/commands/interactive-provider-setup.ts`
- **Tests**: Unit tests in `src/llm/__tests__/opencode.test.ts` (4 tests)

## Usage

```bash
# Use OpenCode for LLM calls
caliber config --provider opencode

# Or via environment variable
export CALIBER_USE_OPENCODE=1
```

## Test Results

- `caliber init --agent opencode` ✅ - Generates configs, installs skills
- `caliber score` ✅ - Scoring works
- `caliber refresh` ✅ - Sync works
- Lint: 0 errors (92 warnings)
- Build: ✅

## Notes

Some pre-existing test failures in fork (not related to OpenCode provider):
- `src/llm/__tests__/config.test.ts` (7 failures)
- `src/writers/__tests__/get-files-to-write.test.ts` (1 failure)
- `src/__tests__/claude-integration.test.ts` (7 failures)
- `src/scoring/__tests__/target-filter.test.ts` (2 failures)

These appear to be related to test expectations for existing fork features.

## Base

Forked from caliber-ai-org/ai-setup v1.39.0.
