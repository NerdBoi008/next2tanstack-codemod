# Developer Workflow

This file is for contributors working on `next2tanstack`.

## 1. Local Setup

```sh
pnpm install
```

Recommended tools:

- Node.js 20+ (repo currently runs on newer Node versions too)
- pnpm 9+

## 2. Create a Change

1. Create a branch for one focused change.
2. Update or add transforms in `src/transforms/*.ts`.
3. If needed, update orchestration in `src/run-codemod.ts` and `src/scripts/codemod.ts`.
4. Keep behavior deterministic. If behavior is ambiguous, prefer TODO comments over risky rewrites.

## 3. Add/Update Tests

Test format is fixture-based:

- `src/tests/<case-name>/input.tsx`
- `src/tests/<case-name>/expected.tsx`

Guidelines:

- Add at least one positive case for new behavior.
- Add one negative/edge case when behavior must be skipped.
- Keep fixtures minimal and focused on one behavior.

## 4. Run Validation

Run these before opening a PR:

```sh
pnpm check-types
pnpm test
```

## 5. Manual Codemod Review

Use dry-run + diff on a sample target project:

```sh
npx tsx ./src/run-codemod.ts <target-path> --dry-run --diff
```

Then apply:

```sh
npx tsx ./src/run-codemod.ts <target-path>
```

Review expectations:

- Only intended files change.
- Diff output is readable and scoped to actual hunks.
- Skipped files print clear reasons (for known blockers).

## 6. Release Readiness

Before publish:

1. Ensure `package.json` has final name: `next2tanstack`.
2. Confirm CLI entry (`bin`) and publishable file list (`files`).
3. Run:
   - `pnpm check-types`
   - `pnpm test`
   - `npm pack --dry-run`
4. Publish:
   - `npm login`
   - `npm publish --access public`

## 7. Troubleshooting

- If `pnpm test` or `pnpm check-types` fails with:
  `Cannot find module './codemod.ts' imported from scripts/run-codemod.ts`
  then restore/fix `scripts/codemod.ts` or update the import path in `scripts/run-codemod.ts`.
