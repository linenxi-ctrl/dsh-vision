# 任务提示词：把 dsh-vision 改造成标准 DSH npm 插件包

> 用法：把本文件全文复制给任何 AI 助手（ChatGPT / Claude / DeepSeek / 其他代码代理），
> 它不需要任何额外背景即可执行。所有关键机制均为**实测结论**，请勿偏离。

---

## 你的角色

你是 DeepSeek Harness（DSH）插件开发专家。DSH 是 DeepSeek 的开源 agent 框架
（仓库 deepseek-ai/deepseek-harness），基于 cordis 插件体系，一切皆插件：
模型、工具、沙箱、会话存储、UI、agent 循环本身都是插件。

## 项目背景

`dsh-vision` 是一个 DSH 第三方插件，功能：
1. **网页配置面板**：用户点右下角「🖼️ 识图」按钮，配置外挂识图模型的
   API 地址 / 密钥 / 模型名 / 协议（openai-chat / openai-responses / anthropic / gemini）/ 代理，
   可点「🔌 连接拉取」按钮自动拉取模型列表（列表显示协议标签，点击自动选中协议）。
2. **拖图/发图识图**：面板内「📤 发送图片给识图 AI」选图 → 发送到外挂识图模型 →
   识别文本以用户消息形式回传 DeepSeek 会话（内部 `session.prompt(content, 'queue')`）。
   页面拖拽交给 DSH 自己的逻辑，插件**不得拦截**页面级拖拽。
3. **模型自助识图**：通过 agent 工具 `screenshot` + `recognize_image`，让 DeepSeek 模型
   自己截图并调用外挂识图模型，然后拿到识别文本继续推理。

## 源码位置（重要：是中文路径）

- 主目录：`C:\Users\Administrator\Documents\插件\dsh-vision\`
- 英文副本：`C:\Users\Administrator\dsh-vision\`（为避免中文路径乱码而复制，内容应与主目录一致）

先读主目录下所有文件再动手。文件清单与职责：

| 文件 | 职责 |
|---|---|
| `package.json` | 包清单，含 `dsh.client` 声明、exports、peerDependencies（**缺 `dsh.bundle` 声明，这是本次改造核心**） |
| `lib/index.js` | host 插件：识图服务（协议适配 openai-chat/openai-responses/anthropic/gemini/custom）、HTTP 路由 `/api/vision/config|recognize|models`、`ctx.provide('vision', svc)` |
| `lib/client.js` | client 插件：网页 UI（FAB 按钮、配置面板、模型列表、loading 指示器、发送图片） |
| `lib/tool.js` | agent 工具插件：注册 `recognize_image` + `screenshot` 工具、注入系统提示词段。**零外部依赖**（不 import 任何 @deepseek-ai/* 包，手写 ToolDefinition） |
| `install.mjs` | 一键安装脚本（零依赖 Node 18+）：自动定位 DSH home、复制英文副本、写 cordis.patch.yml、建 vision preset、设默认 preset |
| `install.bat` / `install.sh` | 调用 install.mjs 的包装 |
| `vision.patch.yml` | host+client 插件挂载示例（`- insert: - id: vision / name: 'dsh-vision'`） |
| `agent.cordis.example.yml` | agent preset 示例 |
| `README.md` | 文档 |

## 本次改造目标

把 dsh-vision 从"手动复制目录 + install.mjs"的形态，改造成**可发布到 npm 的标准 DSH 插件包**，
让任何人执行 `dsh plugin --profile web add dsh-vision` 即可安装（等效于现在 install.mjs
自动完成的全部工作），并最终能进入 DSH 官方社区生态。

## 关键机制（全部实测过，违反必踩坑）

### 1. 插件加载三平面（必须分清）
- **host 插件 + client 插件**（cordis.patch.yml 挂载）：`name` 必须用**包名**
  （如 `dsh-vision`），且包必须位于 profile 的 `node_modules` 下。
  DSH 主 Loader（cordis-plugin-loader 的 EntryTree.import）**不做 pathToFileURL 转换**，
  传 Windows 绝对路径会报 `ERR_UNSUPPORTED_ESM_URL_SCHEME Received protocol 'c:'`。
- **agent 工具插件**（agent-presets 的 agent.cordis.yml 挂载）：`name` **支持绝对路径**
  （PresetTree.import 会做 pathToFileURL 转换），但 tool.js **自身不能 import 裸包**
  （如 `@deepseek-ai/dsh-tools`），否则 Node 从 tool.js 位置向上找包失败报
  "Cannot find package"。→ 所以 tool.js 保持零外部依赖。
- **agent preset 命名**：绝不能叫 `standard`（DSH 随附的 standard 会遮蔽同名用户 preset）。
  用唯一名（本项目用 `vision`），并设 `agent-presets.default: vision`（settings.yaml）。

### 2. `dsh.bundle` 声明（npm 插件包的核心，实测自已发布的 dshmarket / dsh-find-plugin）
package.json 里加：
```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" }
}
```
同时 exports 要导出该 patch 文件：
```json
"exports": {
  ".": { "default": "./lib/index.js" },
  "./client": "./lib/client.js",
  "./cordis.patch.yml": "./cordis.patch.yml",
  "./package.json": "./package.json"
}
```
机制：`dsh plugin --profile web add <pkg>` 把参数转发给 pnpm 在 profile 目录安装，
装完后 DSH 对已装依赖做 reconcile：凡 package.json 声明 `dsh.bundle.patch` 的包
自动加入该 profile 的 layer stack（`dsh.profile.bundles`），无需手动改 cordis.patch.yml。
（所以改造后，install.mjs 里"写 cordis.patch.yml"那一步对 npm 安装场景可省，
但保留也无害——要保证幂等、不重复写。）

### 3. 插件市场与 GitHub 标签（用户关心"上传官方插件库"）
- GitHub 的 `topic: dsh` / `topic: dsh-plugin` 是**社区发现约定**（官方仓库
  deepseek-ai/deepseek-harness 自己就打了这两个标签；全站 800+ 仓库带 topic:dsh），
  作用是让人/策展方能搜到，**DSH 运行时不会自动检测标签**。
- 真正的安装来源是 **npm 包**（上面第 2 点）。
- 社区市场 dsh-market（`dsh plugin --profile web add dshmarket`）只接受
  awesome-dsh-plugin 策展列表收录的来源，否则拒绝安装。收录方式：向
  github.com/awesome-dsh-plugin/awesome-dsh-plugin 提 PR（它有个
  awesome-dsh-plugin.com/plugins.json 数据源）。

### 4. 安装/验证链路
- 本地 DSH 版本 0.1.0-rc.6，`dsh` 命令来自 pnpm dlx 缓存
  （`C:\Users\Administrator\AppData\Local\pnpm-cache\dlx\...\node_modules\@deepseek-ai\dsh`，
  `lib/bin.js` 是入口）。
- 真实 DSH home：`C:\Users\Administrator\.dsh`（**测试时绝不动它**，
  用 `$env:DSH_HOME` 指向临时目录做隔离测试）。

## 具体任务清单

1. **改造 package.json**
   - 加 `dsh.bundle.patch`（如上格式），保留现有 `dsh.client` 声明。
   - 调整 exports：加 `./cordis.patch.yml`。
   - 检查 `files` 白名单，确保发布包包含 `lib/*.js`、`cordis.patch.yml`、`install.mjs`、`README.md` 等。
   - version 升到 0.2.0（或 1.0.0）。
2. **准备 cordis.patch.yml**：把 vision.patch.yml 内容整理成正式 `cordis.patch.yml`
   （`- insert: - id: vision / name: 'dsh-vision'`），作为 dsh.bundle.patch 指向的文件；
   vision.patch.yml 保留或删除由你定，README 同步更新。
3. **改造 install.mjs 支持 npm 包内自定位**：
   - 当插件位于 node_modules（npm 安装场景）时，能从自身位置定位 `@deepseek-ai/dsh`
     并完成 agent preset（vision）+ 默认 preset 设置——npm 安装后 cordis.patch.yml
     由 dsh.bundle 机制自动生效，install.mjs 只需负责 agent 工具平面；
   - 当插件是普通目录（当前场景）时，保持原全自动安装逻辑；
   - 保持零依赖、跨平台、幂等。
4. **agent 工具平面在 npm 场景下的挂载**：验证 npm 安装后（包在
   `<profile>/node_modules/dsh-vision/lib/tool.js`），preset 里 tool 的 name 用
   `dsh-vision/tool`（包名子路径）还是绝对路径可行。以实测为准，二选一并写进
   install.mjs 与 README。tool.js 零依赖原则不变。
5. **隔离测试**（用临时 DSH_HOME，禁止碰真实 `.dsh`）：
   - 搭假 DSH_HOME（profiles/web/node_modules/@deepseek-ai/dsh、config/agent-presets/standard、cordis.patch.yml、settings.yaml）；
   - `npm pack` 出 tarball → 在假 profile 里 `pnpm add <tarball>`（或 `dsh plugin --profile web add <tarball路径>`）→ 验证：
     a) reconcile 后 bundle 进入 layer（dsh --dump-config 能看到）；
     b) host 路由 /api/vision/config 可访问；
     c) agent preset vision 含 tool-vision，`agent-presets.default` 为 vision；
   - 把验证过程与结果写进 README。
6. **发布与收录**（如果用户有 npm/GitHub 账号，否则给出步骤即可）：
   - `npm publish`（注意包名 dsh-vision 是否被占用，被占则建议改名并同步所有引用）；
   - GitHub 建公开仓库，打 topic：`dsh`、`dsh-plugin`；
   - 向 awesome-dsh-plugin 提 PR 收录。
7. **README 重写**：面向两种用户——"普通用户：dsh plugin add 一键装"与
   "手动/离线用户：install.mjs"；配图与协议说明（openai-responses 用于 GPT-5.6 等）。

## 验收标准

- [ ] 在隔离的假 DSH_HOME 中，`dsh plugin --profile web add <本地tarball>` 安装后
      bundle 自动进 layer（不需要手改 cordis.patch.yml）。
- [ ] host 服务路由、client 面板按钮、agent 工具（screenshot/recognize_image）三者都工作。
- [ ] install.mjs 在"目录模式"下仍一键完成旧有流程（回归测试通过）。
- [ ] 零硬编码密钥：任何文件不含 `sk-` 开头的真实 API key（密钥只存 DSH settings，运行时读取）。
- [ ] npm pack 产物体积合理、文件清单正确。

## 红线（绝对禁止）

- **禁止修改/删除 `C:\Users\Administrator\.dsh`**（真实 DSH 配置与密钥所在），
  测试一律用 `$env:DSH_HOME` 指向临时目录，测完清理。
- 禁止把任何真实 API 密钥写进代码、README、示例配置或 commit。
- 禁止用 `$home` 作 PowerShell 变量名（保留字），测试脚本用 `$testHome` 之类。
- 禁止把插件目录复制到中文路径下作为工具挂载点（会乱码）；工具挂载用英文路径或包名。
- 不引入任何运行时依赖（保持零依赖，Node 18+ 原生能力足够）。
