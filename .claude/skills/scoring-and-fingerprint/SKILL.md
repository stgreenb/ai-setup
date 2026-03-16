---
name: scoring-and-fingerprint
description: Scoring checks and fingerprint collection for @rely-ai/caliber. Use when working on caliber score output, adding a new scoring check to src/scoring/checks/, modifying project fingerprinting in src/fingerprint/, or understanding how project context is collected. Trigger phrases: 'add check', 'scoring', 'fingerprint', 'grounding'. Do NOT use for the score command UI — see src/commands/score.ts.
---
# Scoring and Fingerprint

## Critical

- **Scoring is deterministic** — no LLM calls. All checks in `src/scoring/checks/` must derive results from fingerprint data only.
- **Scoring checks return a `ScoringCheckResult`** (see `src/scoring/constants.ts`): `{ name: string; weight: number; score: number; reasons: string[] }`
- **Fingerprint data flows through `src/fingerprint/index.ts`** — git, file-tree, code-analysis, and existing configs are collected, then passed to `llmCall` for enrichment.
- **Test every new check** with `npm run test -- src/scoring/__tests__/` before submission.
- **Never modify constants in `src/scoring/constants.ts`** without running the full test suite — scoring weights are interdependent.

## Instructions

### Adding a New Scoring Check

1. **Create the check file** at `src/scoring/checks/<check-name>.ts`
   - Export a named function: `export async function check<CheckName>(fingerprint: Fingerprint): Promise<ScoringCheckResult>`
   - Import types: `import { Fingerprint, ScoringCheckResult } from '../types'`
   - Verify the fingerprint has the data you need (e.g., `fingerprint.files`, `fingerprint.gitMetadata`, `fingerprint.existingConfigs`) before proceeding to the next step.

2. **Implement deterministic logic**
   - Use only data from the `Fingerprint` object (no LLM, no file I/O, no external APIs)
   - Scoring runs synchronously; keep logic fast (< 100ms per check)
   - Return reasons as user-facing strings explaining why the score is what it is
   - Example: `reasons: ['CLAUDE.md exists and is 500+ lines', 'No .cursor/rules/ detected']`

3. **Export the check from `src/scoring/checks/index.ts`**
   - Add: `export { check<CheckName> } from './<check-name>'`
   - Update the import list and ensure TypeScript compiles: `npx tsc --noEmit`

4. **Register in `src/scoring/constants.ts`**
   - Add to `DEFAULT_CHECKS` array (only if it should run by default)
   - Add weight (0–1): e.g., `{ name: 'freshness', weight: 0.15 }`
   - Verify weights sum to ≤ 1.0 across all checks before proceeding.

5. **Write tests** in `src/scoring/__tests__/<check-name>.test.ts`
   - Use `describe('<check-name>')` and mock fingerprint fixtures
   - Test edge cases: missing data, empty lists, edge values
   - Run: `npm run test -- src/scoring/__tests__/<check-name>.test.ts`

### Modifying Fingerprint Collection

1. **Understand the fingerprint pipeline** in `src/fingerprint/index.ts`
   - Sequence: git metadata → file tree → existing configs → code analysis → LLM enrichment
   - Each step's output feeds the next; verify the input contract before writing the step.

2. **To add a new fingerprint field**
   - Update the `Fingerprint` type in `src/fingerprint/types.ts`
   - Add collection logic to the relevant file (`git.ts`, `file-tree.ts`, `code-analysis.ts`, or `existing-config.ts`)
   - Call it from the orchestrator in `src/fingerprint/index.ts` in the correct sequence
   - Verify that all scoring checks that depend on this field still have data: `npm run test -- src/scoring/`

3. **To modify code-analysis**
   - Edit `src/fingerprint/code-analysis.ts`
   - Enrich with LLM if needed: pass results to `src/ai/detect.ts` (framework detection)
   - Verify `detectFramework()` output matches the pattern in existing tests before proceeding.

4. **Run the full fingerprint test**
   - `npm run test -- src/fingerprint/__tests__/`
   - Ensure the output shape matches the `Fingerprint` type exactly.

## Examples

### Example 1: Add a "Grounding" Check

**User says:** "Add a scoring check that verifies AGENTS.md or SKILLS.md exist and are not empty."

**Actions:**

1. Create `src/scoring/checks/grounding.ts`:
   ```typescript
   import { Fingerprint, ScoringCheckResult } from '../types';
   
   export async function checkGrounding(fingerprint: Fingerprint): Promise<ScoringCheckResult> {
     const hasAgents = fingerprint.existingConfigs?.['AGENTS.md']?.exists && 
       (fingerprint.existingConfigs['AGENTS.md'].content?.length ?? 0) > 100;
     const hasSkills = fingerprint.existingConfigs?.['SKILLS.md']?.exists && 
       (fingerprint.existingConfigs['SKILLS.md'].content?.length ?? 0) > 100;
     
     const score = (hasAgents ? 0.5 : 0) + (hasSkills ? 0.5 : 0);
     const reasons = [
       hasAgents ? 'AGENTS.md exists and > 100 chars' : 'AGENTS.md missing or empty',
       hasSkills ? 'SKILLS.md exists and > 100 chars' : 'SKILLS.md missing or empty'
     ];
     
     return { name: 'grounding', weight: 0.1, score, reasons };
   }
   ```

2. Export from `src/scoring/checks/index.ts`: `export { checkGrounding } from './grounding'`

3. Add to `src/scoring/constants.ts`: `{ name: 'grounding', weight: 0.1 }` in `DEFAULT_CHECKS`

4. Write test in `src/scoring/__tests__/grounding.test.ts`:
   ```typescript
   import { checkGrounding } from '../checks/grounding';
   import { Fingerprint } from '../types';
   
   it('returns 1.0 if both AGENTS.md and SKILLS.md exist', async () => {
     const fp: Fingerprint = {
       existingConfigs: {
         'AGENTS.md': { exists: true, content: 'x'.repeat(150) },
         'SKILLS.md': { exists: true, content: 'x'.repeat(150) }
       }
     };
     const result = await checkGrounding(fp);
     expect(result.score).toBe(1.0);
   });
   ```

5. Run: `npm run test -- src/scoring/__tests__/grounding.test.ts` — verify pass.

**Result:** New check is registered and runs in `caliber score` output.

### Example 2: Add Git Commit Count to Fingerprint

**User says:** "Collect the number of commits in the last 30 days for freshness scoring."

**Actions:**

1. Update `src/fingerprint/types.ts`: Add `recentCommitCount?: number` to `Fingerprint`.

2. Modify `src/fingerprint/git.ts`:
   ```typescript
   export async function fingerprintGit(repoPath: string): Promise<GitMetadata> {
     // ... existing code ...
     const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
     const recentCommits = await execa('git', ['rev-list', '--count', '--since=' + thirtyDaysAgo.toISOString().split('T')[0], 'HEAD'], { cwd: repoPath });
     return {
       // ... existing fields ...
       recentCommitCount: parseInt(recentCommits.stdout, 10)
     };
   }
   ```

3. In `src/fingerprint/index.ts`, assign to fingerprint: `fingerprint.recentCommitCount = gitMetadata.recentCommitCount`

4. Update any checks that use freshness: `src/scoring/checks/freshness.ts` now has access to `fingerprint.recentCommitCount`.

5. Test: `npm run test -- src/fingerprint/__tests__/ src/scoring/__tests__/freshness.test.ts`

**Result:** Fingerprint now includes recent commit data; freshness check can use it.

## Common Issues

**"ScoringCheckResult type not found"**
- Verify import: `import { ScoringCheckResult } from '../types'`
- Check `src/scoring/types.ts` exports the type: `export interface ScoringCheckResult { name: string; weight: number; score: number; reasons: string[] }`

**"Scoring check tries to read files or call LLM"**
- Scoring MUST be deterministic. Remove all `fs.readFile()`, `fs.existsSync()`, `llmCall()`, or HTTP calls.
- All data must come from the `Fingerprint` parameter passed in.

**"Test fails: 'fingerprint.existingConfigs is undefined'"**
- The fingerprint fixture is incomplete. In the test, mock the full structure:
  ```typescript
  const fp: Fingerprint = { existingConfigs: {}, files: [], gitMetadata: {}, codeMetadata: {} };
  ```
- Verify the fixture matches the shape in `src/fingerprint/types.ts`.

**"npm run test -- src/scoring/ fails with weight sum > 1.0"**
- Open `src/scoring/constants.ts`
- Sum all `weight` values in `DEFAULT_CHECKS`
- Reduce individual weights so total ≤ 1.0
- Run: `npm run test -- src/scoring/constants.test.ts`

**"New fingerprint field not available in scoring check"**
- Verify the field is added to `Fingerprint` type in `src/fingerprint/types.ts`
- Verify it is assigned in `src/fingerprint/index.ts`: `fingerprint.newField = ...`
- Run: `npm run test -- src/fingerprint/__tests__/` to confirm collection works
- Then use in check: `fingerprint.newField`