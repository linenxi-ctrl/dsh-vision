#!/usr/bin/env node
/**
 * @linenxi-ctrl/dsh-vision 安装脚本（零依赖，Node 18+ 跨平台）
 *
 * 两种运行场景，自动识别：
 *   A) npm 插件场景（包已通过 `dsh plugin --profile web add @linenxi-ctrl/dsh-vision` 装进
 *      profile 的 node_modules）：cordis.patch.yml 由 DSH 的 dsh.bundle 机制自动应用，
 *      本脚本只负责 agent 工具平面（创建 vision preset + 设默认 preset）。
 *   B) 目录场景（下载 zip 解压后直接 `node install.mjs`）：除 agent 工具平面外，
 *      额外完成英文副本、复制进 profile node_modules、写 cordis.patch.yml。
 *
 * 两种场景都会自动：
 *   1. 定位 DSH home（DSH_HOME / ~/.dsh / ~/.deepseek-harness / ~/.local/share/dsh）
 *   2. 创建名为 vision 的 agent preset（复制随附 standard，避免 preset 名冲突被遮蔽），
 *      并加入识图工具行（绝对路径指向本包 lib/tool.js，跨场景最稳）
 *   3. 把默认 agent preset 设为 vision（写入 settings.yaml）
 *
 * 实测要点（DSH 0.1.0-rc.6）：
 *   - host + client 插件（cordis.patch.yml）：name 必须用「包名」，插件须在 profile 的 node_modules 里
 *   - agent 工具插件（agent preset）：name 支持「绝对路径」（自动转 file:// URL）
 *   - tool.js 必须零外部依赖（不能 import @deepseek-ai/* 的裸包），否则 preset 挂载时解析失败
 *   - preset 名不能叫 standard（会被随附的 standard 遮蔽），要用不冲突的名字
 */
import {
  writeFileSync, existsSync, readFileSync, readdirSync, statSync, cpSync, mkdirSync, rmSync,
} from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const PKG_NAME = '@linenxi-ctrl/dsh-vision';
/** 是否位于 node_modules 内（npm / dsh plugin add 安装场景）。 */
const IN_NODE_MODULES = PLUGIN_DIR.split(sep).includes('node_modules');
/** 工具插件挂载点：绝对路径指向本包 lib/tool.js（两种场景都稳定）。 */
const TOOL_PATH = `${PLUGIN_DIR.split(sep).join('/')}/lib/tool.js`;

const log = (m) => console.log(m);
const section = (m) => { console.log('\n' + '='.repeat(56) + '\n' + m + '\n' + '='.repeat(56)); };

// ── 1. 定位 DSH home ──
function findDshHome() {
  const home = homedir();
  const candidates = [];
  if (process.env.DSH_HOME) candidates.push(process.env.DSH_HOME);
  candidates.push(join(home, '.dsh'));
  candidates.push(join(home, '.deepseek-harness'));
  candidates.push(join(home, '.local', 'share', 'dsh'));
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

const dshHome = findDshHome();
if (!dshHome) {
  console.error('未检测到 DSH home 目录。请先运行过 dsh（会生成 ~/.dsh），或设置 DSH_HOME 环境变量后重试。');
  process.exit(1);
}
const profilesDir = join(dshHome, 'profiles');
const presetsDir = join(dshHome, '.agent-presets');

log(`DSH home：${dshHome}`);
log(`运行场景：${IN_NODE_MODULES ? 'npm 插件（位于 node_modules 内）' : '目录（手动/离线）'}`);

// ── 2. 目录场景：英文副本 + 复制进 profile node_modules + 写 cordis.patch.yml ──
const installedProfiles = [];
if (!IN_NODE_MODULES) {
  const EN_DIR = join(dshHome, 'dsh-vision');
  if (existsSync(EN_DIR)) rmSync(EN_DIR, { recursive: true, force: true });
  cpSync(PLUGIN_DIR, EN_DIR, { recursive: true });
  log(`✔ 已复制 dsh-vision 到英文路径：${EN_DIR}`);

  if (existsSync(profilesDir)) {
    for (const name of readdirSync(profilesDir)) {
      const profileDir = join(profilesDir, name);
      if (!statSync(profileDir).isDirectory()) continue;
      const nm = join(profileDir, 'node_modules');
      if (!existsSync(nm)) continue;
      const target = join(nm, '@linenxi-ctrl', 'dsh-vision');
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      cpSync(PLUGIN_DIR, target, { recursive: true });
      installedProfiles.push(name);
      log(`✔ 已复制 dsh-vision 进 profile「${name}」的 node_modules`);
    }
  }
  if (installedProfiles.length === 0) {
    log('⚠ 未找到带 node_modules 的 profile（.dsh/profiles/*/node_modules）。');
    log('  请先运行一次 dsh（会初始化 profile），或改用 npm 方式安装。');
  }

  // 写每个 profile 的 cordis.patch.yml（幂等：已含则跳过）
  if (existsSync(profilesDir)) {
    for (const name of installedProfiles) {
      const patchPath = join(profilesDir, name, 'cordis.patch.yml');
      if (!existsSync(patchPath)) continue;
      let content = readFileSync(patchPath, 'utf8');
      if (content.includes(PKG_NAME) || content.includes('id: vision')) {
        log(`· profile「${name}」的 cordis.patch.yml 已含 vision 行，跳过`);
        continue;
      }
      const insertBlock = [
        `# ${PKG_NAME}：外挂识图插件（host 服务 + 客户端按钮，双面）`,
        '- insert:',
        '    - id: vision',
        `      name: '${PKG_NAME}'`,
        '',
      ].join('\n');
      // 修复：去掉 UTF-8 BOM（Windows 编辑器可能写入），并正确合并补丁列表
      content = content.replace(/^\uFEFF/, '');
      const trimmed = content.trim();
      if (trimmed === '' || trimmed === '[]') {
        // 空文件或空列表：整体替换为补丁列表（绝不能保留 [] 再追加 - insert:，
        // 否则 YAML 解析报 "end of the stream or a document separator is expected"）
        content = insertBlock;
      } else {
        content = trimmed.replace(/\s*$/, '') + '\n' + insertBlock;
      }
      writeFileSync(patchPath, content, 'utf8');
      log(`✔ 已在 profile「${name}」的 cordis.patch.yml 加入 vision 行`);
    }
  }
} else {
  log('· npm 场景：cordis.patch.yml 已由 dsh.bundle 机制自动应用，无需手动写入');
}

// ── 3. 找随附 preset 根目录（config/agent-presets）──
function findShippedPresetsDir() {
  // 从每个 profile 的 node_modules 解析 @deepseek-ai/dsh
  if (existsSync(profilesDir)) {
    for (const name of readdirSync(profilesDir)) {
      const profileDir = join(profilesDir, name);
      try {
        const req = createRequire(join(profileDir, 'package.json'));
        const dshPkg = req.resolve('@deepseek-ai/dsh/package.json');
        const dir = join(dirname(dshPkg), 'config', 'agent-presets');
        if (existsSync(dir)) return dir;
      } catch { /* 该 profile 解析不到，继续 */ }
    }
  }
  // 从当前进程的解析路径找
  try {
    const req = createRequire(import.meta.url);
    const dshPkg = req.resolve('@deepseek-ai/dsh/package.json');
    const dir = join(dirname(dshPkg), 'config', 'agent-presets');
    if (existsSync(dir)) return dir;
  } catch { /* 忽略 */ }
  return null;
}

// ── 4. 创建 vision preset（复制随附 standard + 加工具行）──
let presetNote = '';
const shipped = findShippedPresetsDir();
mkdirSync(presetsDir, { recursive: true });

function addToolLine(cordisPath) {
  const lines = readFileSync(cordisPath, 'utf8').split(/\r?\n/);
  if (lines.some((l) => l.includes('tool-vision') || l.includes('/lib/tool.js'))) return false;
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('- id: tool-vision');
  lines.push(`  name: '${TOOL_PATH}'`);
  lines.push('');
  writeFileSync(cordisPath, lines.join('\n'), 'utf8');
  return true;
}

const visionDir = join(presetsDir, 'vision');
if (shipped) {
  const shippedStandard = join(shipped, 'standard');
  if (existsSync(join(shippedStandard, 'agent.cordis.yml'))) {
    if (existsSync(visionDir)) rmSync(visionDir, { recursive: true, force: true });
    cpSync(shippedStandard, visionDir, { recursive: true });
    addToolLine(join(visionDir, 'agent.cordis.yml'));
    log('✔ 已创建 preset「vision」（复制自随附 standard），并加入识图工具');
    presetNote = '工具已就绪（preset「vision」）。重启后新建会话即可让模型自己截图 + 识图。';
  } else {
    presetNote = `随附 standard 不存在于 ${shippedStandard}，请手动复制一个 preset 后加：\n  - name: '${TOOL_PATH}'`;
  }
} else {
  // 找不到随附根目录：从用户目录已有 preset 复制
  const entries = existsSync(presetsDir) ? readdirSync(presetsDir).filter((n) => {
    try { return statSync(join(presetsDir, n)).isDirectory(); } catch { return false; }
  }) : [];
  const source = entries.includes('standard') ? 'standard' : entries[0];
  if (source) {
    if (existsSync(visionDir)) rmSync(visionDir, { recursive: true, force: true });
    cpSync(join(presetsDir, source), visionDir, { recursive: true });
    addToolLine(join(visionDir, 'agent.cordis.yml'));
    log(`✔ 已创建 preset「vision」（复制自用户 preset「${source}」），并加入识图工具`);
    presetNote = '工具已就绪（preset「vision」）。重启后新建会话即可让模型自己截图 + 识图。';
  } else {
    presetNote = `未找到可复制的 preset。请手动创建 .agent-presets/vision/agent.cordis.yml 并加入：\n  - name: '${TOOL_PATH}'`;
  }
}

// ── 5. 设置默认 preset = vision ──
const settingsPath = join(dshHome, 'settings.yaml');
try {
  let s = readFileSync(settingsPath, 'utf8');
  if (/agent-presets:\s*\n/.test(s)) {
    s = s.replace(/agent-presets:\s*\n(?:  default:[^\n]*\n)?/, 'agent-presets:\n  default: vision\n');
  } else {
    s = s.trimEnd() + '\n\nagent-presets:\n  default: vision\n';
  }
  writeFileSync(settingsPath, s, 'utf8');
  log('✔ 已把默认 agent preset 设为 vision（settings.yaml）');
} catch (err) {
  log(`⚠ 设置默认 preset 失败（${err.message}）。可手动在 settings.yaml 里加：\nagent-presets:\n  default: vision`);
}

// ── 6. 总结 ──
section('安装完成');
log(`DSH home：${dshHome}`);
if (installedProfiles.length) log(`已安装 profile：${installedProfiles.join('、')}`);
log('');
log('【下一步】');
log('1. 重启 DSH（关闭后重新运行：dsh web）。');
log('2. 打开网页，点右下角鲸鱼按钮，填写外挂识图模型的地址/密钥/模型名，保存。');
log('3. 在面板点「📤 发送图片给识图 AI」选图，即可识图并回传 DeepSeek。');
if (presetNote) {
  log('');
  log('【让模型自己截图识图（agent 工具）】');
  log(presetNote);
}
log('');
log('提示：目录场景移动了源目录后，重新运行 node install.mjs 即可自动重建英文副本与 preset。');
