# agentchat/

agentChat integration module for this fork. **Additive-only**: everything agentChat-related lives in this directory; no changes to `src/`, `server/`, `electron/` or other upstream files on the `agentchat` branch.

## Architecture

- agentChat server (OpenIM hub, registry, chroma memory, dispatch) stays server-side — this fork is the per-member local client/runtime.
- Phase 1 (`agentchat` branch): in-process connector module. Each agentChat group maps to a synthetic "group bot" aggregated into the existing chat view — zero UI changes.
- Phase 2 (`agentchat-group-view` branch): native group view (multi-participant bubbles, identity colors, @-highlight) following upstream DESIGN.md rules.

## Integration surface (surveyed 2026-11-18, upstream main @176f75b)

- Loopback owner trust (desktop) grants admin+client scopes on 127.0.0.1:8799; in-process module bypasses HTTP entirely.
- Upstream external-integration route subset (see `server/request-auth.ts` SERVICE_ALLOW): GET /api/bots, POST /api/bots/{id}/tasks, POST /api/bots/{id}/messages/guarded, GET /api/bots/{id}/requests/{id}, POST .../interrupt, GET /api/threads/{id}/messages.
- Skills are SKILL.md + manifest.json — agentChat skill-version platform can supply the library directly.

## Merge discipline

- Merge upstream/main into agentchat weekly. Never edit upstream files here; escalate needed upstream changes as public PRs (see enterprise/README.md philosophy: customer's own repo, never a fork).

## 上游文件本地改动登记表（上游 merge 时需重放）

| 文件 | 改动 | 原因 | 上游 merge 时 |
|------|------|------|--------------|
| `src/components/settings/settings-index.ts` | 新增常量 `AGENTCHAT_HIDE_CLOUD_BILLING = true`，并让 `plan` 页的 `when` 前置 `!AGENTCHAT_HIDE_CLOUD_BILLING &&` | 本地 fork 构建隐藏设置侧栏「方案和账单」入口（隐藏后所有 `openSettings("plan")` 入口经 `resolveSettingsTarget` 优雅降级到 Overview） | 删除该常量并还原 `when` 原条件 `!ctx.client && ctx.plan` |
| `electron/updater.mjs` | 新增常量 `AGENTCHAT_DISABLE_AUTO_UPDATE = true`，并让 `startUpdater` 早退判断前置该常量 | fork 构建的 `app-update.yml` 仍指官方 feed，自动更新会用官方版覆盖本地改动；禁用后更新器保持 idle | 删除该常量并还原 `if (!app.isPackaged)` 原判断 |
| `electron-builder.yml` | `publish.owner` 从 `milind-soni` 改为 `jeffreycool`（repo 不变） | fork 发布必须写自己仓库的 Releases；baked `app-update.yml` 也随之指 fork（fork 已禁自动更新，此配置只决定 feed 指向） | merge 时还原 `owner: milind-soni` |
| `.github/workflows/release-agentchat.yml` | 新增 fork-only 发布 workflow：`v*` tag push 触发，macos-15（arm64+x64 dmg/zip，`CSC_IDENTITY_AUTO_DISCOVERY=false` 免签名）+ windows-latest（x64 nsis/zip）双 job，产物上传本仓库该 tag 的 Release | 上游 release.yml 依赖 fork 没有的签名/公证/RELEASES_PAT secrets，无法在 fork 运行；此 workflow 复用上游同款 runner/打包脚本，仅去签名与 smoke 门禁 | fork-only，merge 时保留不还原、不上游 |

