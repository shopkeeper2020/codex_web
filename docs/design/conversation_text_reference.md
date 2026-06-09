# 会话文本引用交互设计

更新时间：2026-06-09

本文记录 `codex_web` 会话区文本引用功能的前端设计。目标是复刻官方 Codex Desktop 的选择文本交互：用户在会话区选中文本后，出现“添加到对话”和“在侧边聊天中提问”两个动作；被添加的文本以 Composer 上方的引用片段 chip 展示，并在发送时合入本次用户请求。


## 1. 临时参考图

- 参考图 A：绝对路径 `C:/Users/user/AppData/Local/PixPin/Data/2026-06-08_15-53-14-0.png`。展示 Web 与官方 Desktop 并排对照。重点是主聊天选区附近的浮动动作条、主 Composer 上方“已选文本片段”chip，以及发送后用户消息中 `# Selected text:` / `## My request for Codex:` 的拼接效果。
- 参考图 B：绝对路径 `C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-08_15-54-50.png`。重点是官方 Desktop 右侧栏打开侧边聊天后，侧边聊天 Composer 上方同样展示“1 个已选文本片段”chip。
- 参考图 C：绝对路径 `C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-08_16-32-39.png`。重点是鼠标悬停在引用 chip 上时的预览浮层：每段引用用英文双引号包围，并在 chip 右侧显示清除按钮。
- 参考图 D：源文件绝对路径同参考图 A：`C:/Users/user/AppData/Local/PixPin/Data/2026-06-08_15-53-14-0.png`，对应 A 图右侧 Desktop 会话区的局部效果。重点是用户消息气泡上方/气泡内靠前位置显示 `2 个已选文本片段` chip，下面显示用户请求文本。
- 参考图 E：本次对话内第五张裁剪图，展示会话区引用 chip 的鼠标悬停效果。重点是 hover 时弹出小型预览浮层，每段被引用文本用英文双引号包围，样式与 Composer hover 预览保持一致。当前未在 `C:/Users/user/AppData/Local/PixPin/Data`、`C:/Users/user/AppData/Local/PixPin/Temp`、`C:/Users/user/AppData/Local/OpenAI` 中匹配到本地绝对路径；如果后续要长期回看，需要先另存该裁剪图并补入绝对路径。
- 参考图 F：绝对路径 `C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-09_09-21-28.png`。重点是官方 Desktop 允许用户手动在 Composer 中输入 `# Selected text:` / `## Selection 1` / `## My request for Codex:` 结构。
- 参考图 G：绝对路径 `C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-09_09-21-33.png`。重点是手动输入上述结构后，Desktop 仍按引用消息渲染：显示 `1 个已选文本片段` chip，并在下方显示用户请求文本。
- 参考图 H：绝对路径 `C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-09_09-22-18.png`。重点是官方 Desktop 允许只有引用、没有用户请求文本的 Composer 内容。
- 参考图 I：绝对路径 `C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-09_09-22-31.png`。重点是只有引用、没有用户请求文本时，Desktop 发送后只显示引用 chip，不显示空的用户请求气泡。

![参考图 A：Web 与 Desktop 并排对照](C:/Users/user/AppData/Local/PixPin/Data/2026-06-08_15-53-14-0.png)

![参考图 B：侧边聊天 Composer 文本引用 chip](C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-08_15-54-50.png)

![参考图 C：引用 chip hover 预览和清除按钮](C:/Users/user/AppData/Local/PixPin/Temp/PixPin_2026-06-08_16-32-39.png)

## 2. 目标

1. 在主聊天区和侧边聊天区的消息文本上选择内容时，显示 Desktop-like 浮动动作条。
2. 点击“添加到对话”后，把当前选区加入选区来源所在 Composer：主聊天选区进入主 Composer，侧边聊天选区进入当前侧边聊天 Composer。
3. 点击“在侧边聊天中提问”后，优先复用当前已打开的侧边聊天；没有可复用侧边聊天时再创建一个新的侧边聊天 tab，并把当前选区加入该侧边聊天 Composer 的本地引用片段列表。
4. 主聊天和侧边聊天使用同一套引用 chip、移除、发送拼接规则。
5. 本次改动保持纯前端：不新增后端 API、不修改 app-server / official IPC / raw RPC shape、不写 SQLite。

## 3. 非目标

- 不改变官方 `sideConversation` 的创建和发送协议。
- 不把引用片段做成附件、文件、SQLite 记录或新的 domain message item。
- 不在普通 UI 暴露 owner/follower、raw IPC 或 app-server 私有字段。
- 不支持跨浏览器刷新后的引用片段恢复；引用片段是 Composer 草稿级本地状态。
- 不在本轮实现复杂富文本引用、锚点跳转、高亮回放或引用来源长期追踪。
- 不限制引用数量和文本长度；第一版按用户选择的完整文本发送。
- 不处理引用正文中恰好包含 `## Selection N` 行时的分隔符碰撞；本轮只对齐 Desktop 当前可见渲染行为。

## 4. 参考依据

- `docs/official_first_implementation.md`：新增功能优先核对官方能力；本功能是 Desktop UI 交互复刻，发送仍复用已有官方路径。
- `docs/ui_fidelity.md`：聊天视口和 Composer 是核心验收面，右侧栏侧边聊天应复用主聊天渲染 turns。
- `docs/design/conversation_streaming_output.md`：主聊天和侧边聊天都通过 `renderTurnItems` 渲染稳定 domain model，不直接依赖官方 raw shape。
- 当前前端实现：`ChatMain` 管主聊天滚动、右侧栏 tab 和 `SideChatPane`；`Composer` 管输入、附件、Skills、模型、权限和发送；`SideChatPane` 已复用 `renderTurnItems` 与 `Composer`。

## 5. 分层边界

```text
用户选择会话区文本
        |
        v
apps/web ChatMain / SideChatPane
  - 监听 selectionchange
  - 判断选区是否落在会话 transcript 内
  - 生成本地 TextReference
  - 打开浮动动作条
        |
        v
apps/web Composer
  - 展示已选文本片段 chip
  - 支持移除 / 清空
  - 发送时把引用片段格式化进 text
        |
        v
现有前端发送入口
  - 主聊天：sendMessage / sendDraftMessage
  - 侧边聊天：sendSideConversationMessage
        |
        v
现有后端与官方路径
```

前端允许做的事：

- 使用 `window.getSelection()` 读取当前浏览器选区。
- 将选中文本保存为 Composer 草稿级本地状态。
- 在发送前把引用片段和用户输入拼成一个普通 `text` 字符串。
- 复用已打开的侧边聊天，或调用既有 `onCreateSideChat(projectRoot)` 新建侧边聊天，再用既有 `onSendSideChat` 发送。

前端不允许做的事：

- 新增 raw protocol 字段，例如把引用片段作为自定义 payload 下发。
- 把引用片段写入本地 SQLite 或官方会话缓存。
- 修改 `packages/domain` 的消息模型来伪造官方 item。
- 为侧边聊天自建 Web 私有 thread。

## 6. 数据模型

前端新增本地 UI 类型：

```ts
type TextReference = {
  id: string
  text: string
  preview: string
  sourceThreadId: string | null
  sourceSurface: 'main' | 'side'
  sourceSideConversationId?: string | null
  createdAtMs: number
}
```

说明：

- `id` 使用前端本地生成值，只用于 React key 和删除。
- `text` 保存完整选中文本，发送时使用。
- `preview` 用于 chip 或 popover 展示，可截断。
- `sourceThreadId` 和 `sourceSideConversationId` 仅用于前端判断 thread 切换、调试和未来扩展；不随请求发送。
- 不做去重。每一次“添加到对话”或“在侧边聊天中提问”动作都生成一个新的 selection；用户重复添加同一段文本时，按添加顺序形成 `Selection 1 / Selection 2`。
- 不按消息、表格行或代码块自动拆分。即使一次选区跨越多条消息或多个块，也作为 1 个 selection 保存。

状态建议放在 `ChatMain`：

```ts
const [mainTextReferencesByThreadId, setMainTextReferencesByThreadId] =
  useState<Record<string, TextReference[]>>({})

const [sideTextReferencesByConversationId, setSideTextReferencesByConversationId] =
  useState<Record<string, TextReference[]>>({})
```

这样 `ChatMain` 可以同时处理选区动作、主 Composer props，以及复用或新建侧边聊天后的引用注入。`Composer` 只负责展示和发送，不负责决定引用来自哪里。

## 7. 选区动作条

触发条件：

- 当前 `Selection` 非折叠。
- 至少有一个 `Range` 的 `commonAncestorContainer` 落在主聊天 `.chatColumn` 或侧边聊天 `.sideChatTranscript` 内。
- 选区文本 `trim()` 后非空。
- 当前焦点不在 textarea、input、button、menu、dialog 或 Composer 内。
- 支持所有会话可选文本来源：user/assistant 正文、Markdown 表格、代码块、命令输出、文件 diff、reasoning、tool output、unknown fallback 等。只要浏览器能选中文本，且选区落在会话 transcript 内，就允许引用。

隐藏条件：

- 选区折叠或文本为空。
- 用户点击动作条以外的位置并导致选区消失。
- thread 切换、右侧栏关闭、侧边聊天 tab 切换。
- `Escape`。
- 当前 transcript 滚动后选区 rect 不再可定位。

定位规则：

- 使用 `selection.getRangeAt(0).getBoundingClientRect()` 和最后一个 range rect 计算锚点。
- 默认显示在选区上方居中；空间不足时显示在选区下方。
- 水平方向限制在当前 viewport 内，避免遮挡右侧栏边界或页面溢出。
- 使用 portal 渲染到 `document.body`，层级使用 popover 级别，视觉上贴近截图中的小 pill。

视觉规则：

- 容器为浅色浮动 pill，轻微阴影，圆角 `999px`。
- 两个按钮横向排列，图标加短文案。
- 文案使用 i18n key：
  - `textReference.actions.addToConversation`
  - `textReference.actions.askInSideChat`
- 建议图标：
  - “添加到对话”：`MessageSquare` 或 `Plus` + `MessageSquare`。
  - “在侧边聊天中提问”：`PanelRightOpen` 或 `MessagesSquare`。

## 8. 添加到对话

点击“添加到对话”：

1. 从当前选区生成 `TextReference`。
2. 判断选区来源：来自主聊天时加入当前 thread 对应的 `mainTextReferencesByThreadId[selectedThreadId]`；来自侧边聊天时加入当前 side conversation 对应的 `sideTextReferencesByConversationId[sideConversation.id]`。
3. 清除或收起选区动作条。
4. 聚焦目标 Composer textarea。
5. 目标 Composer 上方展示 `N 个已选文本片段` chip。

Composer chip 行为：

- chip 位置在 Composer 输入文本上方，和附件托盘同层级，但不伪装成文件附件。
- 默认只展示计数：`1 个已选文本片段` / `2 个已选文本片段`。
- 桌面端鼠标悬停或键盘 focus chip 时显示预览浮层；浮层按 selection 添加顺序逐行展示，每一段文本都用英文双引号包围，例如 `"到对话会进"`。
- 点击 chip 可固定/展开预览每段引用内容，按 `Selection 1 / Selection 2` 顺序展示；移动端没有可靠 hover，点击就是主要展开方式。
- 长文本不丢失，预览区内部可滚动或折叠，发送仍使用完整文本。
- chip 右侧提供一个 `X`，hover/focus 时必须清晰可见；点击后清空当前 Composer 的全部引用片段。第一版不做单条 selection 删除。
- 引用片段随 Composer draft 保留在当前 thread 或 side conversation 内；切换 thread/tab 后不显示其他 Composer 的引用，切回时仍可恢复。
- 发送成功后清空当前 Composer 的引用片段。

## 9. 在侧边聊天中提问

点击“在侧边聊天中提问”：

1. 从当前选区生成 `TextReference`。
2. 如果当前已经打开并激活了一个侧边聊天 tab，优先复用该 side conversation。
3. 如果没有可复用的侧边聊天 tab，则调用现有 `onCreateSideChat(projectRoot)` 创建新的官方 side conversation，并用现有 `createRightSidebarTab("chat", { sideConversationId, sideConversation, keepMissingSideConversation: true })` 打开新的侧边聊天 tab。
4. 将引用片段写入目标 `sideTextReferencesByConversationId[sideConversation.id]`。
5. 打开右侧栏并激活目标 tab。
6. 聚焦侧边聊天 Composer textarea。

注意：

- “可复用侧边聊天”指当前右侧栏内已打开、已激活、类型为 `chat` 且绑定当前主 thread 的 tab；其他文件/浏览器/审查 tab 不参与复用。
- 如果右侧栏内已有多个侧边聊天 tab，但当前激活 tab 不是聊天 tab，第一版优先复用最近一个属于当前 thread 的聊天 tab；若没有则新建。
- 侧边聊天 transcript 继续使用 `renderTurnItems`，展示效果与主聊天一致。
- 侧边聊天发送继续走 `onSendSideChat(sideConversationId, text, attachmentIds, options)`。
- 如果侧边聊天创建失败，保留当前选区上下文并在右侧栏 launcher 错误区或 toast 显示已有的 `rightSidebar.chat.createFailed` 文案；不 fallback 到 Web 私有 thread。

## 10. Composer 发送拼接

`Composer` 新增 props：

```ts
type ComposerTextReference = {
  id: string
  text: string
  preview: string
}

type ComposerProps = {
  textReferences?: ComposerTextReference[]
  onRemoveTextReference?: (id: string) => void
  onClearTextReferences?: () => void
}
```

发送时，`submitCurrentMessage()` 在调用 `onSend` 前把引用片段合入 `text`：

```ts
function formatReferencedPrompt(userText: string, references: ComposerTextReference[]): string {
  const request = userText.trim()
  if (references.length === 0) return request

  const selectedText = references
    .map((reference, index) => `## Selection ${index + 1}\n${reference.text.trim()}`)
    .join('\n\n')

  return [
    '# Selected text:',
    selectedText,
    '',
    '## My request for Codex:',
    request,
  ].join('\n')
}
```

这个格式刻意沿用截图中的英文标题，避免中文 UI 下改变 Codex 已有提示结构。后续如果确认官方 Desktop 在所有语言下都使用另一种格式，应以 Desktop 实测为准调整。

识别规则：

- 发送后的消息展示不能只识别 Web 自己通过选区动作生成的引用。凡是普通用户消息文本本身符合上述 Desktop 结构，都应按引用消息渲染；即用户手动拼接 `# Selected text:` / `## Selection N` / `## My request for Codex:` 也会被识别为引用。
- 解析出的引用只影响 Web 展示和复制/编辑体验，不改变发送给官方 app-server 的普通 text 字符串。

`hasSubmitContent` 建议把引用片段计入内容：

- 有文本、附件、Skills 或引用片段任意一种时，发送按钮可用。
- 只有引用片段且用户输入为空时，允许发送，仍按上述格式发送空的 `My request for Codex`。

用户消息标题规则：

- 发送后消息在会话区的展示标题不做额外改写时，应使用用户输入内容作为标题。
- 引用片段只作为正文前置上下文，不替代用户输入标题。
- 只有引用、用户输入为空时，标题/摘要不得回退显示 `# Selected text:` 原始结构；可使用第一段引用 preview 作为本地展示兜底，或等待官方标题改写。

## 11. 用户消息展示

带引用发送后的用户消息展示也要对齐 Codex Desktop，而不是按普通 Markdown 文章渲染：

- 用户消息整体使用 Desktop-like 右侧浅灰气泡，边框弱化，圆角、内边距和最大宽度参考官方 Desktop 当前截图。
- 普通用户消息正文按纯文本展示，保留原始换行、编号和空格；不解析 Markdown/GFM。
- 符合 Desktop 引用结构的用户消息不直接铺开 `# Selected text:`、`## Selection N` 和 `## My request for Codex:` 原始脚手架；应渲染为只读引用 chip + 用户请求气泡。
- 如果用户输入内容存在，会话列表标题或消息摘要在没有官方改写标题时优先使用用户输入内容，而不是使用 `# Selected text:` 或引用片段。
- 长用户消息继续遵守现有 Desktop-like 折叠规则：默认不撑满整个视口，可展开/收起，展开后仍不造成页面级横向滚动。

会话区引用 chip 展示：

- 发送后的用户消息需要在会话区展示引用 chip，位置参考 Desktop：chip 位于用户请求文本之前，与请求文本同属用户消息气泡区域，整体右对齐。
- chip 文案仍为 `1 个已选文本片段` / `2 个已选文本片段`，左侧使用对话/文本片段图标，尺寸和 Composer 内 chip 保持一致或略微收紧。
- 用户请求文本单独显示在 chip 下方，例如参考图 D 中的 `分别列表格`，不把引用拼接格式直接铺成主视觉内容。
- 如果引用结构存在但用户请求文本为空，只显示引用 chip，不显示空白请求气泡。
- 鼠标悬停或键盘 focus 会话区引用 chip 时，显示与 Composer hover 类似的预览浮层；浮层逐行展示被引用文本，每段用英文双引号包围，例如 `"深圳"`、`"广州"`。
- 会话区引用 chip 是已发送消息的只读展示，不提供清除按钮，不允许修改已发送引用。清除按钮只存在于发送前 Composer chip。
- 如果后端/domain 目前无法从已发送纯文本中可靠还原引用片段，前端可以在本地发送成功后的当前会话渲染中保留引用展示状态；刷新或从其他客户端同步回来时，至少保证用户消息正文仍按纯文本可读。后续若 domain 能稳定解析引用结构，再把会话区 chip 作为持久可复看的展示能力。

编辑规则：

- 带引用的已发送用户消息进入编辑态时，引用 chip 仍然只读展示，不进入 textarea。
- 只有 `## My request for Codex:` 后面的用户请求气泡可以被编辑；提交时保留原引用片段，并把编辑后的请求重新拼回 Desktop 引用结构。
- 只有引用、没有用户请求文本的消息没有可编辑请求气泡，第一版不显示编辑入口。

## 12. 组件改造点

`apps/web/src/app/components/ChatMain.tsx`：

- 新增主聊天和侧边聊天的引用片段状态。
- 新增 `TextSelectionToolbar` 的挂载和 selection 监听。
- 为主 Composer 注入当前 thread 的 `textReferences`。
- 为 `DesktopRightSidebar` / `SideChatPane` 传递侧边聊天引用片段 props。
- 增加从选区复用或创建侧边聊天并注入引用的 handler。
- 为动作条记录选区来源 surface，确保“添加到对话”能落到正确 Composer。

`apps/web/src/app/components/Composer.tsx`：

- 新增引用片段 props。
- 在附件托盘和 prompt line 之间展示 `composerTextReferenceTray`。
- chip 支持 hover/focus 展示双引号包围的 selection 预览，点击可固定/展开预览，右侧 `X` 一键清空全部引用。
- `submitCurrentMessage()` 使用 `formatReferencedPrompt()` 后再调用 `onSend`。
- 发送成功后调用 `onClearTextReferences?.()`。

`apps/web/src/app/components/MessageBlocks.tsx`：

- 用户消息渲染继续按 Desktop-like 纯文本气泡展示，避免把引用拼接格式解析成 Markdown 标题。
- 对带引用的用户消息渲染会话区引用 chip 和 hover 预览；已发送消息里的 chip 只读，不显示清除按钮。
- 识别任意符合 Desktop 引用结构的用户消息，包括用户手动输入该结构的消息，不要求来源必须是 Web 选区动作。
- 引用消息进入编辑态时保留只读 chip，只把用户请求文本放入编辑器；reference-only 消息不显示空编辑气泡。
- 在没有可还原引用结构时，退回纯文本用户消息展示，不阻断消息阅读。

`apps/web/src/app/App.module.css`：

- 新增浮动动作条样式。
- 新增引用片段 chip / tray 样式。
- 确认移动端 `390px` 下 chip 不造成横向溢出。
- 侧边聊天 Composer 的引用 chip 需适配窄右侧栏。
- 移动端动作条需要进入第一版：优先保证按钮可点、位置不溢出；手机系统选择菜单造成的轻微遮挡可通过人工验收记录。

`packages/i18n/src/locales/*.json`：

- 新增动作条、chip、aria 文案的中英 key。

## 13. 状态矩阵

| 场景 | 期望 |
| --- | --- |
| 主聊天普通文本被选中 | 选区附近出现两个动作按钮 |
| 表格单元格文本被选中 | 选中文本按浏览器 selection 文本保留换行/制表结构 |
| code fence 文本被选中 | 可引用，不触发代码块复制按钮 |
| 命令输出、文件 diff、reasoning 被选中 | 可引用，按浏览器选中文本生成 selection |
| 一次选区跨越多条消息 | 作为 1 个 selection 保存，不自动拆分 |
| 选中文本后点击“添加到对话” | 主 Composer 显示 `1 个已选文本片段` |
| 从侧边聊天选中文本后点击“添加到对话” | 当前侧边聊天 Composer 显示引用 chip |
| 连续添加两段文本 | 主 Composer 显示 `2 个已选文本片段`，发送时形成 Selection 1/2 |
| 鼠标悬停或键盘 focus 引用 chip | 显示预览浮层，每段引用用英文双引号包围 |
| 点击引用 chip | 固定/展开预览 Selection 列表；移动端用点击展开 |
| 点击 chip 右侧 `X` | 清空当前 Composer 的全部引用 |
| 点击“在侧边聊天中提问”且当前已有激活侧聊 | 复用当前侧边聊天，侧边 Composer 显示引用 chip |
| 点击“在侧边聊天中提问”且没有可复用侧聊 | 新建并打开一个侧边聊天 tab，侧边 Composer 显示引用 chip |
| 侧边聊天创建失败 | 不创建 Web 私有 thread，显示创建失败 |
| 发送主 Composer | 请求 text 包含 `# Selected text:` 和用户输入，发送成功后清空引用 |
| 手动输入 Desktop 引用结构并发送 | 会话区按引用消息渲染 chip 和用户请求，不直接显示 `# Selected text:` 脚手架 |
| 发送后的普通用户消息展示 | 使用 Desktop-like 右侧浅灰气泡，正文按纯文本保留换行，不解析 Markdown |
| 发送后的用户消息带引用 | 用户消息内显示只读引用 chip，下面显示用户请求文本 |
| 发送后的用户消息只有引用、没有请求文本 | 只显示只读引用 chip，不显示空白请求气泡 |
| hover 会话区引用 chip | 显示预览浮层，每段引用用英文双引号包围，不显示清除按钮 |
| 编辑带引用的用户消息 | 引用 chip 只读保留，编辑器只编辑用户请求文本 |
| 编辑只有引用、没有请求文本的用户消息 | 不显示编辑入口 |
| 发送侧边 Composer | 同样拼接引用文本，走现有 side conversation 发送 |
| thread 切换后切回 | 未发送的主 Composer 引用片段仍在本地草稿中 |
| 刷新页面 | 引用片段丢失，不恢复 |
| 只有引用、没有用户输入 | 允许发送，`My request for Codex` 为空；发送后只显示引用 chip |
| 移动端选择文本 | 显示动作条并可操作；系统选择菜单可能遮挡时以可用、不溢出为验收底线 |

## 14. 测试策略

单元测试：

- `formatReferencedPrompt()`：无引用、有单条引用、多条引用、空用户请求、保留换行。
- `displayTextFromReferencedPrompt()`：带引用和请求时返回请求文本；只有引用、请求为空时不返回原始脚手架，使用引用 preview 兜底。
- `normalizeSelectionText()`：trim 空白、过滤空选择、保留表格/多行文本结构。
- `formatReferencePreview()`：每段预览用英文双引号包围，保留可读截断。

组件测试：

- `Composer` 有引用片段时显示计数 chip。
- hover/focus 计数 chip 后显示每段 selection 预览，且每段被英文双引号包围。
- 点击计数 chip 后固定/展开每段 selection 预览。
- 删除引用片段后 chip 消失。
- 发送时 `onSend` 收到拼接后的 text，attachmentIds/options 不变。
- 用户消息包含引用拼接格式时，按纯文本气泡展示，不渲染成 Markdown 标题。
- 用户手动输入引用拼接格式时，同样按引用 chip + 用户请求文本展示。
- 用户消息只有引用、没有用户请求时，只显示引用 chip，不显示空白用户请求气泡。
- 编辑带引用的用户消息时，引用 chip 保持只读，编辑器只包含用户请求文本。
- 发送后的用户消息有可用引用结构时，显示只读引用 chip；hover/focus 显示双引号预览。

E2E：

- 在复杂消息 fixture 中用 `window.getSelection()` 稳定制造选区，断言动作条出现。
- 点击“添加到对话”，断言主 Composer 出现 `1 个已选文本片段`。
- 在侧边聊天 transcript 中制造选区，点击“添加到对话”，断言当前侧边 Composer 出现引用 chip。
- 输入问题并发送，拦截 `/api/domain/turn/start`，断言 text 包含 `# Selected text:`、`## Selection 1`、`## My request for Codex:`。
- 发送后断言会话区用户消息仍是 Desktop-like 用户气泡，但 `# Selected text:` 脚手架不直接出现在主视觉内容中。
- 发送后断言当前会话里的用户消息显示只读 `N 个已选文本片段` chip；hover chip 后可见 `"深圳"` / `"广州"` 这类双引号预览。
- 发送 reference-only 引用消息后，断言只显示只读引用 chip，不显示空请求气泡。
- 编辑带引用的用户消息，断言 textarea 只包含请求文本，提交后保留原引用。
- 点击“在侧边聊天中提问”，已有激活侧聊时断言复用该 tab；无可复用侧聊时断言右侧栏打开、新侧边聊天 tab 激活、侧边 Composer 出现引用 chip。
- 移动端覆盖文本选区动作条可见、按钮可点、chip 不横向溢出。

人工验收：

1. 对照参考图 A 检查主聊天动作条位置、按钮文案、主 Composer chip 和发送后用户消息格式。
2. 对照参考图 B 检查侧边聊天打开后右侧 Composer chip 的位置和窄栏适配。
3. 在真实 Desktop / Web 同步线程中发送带引用的主聊天消息，确认 Desktop 端看到的是一条普通用户消息，不出现协议异常。
4. 在真实侧边聊天中发送带引用的问题，确认侧边聊天 stream 正常同步。

## 15. 已确认产品决策

1. 所有会话区可选文本都可以引用，包括 user/assistant 正文、命令输出、代码块、表格、文件 diff 和 reasoning。
2. 每一次引用动作都生成一个 selection；跨消息选区也不拆分。
3. “添加到对话”进入选区来源所在 Composer：主聊天进主 Composer，侧边聊天进当前侧边 Composer。
4. “在侧边聊天中提问”优先复用当前已打开的侧边聊天；没有可复用侧聊时再创建。
5. 添加或打开目标 Composer 后自动聚焦输入框。
6. 只有引用片段、没有用户输入时允许发送。
7. 发送格式必须完全使用截图里的英文结构：`# Selected text:`、`## Selection N`、`## My request for Codex:`。
8. 会话展示标题如果没有改写，应使用用户输入内容作为标题。
9. 引用 chip 点击后要能展开预览每段内容。
10. chip 右侧只提供一个 `X`，点击清空全部引用；第一版不做单条删除。
11. 引用数量和长度不设限制。
12. 移动端也进入第一版实现范围。
13. 鼠标悬停引用 chip 时，预览浮层按参考图 C 展示，每段引用用英文双引号包围，并显示清除按钮。
14. 会话区用户消息内也要展示只读引用 chip；hover 时按参考图 E 展示双引号包围的引用文本，样式与 Composer hover 预览类似。
15. 用户消息展示要参照 Desktop：右侧浅灰气泡、纯文本、保留换行，不解析引用格式里的 Markdown 标题。
16. 参考图继续只保留文字说明和临时路径，提交前删除，不复制到 `docs/assets/`。
17. 用户手动拼接 Desktop 引用结构时，也应被识别为引用消息渲染；识别依据是文本结构本身，不是 Web 本地引用状态。
18. 只有引用、没有用户请求文本时，发送后只显示引用 chip，不显示空白请求气泡。
19. 编辑带引用的用户消息时，只允许编辑用户请求气泡；引用 chip 保持只读并在提交时原样保留。
20. 引用正文中包含 `## Selection N` 造成解析碰撞的问题本轮不处理。