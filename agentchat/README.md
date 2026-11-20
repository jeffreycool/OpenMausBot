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
| `packages/phone-protocol/src/wire.ts` | `WireGroup` 增可选字段 `people?: string[]`（人参与者名册，≤500 email）与 `audience?: BotVisibility`（显式房间受众，只窄不宽）；`WireGroup` 前新增 `PersonEntry`/`PeopleDirectoryResponse`（GET /api/people 人目录 wire 类型） | 原生群聊 Phase 2 A1（server 解门包）数据模型：people 服务 @人/presence/房头名册（不做权限门），audience 在派生 audienceFloor 之上显式再窄化；两字段缺省=上游行为，存量 groups.json 零迁移 | 纯 additive，保留；上游若给 WireGroup 加同名字段需对齐语义（audience 必须保持 only-narrowing） |
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
| `server/new-bot-defaults.test.ts` | 5 处 profile 精确断言增 `dirAccess: { mode: "workspace" }`（`confined` 常量）；尾部新增「the factory reply-language line」describe（zh/en/zh-tw 种子行、显式 soul 不覆盖、全局规则去重断言） | 行为变更（新 bot 默认受限 + 新 bot 出厂中文回复）的测试同步 | 上游更新这些断言时按新语义合并 |
| `server/initial-greeting.ts` | `GREETINGS`/`SETUP_REQUEST_LINES`/`SETUP_CHOICES` 三表各增 `zh`（简体）条目（`zh-tw` 原有） | 新 bot 出厂中文回复 #1：zh-CN 用户的问候/Setup 引导语/Setup 选项此前全部回退英文（byLanguage 无 zh 条目）；对齐 first-hour-words.ts 的 zh+zh-tw 双条目惯例 | 纯 additive 表项，merge 保留；上游若补 zh 条目需去重 |
| `server/workspace.ts` | `MEMORY_SEEDS` 增 `zh`（简体 MEMORY.md 种子）；`memorySeedFor` 增 `/^zh(?:-(?:hans|cn|sg))?/` 路由（排在 zh-tw 之后）；另有 `workspaceLocationsPrompt` opts 增 `writableDirs?`（见上 dirAccess 行） | 新 bot 出厂中文回复 #2 + dirAccess 提示词声明共用文件 | 纯 additive，保留；上游若补 zh 种子需去重 |
| `server/new-bot-defaults.ts` | 新增 `REPLY_LANGUAGE_LINES` 表（zh 简体/zh-tw 繁體回复语言指令）+ 导出 `newBotReplyLanguageLine(language)` + 私有 `everyBotRulesAskChinese(rules)` + `CreationApp` 接口；`resolveBotCreationDefaults` 增第三参 `app?: CreationApp`，`profile.soul === undefined` 时返回对象附带 `languageSoul` 字段（不并入 profile）；另有 `botDefaultsProfileSchema` 增 `dirAccess` 与创建时缺省注入（见上 dirAccess 行） | 新 bot 出厂中文回复 #3 + dirAccess 默认注入共用文件（注入锚点：dirAccess 之后） | `resolveBotCreationDefaults` 第三参 additive、返回对象多一个可选字段；merge 时若上游改该函数需人工合并 seed 判断（锚点：dirAccess 注入之后） |
| `server/routes/bots-create.ts` | `resolveBotCreationDefaults` 调用增第三实参（`language: () => cfg.language \|\| Intl.DateTimeFormat().resolvedOptions().locale`、`everyBotRules: () => cfg.everyBotRules`）；`store.patchBot` 落库对象 `...ordinary` 后增一行 `...(template.languageSoul ? { soul: template.languageSoul } : {})`；另有 `checkedDirAccess` 校验与 `dirAccess` 落库（见上 dirAccess 行） | 把语言信号接进创建链路 + dirAccess 创建校验共用文件；soul 行经 patchBot 在问候语之后落库，保持空 soul bot 的 Setup 卡片照常出现（问候语 offerSetup 判定发生在 store.createBot 内） | 多处小锚点（resolveBotCreationDefaults 调用 + patchBot 对象 + checkedDirAccess），merge 按锚点重放 |
| `server/routes/bots-create.test.ts` | fixture `create` 返回值从 `store.bot(id)` 改为响应体 `sent[0].body.bot`（同一 record + messages）；新增「the reply language a new bot starts with」describe（zh 落库/en 为空/Setup 卡片保留/显式 soul 与全局规则让位） | 新 bot 出厂中文回复的路由级回归测试 | 上游改动 fixture 返回值或断言时按新语义合并 |
| `server/initial-greeting.test.ts` | 问候/Setup 引导语断言增 `zh-CN`/`zh`/`zh-Hans`（简体）用例 | greeting zh 条目的测试同步 | 上游更新断言时合并 |
| `server/workspace.test.ts` | 「treats localized factory memory seeds as empty」循环增 `zh-CN`/`zh`/`zh-Hans`/`zh_SG` → `# 记忆` 用例 | memory seed zh 条目的测试同步 | 上游更新断言时合并 |
| `electron/local-secret-cipher.mjs`（新增）+ `electron/local-secret-cipher.node-test.mjs`（新增） | 本地密钥加密模块：macOS 下用 userData/local-secret.key（0600 随机 32 字节）做 AES-256-GCM（OMBS1 头格式），附迁移（legacy blob 解密→备份 .premigration→原位重写，并发重写安全）与回退（本地 key 不可用时落回 safeStorage 适配器）；非 darwin 平台原样透传 | 根治 ad-hoc 签名每次构建换代码身份→Keychain ACL 失配→每版升级弹授权窗；Electron 43.5.0 的 `safeStorage.setUsePlainTextEncryption` 在 macOS 是 no-op（源码 `SetUsePasswordV10` 仅 Linux 分支读取该标志），故自建本地密钥方案；OMBS1 blob 永不触 safeStorage，迁移后钥匙串零访问零弹窗 | fork-only 新文件，merge 时保留不上游 |
| `electron/main.mjs` | 新增 import；CREDENTIALS_FILE 后新增 `osCredentialEncryption`（safeStorage 适配器，保留 Linux basic_text 守卫）+ `credentialEncryptionFor(file)` 适配器工厂（按文件 memoize，keyFile 共享）；8 处 safeStorage 调用点改走该工厂：loadSecureCredentials / saveSecureCredentials / saveWorkspaceCredential / cloudAccountStore / accountRing.savedStore / ensureManagedDesktop 三店（company-connection/library/backup-schedule.bin） | credentials.bin、cloud-account.bin、company-connection.bin、company-library.bin、company-backup-schedule.bin 五个加密存储全部经 macOS 本地密钥迁移，钥匙串只在迁移读时访问最后一次 | 改动集中在 CREDENTIALS_FILE 常量块、五个函数/调用点的 encryption 参数替换；merge 按锚点重放（若上游新增 safeStorage 消费点需同样接走） |
| `electron/company-backup-main.node-test.mjs` | VM fixture sandbox 增一行 synthetic `credentialEncryptionFor` | 该测试以 `section()` 截取 main.mjs 的 ensureManagedDesktop 源码在 VM 里跑且 context 为白名单；main.mjs 改为立即求值 `credentialEncryptionFor(...)` 后段内引用段外标识符会 ReferenceError，补合成实现保持段自包含 | 上游重写该 fixture 时按同样意图补（一行合成适配器）；保留 |

## 原生群聊 A1 server 解门包（agentchat-server-unlock 分支，2026-11-20）

设计来源 `claudedocs/omb-group-chat-design.md`；能力基线 `claudedocs/omb-group-primitives-inventory.md` 差距 #1/#2/#3/#5/#6/#8。全部 additive，缺省=上游行为。

### 上游文件本地改动登记表增补（A1 解门包）

| 文件 | 改动 | 原因 | 上游 merge 时 |
|------|------|------|--------------|
| `packages/phone-protocol/src/wire.ts` | `WireGroup` 增 `people?: string[]`、`audience?: BotVisibility` 与 `peopleReads?: Record<string, string[]>`；`PersonEntry`/`PeopleDirectoryResponse` | 群聊数据模型（见 commit bc273cf 行）；`peopleReads` = UI seam S5（消息 id → 已读人 emails，viewer 自己除外），与 group-ui `src/state/room-reads.ts` 形状一致 | 纯 additive，保留 |
| `server/bot-visibility.ts` | 新增导出 `parsePeopleRoster`（roster 校验：ENTRY 正则+500 上限+小写去重，空=无名册）；`VisibilityGroup` 增 `audience?`；`VisibleSet.group()` 增 `viewerSees(viewer, group.audience)` 窄化判（与 audienceFloor 同时判）；构造器 `everything` 快路径把 restricted audience 计入；`memberGroup` 剥 `audience`（与 audienceFloor 同待遇，roster 保留）；`frameForMember` group 分支 member 无条件走 memberGroup | audience 只窄不宽（宽于 floor 的存量被读时交集忽略，保棘轮+roomFeeds 不变量）；member 副本不带显式受众 | 锚点：parseVisibility 之后、VisibilityGroup 接口、VisibleSet.group()、memberGroup、frameForMember case "group"；纯 additive，保留 |
| `server/store.ts` | `createGroup` setup 参增 `people?`/`audience?` 透传（audience=everyone 不落库）；`patchGroup` 白名单增 `"people" \| "audience"`（undefined=清除） | 建房带名册/受众 + PATCH 通道落库 | 两个小锚点，保留 |
| `server/index.ts` | ① `createChannel`/`updateChannel` 增 `roomRosterPatch`/`roomAudiencePatch` 助手（parsePeopleRoster/parseVisibility 校验，400 抛错；audience=everyone 视为清除）；② import `parsePeopleRoster`/`parseVisibility`/`type BotVisibility`/`createPeopleDirectory`/`createPeopleRoutes`；③ `sharedMembership()` 解门三处：run-owner `shared`（`CLOUD_TEAM!==null \|\| sharedMembership()`）、personRooms `reads`、streamView `person` 携带（`CLOUD_TEAM!==null \|\| auth.session.email`）；④ `notificationListed` reader 参对 OSS email session 生效；⑤ teamPresence 装配：`people: teamOwners.people ?? (sharedMembership() ? peopleDirectory.roster : null)`（单人 server presence 维持关闭） + `roomsOnly: CLOUD_TEAM === null` + presenceHereOf 迟绑定；⑥ ROUTES.push 增 `createPeopleRoutes({ directory: CLOUD_TEAM === null ? peopleDirectory : null })`；⑦ `noteMemberSpend` 函数 + 传入 channel/bot-message 两路由 | A1 解门包主体（run ownership #3 / presence #6 / per-person 已读+通知 #5 #8 / 人目录 API）；index.ts 热文件共 7 处锚点 | merge 按行号旁函数锚重放（createChannel、updateChannel 尾、runOwners 装配、personRooms 装配、streamView、notificationListedFor 调用、teamPresenceHost 装配、teamPresence.routes push） |
| `server/request-auth.ts` | `CLIENT_ALLOW` 增 `{ GET, /^\/api\/people$/ }` 一条 | 人目录路由对 member session 开放 | 纯 additive 一行，保留 |
| `server/routes/groups.ts` | POST /api/groups handler 增 admin 检查：body 带 `people`/`audience` 且非 admin scope → 403 | member 建房不得设名册/受众（与 PATCH clientGroupPatchViolation 同口径） | 一段插入，保留 |
| `server/routes/channels.ts` | deps 增 `noteMemberSpend?`；messages POST 在 trigger 构建后调用 | member 房间发言 spend 可见性日志 | 锚点：groupFor 之后 + trigger 行之后，保留 |
| `server/routes/bot-messages.ts` | deps 增 `noteMemberSpend?`；直聊 trigger 构建后（onBehalfOf 除外）调用 | member 直聊 spend 可见性日志 | 两个小锚点，保留 |
| `server/host/team-presence-host.ts` | `teamPerson()` 放宽为任意带 email 的非 move-in session（去 membershipAuthority==="team" 门）；deps `people` 类型放宽为结构化 `PresenceRoster`（list+onChange）；新增 `roomsOnly?` dep：`shared()` 在 roomsOnly 下仅房间（无 per-thread audiences 的 server 绝不发 bot 线程 presence——R2 隐私硬门） | presence 解门（#6）+ 隐私硬门 | 三个函数级锚点，保留 |
| `server/host/room-reads.ts` | `groupForPerson` 增 `peopleReads` 投影：房间 roster 各 email 的 read line → path 最近 50 条（对齐 DEFAULT_PAGE 消息页）的已读标记，viewer 自己 email 不出现在自己的副本；离 path 的 read line 沿 `roomUnreadFor` 同规则（时间回退，消失=全读）；无名册房间不带该字段 | UI seam S5（group-ui README 对接清单 #5：字段名与形状以 UI 为准）——wire 契约 `Record<messageId, string[]>` | 函数级锚点（readMarksFor + groupForPerson 返回行），保留 |
| `server/people-directory.ts`（新增） | 人目录模块：SignInAllowList 具名地址 ∪ 持 email 的 session；role 按 admins/members/session scopes（admin 不降级）；名字 person-names 回退 nameFromEmail；live 计算；`roster` 适配器（presence host 用） | 人目录 API（差距 #1 的 server 面） | fork-only 新文件，保留 |
| `server/routes/people.ts`（新增） | GET /api/people：仅签到 session（其余 404 客户端降级）；`you` 标记调用者；`here` 标记 presence；directory 为 null（team server）时 404 走 /api/team/people | 人目录路由 | fork-only 新文件，保留 |
| `server/people-directory.test.ts`（新增） | 名册合并/去重/角色优先级/名字回退/you+here/roster 适配 | 人目录单测 | 保留 |
| `server/routes/people.test.ts`（新增） | 路由：session 得名册+you；loopback/无目录 404；requiredScope=client | 人目录路由单测 | 保留 |
| `server/bot-visibility.test.ts` | 增 describe「a room's people roster and explicit audience」4 用例（roster 解析/audience 只窄不宽/宽于 floor 被忽略/member 帧剥 audience 留 roster） | audience 语义单测 | 保留 |
| `server/host/team-presence-host.test.ts` | 增 describe「on a self-hosted server (roomsOnly)」2 用例（无 team authority 的 email session 计入；房间帧可见 + bot 线程永不记录/下发） | presence 解门+隐私硬门单测 | 保留 |
| `server/host/room-reads.test.ts` | 增 1 用例「marks a roster room's lines with who has read them」：roster read line → peopleReads 投影、viewer 自身 email 不入自己副本、未签到 roster 项不标记、无名册房间无字段 | S5 read marks 单测 | 保留 |
| `server/group-server-unlock.e2e.test.ts`（新增） | 自托管双成员 e2e 6 用例：人目录（member 可调+you、未签到 404）；people/audience admin-only+校验+清除；audience 窄化（ADA 看不到 BOB 专属房）+member 副本无 audience 有 roster；presence（房间帧、bot 线程零帧）；run ownership（BOB stop 403 stop_not_yours、BOB 排队、ADA stop 200、排队项独立成 turn）；per-person read line + peopleReads wire 形状（S5） | 解门行为集成回归（member session 视角逐项断言） | 保留 |

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
