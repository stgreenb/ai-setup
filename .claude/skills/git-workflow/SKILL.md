---
name: git-workflow
description: Git commit and PR workflow for @rely-ai/caliber. Use when staging commits, writing conventional commit messages, pushing branches, or creating GitHub PRs with gh CLI.
---
# Git Workflow for caliber

Uses **conventional commits** for automated semantic versioning via CI.

## Commit Message Format

```
<type>[(scope)]: <short description under 72 chars>
```

| Type | Version bump | When to use |
|------|-------------|-------------|
| `feat:` | minor | New user-facing feature |
| `fix:` | patch | Bug fix |
| `feat!:` / `BREAKING CHANGE` | major | Removes or changes existing API/behavior |
| `refactor:` | patch | Code restructure, no behavior change |
| `test:` | patch | Adding or fixing tests |
| `chore:` | patch | Deps, tooling, config |
| `docs:` | patch | Documentation only |
| `ci:` | patch | CI/CD changes |

Scope references the affected module: `feat(scanner): detect Cursor config`

## Staging and Committing

```bash
git status
git diff src/commands/score.ts
git add src/commands/score.ts src/scoring/index.ts
git commit -m "feat(scoring): add dependency coverage check"
```

Include `Co-Authored-By: Claude <noreply@anthropic.com>` when Claude assisted.

## Before Pushing

```bash
npm run build          # Ensure TypeScript compiles
npm run test           # Ensure all tests pass
git log origin/main..HEAD --oneline
git push -u origin <branch-name>
```

Never force-push to `main` without explicit user approval.

## Creating a Pull Request

```bash
gh pr create \
  --title "feat: <short description under 70 chars>" \
  --body "## Summary
- <bullet 1>
- <bullet 2>

## Test plan
- [ ] npm run test passes
- [ ] npm run build passes
- [ ] Manually tested caliber <command>"
```

PR title must follow conventional commit format — CI reads merge commit message for semver bump.

## Checking What Will Be Published

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```
