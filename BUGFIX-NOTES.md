# dsh-vision 排障记录（2026-08-15）

本文档记录 DeepSeek Harness 加载本插件时连续遇到的两个启动错误，供后续排查同类问题时参考。

## 环境

- 插件包名：`@linenxi-ctrl/dsh-vision`
- 需要同步的副本（修改代码时三处都要改）：
  - `C:\Users\Administrator\Documents\插件\dsh-vision\lib\client.js`
  - `C:\Users\Administrator\.dsh\dsh-vision\lib\client.js`
  - `C:\Users\Administrator\.dsh\profiles\web\node_modules\@linenxi-ctrl\dsh-vision\lib\client.js`

## Bug 1：package.json 带 UTF-8 BOM

### 现象

Harness 启动报：

```text
Error: dsh: plugin tree failed to load: loader fibers failed
...
Unexpected token '﻿', "﻿{
    "n"... is not valid JSON
```

### 原因

`package.json` 被保存成“UTF-8 with BOM”，文件最开头多了不可见字符 `U+FEFF`（字节 `EF BB BF`）。Harness 的 typert-loader 用严格 `JSON.parse` 读插件清单，BOM 不是合法 JSON 起始字符，因此解析失败。报错里的 `"n"...` 正是清单中的 `"name"` 字段。

### 修改

去掉 BOM，保留文件内容不变。验证方式：文件前三个字节应为 `7B 0D 0A`（`{` + CRLF），而不是 `EF BB BF`。

```powershell
$bytes = [System.IO.File]::ReadAllBytes('package.json')
($bytes[0..2] | ForEach-Object { $_.ToString('X2') }) -join ' '
```

### 注意

- 本项目后续所有 `.json` 文件一律以 **UTF-8 无 BOM** 保存（编辑器里应显示 `UTF-8`，而不是 `UTF-8 with BOM`）。
- 报错中的内容片段可以用来反查文件：`"n"...` 对应 `"name"`，说明被解析的就是这份清单。

## Bug 2：client bundle 注册 id 不是包名

### 现象

BOM 修好后，启动继续报：

```text
Failed to load plugins
failed to import loader entry ... (@linenxi-ctrl/dsh-vision):
client-modules: bundle /plugins/@linenxi-ctrl/dsh-vision/client.js?rev=...
loaded without registering "@linenxi-ctrl/dsh-vision" via **ModuleLoader**.load
```

### 原因

Harness 的客户端模块系统以 **package.json 里的完整包名**作为模块 id。加载 `client.js` 后，`client-modules` 会检查 `window.__ModuleLoader__` 是否注册了同名 id。

原代码写的是短 id：

```js
window.__ModuleLoader__.load({
  id: 'dsh-vision',
  // ...
});
```

而 Harness 等待的是：

```text
@linenxi-ctrl/dsh-vision
```

id 不匹配，所以 bundle 执行成功却没有产生对应注册，于是报 “loaded without registering ...”。

### 修改

把三份 `lib/client.js` 的注册 id 都改成完整包名：

```js
window.__ModuleLoader__.load({
  id: '@linenxi-ctrl/dsh-vision',
  // ...
});
```

### 注意

- Harness 官方客户端插件的注册 id 都是完整包名，例如 `@deepseek-ai/dsh-client-locale`。
- 修改后必须同步所有副本。Harness 的 bundle URL 带 `?rev=`，文件内容变化后 rev 会变化，正常重启即可，不需要手动清缓存。
- 检查是否还有旧 id 残留：

```powershell
rg -l "id: 'dsh-vision'" C:\Users\Administrator\.dsh
```

正常结果应为无输出。

## 本次修改清单

- `package.json`：去除 BOM（源码 + `C:\Users\Administrator\.dsh\dsh-vision`；web profile 副本本来无 BOM）。
- `lib/client.js`：`id: 'dsh-vision'` -> `id: '@linenxi-ctrl/dsh-vision'`（三处副本）。

## 验证方式

用 Harness 自带 Node 做语法检查：

```powershell
& "$env:USERPROFILE\.dsh\node-runtime\node-v24.19.0-win-x64\node.exe" --check lib\client.js
```

用 `--dump-config` 确认插件已进入 profile 配置树：

```powershell
& "$env:USERPROFILE\.dsh\node-runtime\node-v24.19.0-win-x64\node.exe" `
  "C:\Users\Administrator\Documents\插件\DeepSeek Harness\resources\host\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  --profile web --dump-config
```

输出中出现下面两行即正常：

```text
- id: vision
  name: '@linenxi-ctrl/dsh-vision'
```
