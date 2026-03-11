---
name: llm-provider
description: Multi-provider LLM layer patterns for @rely-ai/caliber. Use when calling llmCall/llmJsonCall, adding a new LLM provider, handling streaming responses, parsing JSON from LLM output, or configuring provider credentials.
---
# LLM Provider Layer

All LLM calls go through `src/llm/`. Never import provider SDKs (`@anthropic-ai/sdk`, `openai`, `@anthropic-ai/vertex-sdk`) directly in commands or AI logic — use the helpers.

## Core Helpers

```typescript
import { llmCall, llmJsonCall } from '../llm/index.js';

// Plain text response
const text = await llmCall({
  system: 'You are a code analyst.',
  prompt: 'Summarize this file: ...',
});

// Structured JSON response — parsed and typed
const result = await llmJsonCall<{ frameworks: string[] }>({
  system: 'Extract frameworks as JSON.',
  prompt: 'Here is the package.json: ...',
});
```

`llmCall()` and `llmJsonCall()` automatically:
- Resolve the active provider via `getProvider()`
- Retry on transient errors with exponential backoff (`TRANSIENT_ERRORS`)
- Parse JSON using `extractJson()` (bracket-balancing) or `parseJsonResponse()`

## Streaming

For streaming generation (like `caliber init`), use the provider directly:

```typescript
import { getProvider } from '../llm/index.js';

const provider = getProvider();
await provider.stream(
  { system, prompt },
  {
    onText: (chunk) => process.stdout.write(chunk),
    onComplete: (fullText) => { /* finalize */ },
    onError: (err) => { /* handle */ },
  }
);
```

## Adding a New Provider

1. Create `src/llm/<provider>.ts` implementing `LLMProvider` from `types.ts`:

```typescript
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig } from './types.js';

export class MyProvider implements LLMProvider {
  constructor(private config: LLMConfig) {}
  async call(options: LLMCallOptions): Promise<string> { /* ... */ }
  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> { /* ... */ }
}
```

2. Add a detection branch in `createProvider()` in `src/llm/index.ts`
3. Add env var detection in `resolveFromEnv()` in `src/llm/config.ts`
4. Add a default model entry to `DEFAULT_MODELS` in `src/llm/config.ts`

## JSON Parsing Utilities

```typescript
import { extractJson, stripMarkdownFences, parseJsonResponse } from '../llm/utils.js';

// Strips ```json fences and parses
const obj = parseJsonResponse<MyType>(rawLlmOutput);

// Bracket-balancing extractor (handles leading/trailing prose)
const json = extractJson(rawLlmOutput);

// Token estimation before sending
const tokens = estimateTokens(prompt);
```

## Config Resolution Order

1. `ANTHROPIC_API_KEY` → `AnthropicProvider` (`@anthropic-ai/sdk`, default: `claude-sonnet-4-6`)
2. `VERTEX_PROJECT_ID` / `GCP_PROJECT_ID` → `VertexProvider` (`@anthropic-ai/vertex-sdk`, `google-auth-library`, default region: `us-east5`)
3. `OPENAI_API_KEY` → `OpenAICompatProvider` (`openai`, default: `gpt-4.1`; `OPENAI_BASE_URL` for custom)
4. `~/.caliber/config.json` — written by `caliber config`
5. `CALIBER_MODEL` — overrides model for any provider

## Transient Error Handling

`llmCall()` retries automatically. For manual checks:

```typescript
import { TRANSIENT_ERRORS } from '../llm/index.js';

const isTransient = TRANSIENT_ERRORS.some(msg => err.message.includes(msg));
```
