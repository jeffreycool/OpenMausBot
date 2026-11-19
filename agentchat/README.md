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
| `packages/phone-protocol/src/wire.ts` | `WireBot` 前新增 `BotDirAccess` 接口，`WireBot.cwd` 后新增可选字段 `dirAccess?: BotDirAccess` | bot 目录写入白名单（dir write allowlist）功能的数据模型：每 bot 写入策略（workspace/custom/open），缺省=不限，存量 bot 零影响 | 上游若有同名概念需对齐字段名；否则直接保留（纯 additive） |
| `server/contracts.ts` | `SendTurnInput.cwd` 后新增 `writableDirs?: string[]` | harness 派发点把解析后的可写目录列表传给驱动（codex=OS 沙箱、claude=权限系统、chat=提示词声明）；存在即受限 | 纯 additive，保留 |
| `server/new-bot-defaults.ts` | `botDefaultsProfileSchema` 增 `dirAccess`（botDirAccessSchema）；`resolveBotCreationDefaults` 在 profile 无 dirAccess 时注入缺省 `{ mode: "workspace" }` | 新 bot 默认受限（DESIGN.md "No new settings" 的 fork 偏离 #1，安全特性有意新增） | merge 时保留；若上游给 resolveBotCreationDefaults 加逻辑需人工合并注入点 |
| `server/routes/bot-patch.ts` | cwd 块后增 `body.dirAccess` 解析（validateBotDirAccessInput，admin-only）；loosened 数组增 `dirAccessWidens` 守卫；import 一行 | PATCH 通道校验+放宽守卫（扩可写范围需全部 bot 空闲，复用上游 loosened 机制） | 锚定 cwd 块与 loosened 块旁，merge 冲突小；保留 |
| `server/routes/bots-create.ts` | checkedCwd 旁增 `checkedDirAccess` 校验；`store.patchBot` 落库对象增 `dirAccess` 一行；import 一行 | 创建时校验并落库（复用 validate） | 保留 |
| `server/index.ts` | import `resolveWritableDirs`；直聊派发 liveBot 后算 `writableDirs` 并传入 sendTurn；房间派发 `roomWritableDirs` 同理；两处 `workspaceLocationsPrompt` 传 `writableDirs` opts | 限写不限读的派发接线 | index.ts 为热文件，改动共 5 处锚点，merge 时按行号旁锚重放 |
| `server/workspace.ts` | `workspaceLocationsPrompt` opts 增 `writableDirs?`；受限时 prompt 追加 Write boundary 声明句 | 全引擎（含 chat 驱动）的提示词级声明 | 函数签名 additive，保留 |
| `server/drivers/codex.ts` | `namedApprovalParams`/`legacyCustomApprovalParams`/`customApprovalParams` 增 `writableRoots` 参数（受限时 full 压回 workspace-write；custom 受限走 legacy fallback）；`withResolvedSandbox` 增 roots 包含校验（回报含 roots 且缺请求项才拒）；派发点两函数调用传 `turn.writableDirs`（含 spawn 处 `codexLaunch(config.cli, appServerArgs, turn.writableDirs)`）；import realpathSync | codex 引擎强制：OS 沙箱硬限制 | 驱动热文件，改动集中在 4 个函数内部+2 行调用，merge 按函数锚重放 |
| `server/drivers/codex-process.ts` | `codexLaunch` 增第三参 `writableRoots?`：受限时剥 CLI 预设 `--sandbox <v>`，并在 app-server 之后追加 `-c sandbox_mode="workspace-write"` 与 `-c sandbox_workspace_write.writable_roots=[...]` | codex-cli 0.169.0 实证：app-server 前的 `--sandbox` 是 TUI no-op、thread/start 无 sandboxPolicy、config.toml 全局 sandbox_mode=danger-full-access——三层必须用 -c 显式覆盖（真机探针：$HOME 写 operation not permitted、白名单根写成功） | 纯 additive 参数+一段受限分支，保留 |
| `server/drivers/claude.ts` | permissionMode 计算后受限封顶 acceptEdits（禁 bypass/auto）；`--add-dir` 循环；`own.permissions = { additionalDirectories }`；新增导出 `confineBotSettings`（过滤 bot 自带 settings 的写授权/越界 additionalDirectories）；`withBotSettings(botSettings, …)` 改传 `confinedSettings`；import relative/resolve | claude 引擎强制：权限系统中限制（DESIGN.md "No new asks" 偏离 #2，白名单外写入走审批） | 驱动热文件，4 处锚点+1 个新函数；`settings` 行变量名从 botSettings 改 confinedSettings 需注意 merge |
| `src/components/bot-settings/AccessSection.tsx` | import DirAccessCard；`shows("folder") && <WorkingFolder/>` 后插一行 `<DirAccessCard bot={bot}/>` | bot 面板 Access 分区卡片 | 一行插入，保留 |
| `src/components/bot-settings/sections.ts` | access 分区 keywords 增 "directory/allowlist/write access"，headingKeys 增 `botAccess.dirAccess.title` | 面板搜索可发现新卡片 | 一行注册表，保留 |
| `src/state/store.tsx` | `Bot` 接口 `cwd` 后增 `dirAccess?: BotDirAccess`（wire 重导出类型） | 前端类型 | 一行，保留 |
| `src/locales/en.json` / `src/locales/zh.json` | 新增 21 个 `botAccess.dirAccess.*` 键（en 措辞避开 "workspace"，遵守 words.test 守卫） | UI 双语文案 | 尾部追加，冲突小；其余语言包按管线回退 en |
| `src/locales/source-hashes.json` | zh 增 21 个新键的 en 哈希 | 本地化管线登记 | merge 时可整行重算（`generate-locale.mjs --record-hashes`） |
| `server/new-bot-defaults.test.ts` | 5 处 profile 精确断言增 `dirAccess: { mode: "workspace" }`（`confined` 常量） | 行为变更（新 bot 默认受限）的测试同步 | 上游更新这些断言时按新语义合并 |


## 客户端打磨（agentchat-polish 分支，2026-11-19）

### 上游文件本地改动登记表增补（polish）

| 文件 | 改动 | 原因 | 上游 merge 时 |
|------|------|------|--------------|
| `src/components/onboarding/ChiefIntro.tsx` | 新增可选 `onSkip` prop；`leave` 重构为 `(after, done)`；intro 底部新增「以后再说」按钮（`data-chief-later`，受既有 CHIEF_GUARD_MS 输入守卫约束） | 首跑引导可跳过（迭代清单 #3）：跳过即结束首跑且不创建参谋长 | 函数级锚点小改动；上游若重写 ChiefIntro 需人工合并 |
| `src/components/onboarding/WelcomeFlow.tsx` | `<ChiefIntro>` 传入 `onSkip={() => void finish("skipped", null)}` | 跳过仍走 `finish("skipped")` → `firstRunPatch` 写 `config.onboarding.completedAt`（服务端配置，重启/换设备同步后不再重弹） | 一行插入，保留 |
| `src/locales/en.json` / `src/locales/zh.json` | 新增 1 键 `onboarding.chief.later`（"Not now" / “以后再说”，对齐 mausbotWelcome.notNow 既有措辞） | 跳过按钮文案 | 尾部插入，冲突小 |
| `src/components/onboarding/ChiefIntro.test.ts` | +2 测试：Not now 触发 onSkip 且不触达 bots、Not now 同受 300ms 输入守卫 | 跳过行为测试 | 保留 |
| `src/components/Sidebar.tsx` | `BotRowProps` 新增可选 `onRename`；`botRowProps` layout Pick 加该键；`Sidebar` 内 `requestRename`（useCallback）复用给行内铅笔与 SidebarBotMenu；行名尾部新增悬停铅笔按钮（`data-bot-rename`，`group-hover:inline-flex`，icon 密度不渲染，stopPropagation 防触发行打开）；`sidebarBotMayRename` 权限门与菜单 rename 同一判定 | 重命名入口行内直接可见，免进操作菜单（迭代清单 #5）；新建 bot 首屏命名输入上游已有（IdentitySection name 字段），未重复造 | 行内插入+2 处小改；上游若改 BotRowProps/botRowProps 需人工合并 |
| `src/components/SidebarBotListItem.test.ts` | +2 测试：铅笔在列表密度渲染且 hover 可见类名正确；icon 密度与未授权时不渲染 | 行为测试 | 保留 |
| `src/locales/zh.json` | 16 处文案修正：`帐单`→`账单`；`已拒绝:`/`密码:` 半角冒号→全角；`回答,`/`已收到,` 半角逗号→全角；`「Details」`→`「详情」`（botPanel.tab.details 实际译名）；`「Add a Cloud」`→`「添加 Cloud」`（native.menu.addCloud 实际译名）；`请在 应用 → MCP 服务器 中`→`请在「应用 → MCP 服务器」中`；`设置 (在侧边栏中)`→`「设置」（在侧边栏中）`（3 处）；`所有机器人 都` 多余空格；2 处裸 `Bot`→`机器人`（术语一致） | 中文文案质量（迭代清单 #4）；已知机翻案例（码头码/主板代码/收箱件/哦 gpt-6.2-sol）在本基线不存在，全量扫描以替代 | 逐条 value 级替换，merge 冲突小；zh-tw 存在同源问题待后续 |

### 上游 PR 候选改动清单

1. **zh 文案修正 16 处**（本分支 zh.json diff 即候选补丁）：错字/术语/标点/引号引用 untranslated UI 标签，均可见于上游 zh.json。
2. **zh 完整度**：zh 缺 1091 键（settings×112、remote×65、template×62、server×57、chat×56…）回落英文；适合按前缀分批补翻的上游 PR。
3. **en `settings.welcome.subtitle` 过期**：仍含 "providers… phone, and your first bot"，与 `welcome-words.test.ts`（"no phone step, no first-bot step"）精神相悖；现行使用键是 `subtitleShort`，未用的 subtitle 属遗留文案，建议上游删除或改写。
4. **ChiefIntro 缺跳过**：上游首跑第二屏（创建参谋长）无 Not now；本分支实现可作为上游 UX PR（含 `finish("skipped")` 埋点区分）。
5. **侧栏行内重命名 affordance**：上游 rename 仅在菜单/双击（RenameTitle 已支持双击并有 tooltip）；hover 铅笔为增强候选。
