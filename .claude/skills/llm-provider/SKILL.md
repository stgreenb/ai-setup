---
name: llm-provider
description: Multi-provider LLM layer patterns for @rely-ai/caliber. Use when calling llmCall/llmJsonCall from src/llm/index.ts, adding a new LLM provider, handling streaming responses, parsing JSON from LLM output, or configuring provider credentials. Trigger phrases: 'add provider', 'LLM call', 'streaming', 'JSON parse', 'initialize LLM', 'retry logic'. Do NOT use for provider config UI (see src/commands/config.ts) or CLI argument parsing (see src/cli.ts).
---
# llm-provider

## Critical

- **Provider Resolution Order**: Check env vars in order: `ANTHROPIC_API_KEY` → `VERTEX_PROJECT_ID`/`GCP_PROJECT_ID` → `OPENAI_API_KEY` → `CALIBER_USE_CURSOR_SEAT=1` → `CALIBER_USE_CLAUDE_CLI=1`. First match wins. If none found, throw error listing all missing keys.
- **Config Location**: Always read/write to `~/.caliber/config.json` via `src/llm/config.ts`. Never hardcode credentials in `.env`.
- **Import Pattern**: Use `import { llmCall, llmJsonCall } from './src/llm/index.ts'` — never import individual providers directly.
- **Model Selection**: Use `DEFAULT_MODELS[provider]` or `DEFAULT_FAST_MODELS[provider]` from `src/llm/config.ts`. Fast models for streaming init; full models for refinement.
- **JSON Extraction**: Always wrap LLM calls returning JSON with `extractJson()` from `src/llm/utils.ts`. Never `JSON.parse()` raw LLM output.
- **Error Handling**: Catch `LLMError` (defined in `src/llm/types.ts`). Retry up to 3× with exponential backoff. Log provider name and model in error messages.

## Instructions

1. **Verify Provider is Available**
   - Check `src/llm/config.ts:DEFAULT_MODELS` has the provider mapped to a model string.
   - If adding a new provider: add `export const PROVIDER_NAME_MODEL = 'model-id'` constant.
   - Verify X before proceeding: Run `npm run build` and confirm no TypeScript errors in `src/llm/types.ts`.

2. **Create Provider File** (if new provider)
   - Create `src/llm/{provider-name}.ts`.
   - Export async function signature: `export async function {provider}Call(config: ProviderConfig, params: LLMParams): Promise<string>` (or `Promise<{ content: string; metadata: Metadata }>`; study existing providers for pattern).
   - Import `LLMParams`, `ProviderConfig`, `LLMError` from `./types.ts`.
   - Validate params match existing provider implementations (e.g., `anthropic.ts`, `openai-compat.ts`).
   - This step uses output from Step 1 (model constants).

3. **Implement Provider Logic**
   - Use SDK client initialization matching existing patterns:
     - **Anthropic**: `new Anthropic({ apiKey: config.apiKey })`
     - **OpenAI**: `new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl })`
     - **Vertex**: `new Anthropic({ apiVersion: 'v1', project: config.projectId, ... })`
   - Build request body matching provider's API (study `anthropic.ts`, `openai-compat.ts` for exact field mappings).
   - On error, throw `new LLMError(message, provider, model, originalError)`.
   - Verify X: Provider client throws the correct error type for invalid API keys, rate limits, and network failures.

4. **Handle Streaming (if applicable)**
   - For streaming: return async generator yielding `{ type: 'text', text: string }` chunks (study `src/ai/generate.ts:createStreamGenerator()` for usage pattern).
   - For non-streaming: accumulate chunks and return concatenated `string`.
   - Call `ora().start()` before streaming; call `.stop()` after.
   - This step uses error handling from Step 3.

5. **Register Provider in src/llm/index.ts**
   - Import new provider: `import { {provider}Call } from './{provider-name}'`.
   - Add case in `llmCall()` switch: `case '{provider}': return {provider}Call(config, params);`
   - Add to `llmJsonCall()` wrapper (calls `llmCall()` then `extractJson()`).
   - Verify X: `npm run build` succeeds and `npm run test -- src/llm/__tests__/` passes (if tests exist).

6. **Update Config** (if credentials needed)
   - Edit `src/llm/config.ts:DEFAULT_MODELS` and `DEFAULT_FAST_MODELS` to include new provider.
   - Add env var fallback to provider resolution in `src/llm/index.ts:selectProvider()`.
   - Update `~/.caliber/config.json` schema comment in `src/llm/config.ts`.
   - This step uses output from Step 5 (provider registered).

7. **Test End-to-End**
   - Create test in `src/llm/__tests__/{provider-name}.test.ts` calling `llmCall()` with mocked SDK.
   - Test happy path (valid input → output), error path (invalid key → LLMError), and timeout.
   - Run: `npm run test -- src/llm/__tests__/{provider-name}.test.ts`.
   - Verify X: All tests pass and coverage > 80%.

## Examples

**User says**: "Add Google Vertex AI provider for multi-region fallback."

**Actions**:
1. Study `src/llm/vertex.ts` existing implementation.
2. Confirm `DEFAULT_MODELS['vertex']` and `DEFAULT_FAST_MODELS['vertex']` exist in `src/llm/config.ts` → `'claude-3-5-sonnet@20241022'`.
3. Add region fallback logic to `src/llm/vertex.ts:vertexCall()`:
   ```typescript
   const regions = config.region ? [config.region, 'us-east5'] : ['us-east5'];
   for (const region of regions) {
     try {
       return await callVertex(region);
     } catch (e) {
       if (region === regions[regions.length - 1]) throw e;
     }
   }
   ```
4. Update test: `src/llm/__tests__/vertex.test.ts` mocks both regions.
5. Build and test: `npm run build && npm run test -- src/llm/__tests__/vertex.test.ts`.

**Result**: Callers of `llmCall(config, params)` automatically failover to `us-east5` if primary region unavailable.

---

**User says**: "Call LLM to generate CLAUDE.md and parse the JSON frontmatter."

**Actions**:
1. Use `llmJsonCall()` from `src/llm/index.ts`: it wraps `llmCall()` + `extractJson()`.
   ```typescript
   const result = await llmJsonCall(config, {
     model: DEFAULT_MODELS[config.provider],
     messages: [{ role: 'user', content: prompt }]
   });
   const parsed = JSON.parse(result);
   ```
2. If JSON is nested in markdown, `extractJson()` automatically extracts code blocks (study `src/llm/utils.ts`).
3. Wrap in try/catch, throw `LLMError` on parse failure.

**Result**: Reliable JSON extraction even if LLM adds markdown wrappers.

## Common Issues

**"Error: No LLM provider configured"**
- Check all env vars: `echo $ANTHROPIC_API_KEY && echo $OPENAI_API_KEY && echo $VERTEX_PROJECT_ID`.
- If empty, run: `caliber config` to interactively set provider and credentials.
- Verify `~/.caliber/config.json` exists: `cat ~/.caliber/config.json`.
- Fix: Set one env var or run config command; restart shell (`source ~/.bashrc`).

**"LLMError: Invalid API key for provider=anthropic"**
- Verify key exists: `echo $ANTHROPIC_API_KEY` (should not be empty).
- Test directly: `curl https://api.anthropic.com/v1/messages -H "x-api-key: $ANTHROPIC_API_KEY"` → should 200 or auth error.
- If auth error: regenerate key in Claude console, update env var, restart.
- Fix: `export ANTHROPIC_API_KEY=sk-ant-...` then retry command.

**"extractJson failed: No JSON found in response"**
- LLM returned plain text instead of JSON.
- Add `"format": "json"` to `messages[0].content` prompt or system prompt.
- Study `src/ai/prompts.ts` for examples (e.g., `GENERATE_SYSTEM_PROMPT` uses `\`\`\`json ... \`\`\` `).
- Fix: Update prompt to explicitly request JSON block; test with `caliber score --verbose`.

**"Vertex auth: default credentials not found"**
- Running outside GCP without explicit credentials.
- Fix: Set `VERTEX_SA_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS` to path of service account JSON.
- Or: `gcloud auth application-default login` to use ADC.

**"Timeout after 30s (provider=openai)"**
- Network latency or LLM hung.
- Retry logic is built in (3× exponential backoff in `src/llm/index.ts:llmCall()`).
- If still failing: check `OPENAI_BASE_URL` is reachable: `curl $OPENAI_BASE_URL/v1/models`.
- Fix: Increase timeout in `src/llm/types.ts:LLMParams` → `timeout?: number` (ms); default 30000.