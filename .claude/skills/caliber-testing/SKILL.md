---
name: caliber-testing
description: Testing patterns for @rely-ai/caliber. Use when writing or fixing Vitest tests, understanding the LLM mock setup, checking coverage configuration, or structuring test files. Trigger phrases: 'write test', 'fix test', 'mock LLM', 'coverage', 'test setup'. Do NOT use for running tests — use npm run test directly.
---
# Caliber Testing

## Critical

- **All LLM calls MUST use mocks** from `src/test/setup.ts`. Never make real API calls in tests.
- **Vitest config** is in `vitest.config.ts` at project root. Coverage runs with `npm run test:coverage`.
- **Test file location**: Place tests adjacent to source with `.test.ts` suffix (e.g., `src/ai/__tests__/generate.test.ts`).
- **Mock provider resolution**: Tests use `process.env` to mock provider detection (Anthropic, Vertex, OpenAI, Claude CLI, Cursor ACP).

## Instructions

1. **Set up test file structure**
   - Create file at `src/<module>/__tests__/<feature>.test.ts`
   - Import: `import { describe, it, expect, beforeEach, vi } from 'vitest'`
   - Import mocks from `src/test/setup.ts`: `import { mockLlmCall, mockLlmJsonCall, cleanupMocks } from '../../../test/setup'`
   - Verify: File exists and TypeScript compiles (`npx tsc --noEmit`)

2. **Mock LLM provider** (uses `src/test/setup.ts`)
   - Call `mockLlmCall()` to mock text responses; call `mockLlmJsonCall()` for JSON responses
   - Both return `{ mock, resolvedValue, error }` — set `mock.mockResolvedValue(...)` or `mock.mockRejectedValue(...)`
   - Example: `const { mock } = mockLlmCall(); mock.mockResolvedValue({ text: 'Claude response' });`
   - Always call `cleanupMocks()` in `afterEach()` or test teardown
   - Verify: No real API calls occur (check stderr for "API key not set" warnings)

3. **Structure describe/it blocks**
   - Group related tests: `describe('generate.ts', () => { it('streams init message', () => { ... }) })`
   - Use `beforeEach()` to set mocks, `afterEach()` to call `cleanupMocks()`
   - Test both success and failure: one `it()` for happy path, one for error handling
   - Verify: Each `it()` is atomic and does not depend on test execution order

4. **Mock environment variables** for provider detection
   - Set `process.env.ANTHROPIC_API_KEY = 'test-key'` before calling LLM functions
   - For Vertex: set `process.env.VERTEX_PROJECT_ID = 'test-project'`
   - For OpenAI: set `process.env.OPENAI_API_KEY = 'test-key'` and `process.env.OPENAI_BASE_URL` if needed
   - For Claude CLI: set `process.env.CALIBER_USE_CLAUDE_CLI = '1'`
   - For Cursor ACP: set `process.env.CALIBER_USE_CURSOR_SEAT = '1'`
   - Restore original values in `afterEach()` via `delete process.env.<KEY>`
   - Verify: `llmCall()` uses the correct provider by inspecting mock call arguments

5. **Assert LLM responses**
   - Check mock was called: `expect(mock).toHaveBeenCalled()`
   - Check call args match prompt: `expect(mock).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('...')}))`
   - For JSON extraction, verify `extractJson()` was called: `expect(extractJson).toHaveBeenCalledWith(expect.stringContaining('...'))`
   - Verify: Response object matches expected shape (e.g., `{ text: string }` or `{ error: string, code: number }`)

6. **Test error handling**
   - Mock LLM failure: `mock.mockRejectedValue(new Error('API Error'))`
   - Verify catch block: `expect(await fnCall()).resolves.toMatchObject({ error: 'API Error' })`
   - Test retry logic: `expect(mock).toHaveBeenCalledTimes(3)` after `llmCall()` with backoff
   - Verify: Error matches type in `src/llm/types.ts`

7. **Run and verify coverage**
   - Run: `npm run test:coverage` generates HTML report in `coverage/`
   - Check `src/ai/` and `src/llm/` coverage ≥ 80%
   - For uncovered branches: add test case or use `/* c8 ignore next N */` comment
   - Verify: All critical paths (streaming, error retry, provider detection) are covered

## Examples

**Example 1: Mock Anthropic response and verify streaming**

User says: "Write a test for generate.ts that mocks Claude streaming."

Action taken:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockLlmCall, cleanupMocks } from '../../../test/setup';
import { generate } from '../generate';

describe('generate.ts', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    cleanupMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('streams init message for fingerprint', async () => {
    const { mock } = mockLlmCall();
    mock.mockResolvedValue({
      text: 'Here is the CLAUDE.md content...'
    });

    const result = await generate({ /* fingerprint */ }, 'anthropic');

    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining('AI agent config')
      })
    );
    expect(result.text).toContain('CLAUDE.md');
  });
});
```

Result: Test compiles, mocks Anthropic, verifies streaming prompt and response.

**Example 2: Mock error and test retry**

User says: "Test that llmCall retries on API error."

Action taken:
```typescript
it('retries on transient API error', async () => {
  const { mock } = mockLlmCall();
  mock.mockRejectedValueOnce(new Error('Rate limit'))
    .mockResolvedValueOnce({ text: 'Success' });

  const result = await llmCall({ prompt: '...' });

  expect(mock).toHaveBeenCalledTimes(2);
  expect(result.text).toBe('Success');
});
```

Result: Verifies retry backoff is called twice, second call succeeds.

## Common Issues

**Issue: "Cannot find module 'src/test/setup.ts'"**
- **Cause**: Test file is in wrong directory or import path is incorrect.
- **Fix**: Verify test file is at `src/<module>/__tests__/` and import uses `../../../test/setup` (adjust depth based on nesting). Check `src/test/setup.ts` exists.

**Issue: "ReferenceError: mockLlmCall is not defined"**
- **Cause**: Setup function not imported or not exported from `setup.ts`.
- **Fix**: Add to test: `import { mockLlmCall, cleanupMocks } from '../../../test/setup'`. Verify `src/test/setup.ts` exports these functions.

**Issue: "ANTHROPIC_API_KEY not found" (real API call attempted)**
- **Cause**: Mock was not set up before calling LLM function.
- **Fix**: Call `mockLlmCall()` before invoking function. Set `process.env.ANTHROPIC_API_KEY = 'test-key'` in `beforeEach()`.

**Issue: "Test timeout exceeded"**
- **Cause**: Mock promise never resolves or LLM call is not properly mocked.
- **Fix**: Verify `mock.mockResolvedValue(...)` or `mock.mockRejectedValue(...)` is called before async function. Add `{ timeout: 10000 }` to `it()` if needed: `it('test name', async () => {...}, { timeout: 10000 })`.

**Issue: "Coverage threshold not met (expected 80%, got 65%)"**
- **Cause**: Error handling or edge case branches not tested.
- **Fix**: Run `npm run test:coverage`, open `coverage/src/llm/index.html`, find red lines, add test cases. For unreachable code, add `/* c8 ignore next 3 */` above lines.

**Issue: "Mock called but assertion says 0 times"**
- **Cause**: Mock was not passed to the function being tested, or module was not reloaded.
- **Fix**: Verify mock is imported from setup and function calls `llmCall()` from `src/llm/index.ts`. Check that setup exports and test imports use consistent module resolution.