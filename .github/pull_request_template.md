## Summary
<!-- 改了什么，为什么 -->

## Test plan
- [ ] **GitHub Actions 全绿**（未通过则**不得合并**；required checks：`repo checks (constraints)`、`mobile (typecheck + lint + test)`、`cli (build + test)`、`cli (serve e2e)` —— 见 [`docs/runbooks/github-pr-merge-policy.md`](docs/runbooks/github-pr-merge-policy.md)）
- [ ] 本地已跑过等价验证（`bash scripts/test-all.sh` 或 `cargo test` + `cargo test --test e2e_tests` + `pnpm typecheck` + `pnpm test`）
- [ ] 手动验证：...

## Boundary review
- [ ] 若新增或扩展 `mobile/src/features/*/index.ts` public export，已说明跨 feature 使用者与理由；若不涉及，请标记 N/A

## Risk
<!-- 潜在影响范围、需要注意的地方 -->
