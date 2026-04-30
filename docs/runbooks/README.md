# `runbooks/` — 操作型 SOP

回答 **"怎么做某件具体的运维/发布操作"**。

## 内容范围

- 发布流程（CLI npm 发布、iOS TestFlight）
- 调试流程（如何复现某类问题、如何抓日志）
- 应急流程（token 泄漏怎么办、SQLite 损坏怎么办）

## 命名约定

- `<topic>.md`，例如：`cli-release.md`、`ios-publish.md`、`token-rotation.md`

## 现有指针

- iOS 发布：[`../../mobile/docs/ios-publish.md`](../../mobile/docs/ios-publish.md)（co-located 在 mobile/，未迁移）
- CLI 发布：见 [`../../README.md`](../../README.md) "CLI 发布" 段，后续可独立成 `cli-release.md`

## 与 `quality/release-checklist.md` 的区别

| 维度 | `runbooks/` | `quality/` |
|------|-------------|------------|
| 性质 | "操作步骤" | "通过准则" |
| 例子 | "运行 `./scripts/publish-ios.sh`" | "发版前必须 typecheck 通过且无 console.log" |
