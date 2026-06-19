# FlashcardApp — Claude Instructions

## Agent workflow (required for every non-trivial feature)

Every feature must go through all of these stages in order:

1. **Explore** agent — scan codebase for all affected files and existing patterns
2. **Plan** agent — design the implementation strategy before writing any code
3. **Implement** — main agent writes the code
4. **code-review** skill (`/code-review`) — review the diff for bugs and correctness
5. **verify** skill (`/verify`) — run the app and confirm the feature works end-to-end
6. **Commit + push** — immediately after verify passes, commit and push to origin/main

Skip stages only for genuinely trivial changes (e.g. single-line CSS fix). For anything involving logic, schema, or multiple files — all stages apply.

## After each feature: update docs

After committing, update the relevant docs in `docs/`:

- **`docs/features.md`** — add a bullet under the right section describing what was built
- **`docs/implementation-plan.md`** — update §5 (spec tables) and §11 (build status) if the feature changes the spec or ships a planned item
- **`docs/decisions.md`** — add an entry if a non-obvious choice was made (why this approach over alternatives)

Commit the docs update as a separate commit immediately after the feature commit.

## Commit + push rules

- Commit and push to `origin/main` after every feature — do not wait to be asked
- Never skip hooks (`--no-verify`)
- Always use parameterized SQL (`?` placeholders) — never string interpolation with user data

## Code style

- No comments unless the WHY is non-obvious
- No abstractions beyond what the task requires
- Validate at system boundaries (user input, external APIs); trust internal code
