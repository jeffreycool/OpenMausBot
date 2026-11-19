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

