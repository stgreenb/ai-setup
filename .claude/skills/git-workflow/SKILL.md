---
name: git-workflow
description: Git commit and PR workflow for @rely-ai/caliber. Use when staging commits, writing conventional commit messages, pushing branches, or creating GitHub PRs. Trigger phrases: 'commit', 'PR', 'push', 'changelog'. Handles feature branches, conventional commits (feat/fix/docs/refactor/test/chore), and multi-step verification. Do NOT use for git hooks setup — see `caliber hooks` command instead.
---
# Git Workflow

## Critical

- **Conventional Commits Required**: All commits must follow `type(scope): description` format. Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`. Example: `feat(cli): add score command` or `fix(llm): retry backoff logic`.
- **Branch Naming**: Use `feature/`, `fix/`, `docs/` prefix. Example: `feature/new-command` or `fix/type-checking`.
- **Verification Before Push**: Run `npm run test` and `npx tsc --noEmit` to catch regressions.
- **No Direct Commits to `main`**: Always use a feature branch and create a PR.

## Instructions

1. **Create and Switch to Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```
   Verify: `git branch | grep feature/` shows your branch.

2. **Stage Changes**
   ```bash
   git add src/your-changes.ts src/types.ts
   ```
   Verify: `git status` shows staged files under "Changes to be committed".

3. **Run Tests and Type Check** (uses output from Step 2)
   ```bash
   npm run test
   npx tsc --noEmit
   ```
   Verify: Both commands exit with status 0. If tests fail, fix code and re-run before committing.

4. **Commit with Conventional Message**
   ```bash
   git commit -m "feat(commands): add new fingerprint enrichment
   
   - Extract platform detection from code-analysis.ts
   - Update LLM prompts.ts system message
   - Add test in src/fingerprint/__tests__/"
   ```
   Message format: `type(scope): description` on first line, blank line, then bullet-point details. Verify: `git log -1` shows properly formatted message.

5. **Push Branch**
   ```bash
   git push origin feature/your-feature-name
   ```
   Verify: GitHub shows "Compare & pull request" button or output confirms remote tracking branch created.

6. **Create PR via GitHub CLI or Web UI**
   ```bash
   gh pr create --title "feat(commands): add new fingerprint enrichment" \
     --body "Closes #123. Adds LLM-based platform detection to fingerprint stage."
   ```
   Or visit `https://github.com/rely-ai/caliber/pull/new/feature/your-feature-name`.
   Verify: PR title matches first line of commit message, body references issue number (if applicable).

## Examples

**Scenario: Adding a new LLM provider**

User says: "I need to add OpenAI support and commit it."

→ **Actions**:
1. `git checkout -b feature/openai-provider`
2. Create `src/llm/openai.ts` following pattern in `src/llm/anthropic.ts`
3. Update `src/llm/index.ts` to export new provider
4. Add test in `src/llm/__tests__/openai.test.ts`
5. `git add src/llm/openai.ts src/llm/index.ts src/llm/__tests__/openai.test.ts`
6. `npm run test && npx tsc --noEmit` → both pass
7. `git commit -m "feat(llm): add openai provider support\n\n- Implement OpenAI client matching LLMProvider interface\n- Support OPENAI_API_KEY and OPENAI_BASE_URL env vars\n- Add unit tests for token estimation and error handling"`
8. `git push origin feature/openai-provider`
9. `gh pr create --title "feat(llm): add openai provider support" --body "Adds OpenAI as LLM backend, resolves #456"`

→ **Result**: PR created with conventional commit, all tests passing, ready for review.

## Common Issues

**"fatal: not a git repository"**
- Verify you're in project root: `ls -la | grep .git`
- If missing, initialize: `git init` and add remote: `git remote add origin https://github.com/rely-ai/caliber.git`

**"Tests fail after commit"**
- Revert commit: `git reset HEAD~1`
- Fix code, re-run `npm run test`, then re-commit with corrected changes.

**"Branch rejected: CRLF vs LF line endings"**
- Configure git: `git config core.autocrlf input`
- Stage and recommit.

**"fatal: 'origin' does not appear to be a 'git' repository" on push**
- Verify remote: `git remote -v`
- If missing, add: `git remote add origin https://github.com/rely-ai/caliber.git`

**"Commit message rejected (pre-commit hook failed)"**
- Pre-commit hooks are configured in `.git/hooks/` via `caliber hooks` command.
- Run `npm run test` and `npx tsc --noEmit` locally to match hook checks.
- If only linting fails, run `npm run lint --fix` (if available) or fix manually.