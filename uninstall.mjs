#!/usr/bin/env node
/**
 * @linenxi-ctrl/dsh-vision 卸载脚本（零依赖，Node 18+ 跨平台）
 *
 * 用法：
 *   - 目录/离线场景：在解压目录里 `node uninstall.mjs`（或双击 uninstall.bat / bash uninstall.sh）
 *   - npm 场景：先用 `dsh plugin --profile web remove @linenxi-ctrl/dsh-vision` 卸载 npm 包，
 *     再跑本脚本清理 agent preset 与默认 preset 设置
 *
 * 本脚本会：
 *   1. 定位 DSH home（DSH_HOME / ~/.dsh / ~/.deepseek-harness / ~/.local/share/dsh）
 *   2. （目录场景）删除英文副本 <DSH_HOME>/dsh-vision
 *   3. （目录场景）删除每个 profile node_modules 里的 @linenxi-ctrl/dsh-vision 与旧版 dsh-vision
 *   4. （目录场景）从每个 profile 的 cordis.patch.yml 移除 vision 挂载行（幂等）
 *   5. 删除 agent preset「vision」
 *   6. 从 settings.yaml 移除 `agent-presets.default: vision`
 *
 * 全部幂等：重复执行无副作用；未安装时直接报告并退出。
 */
import {
  existsSync, readdirSync, statSync, rmSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const PKG_NAME = '@linenxi-ctrl/dsh-vision';
const SCRIPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const IN_NODE_MODULES = SCRIPT_DIR.split(sep).includes('node_modules');

const log = (m) => console.log(m);
const section = (m) => { console.log('\n' + '='.repeat(56) + '\n' + m + '\n' + '='.repeat(56)); };

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

/** 从 cordis.patch.yml 内容中移除 vision 挂载块（含前面的注释行），幂等。 */
function removeVisionBlock(content) {
  content = content.replace(/^\uFEFF/, '');
  let out = content.replace(
    /- insert:[ \t]*\r?\n[ \t]+- id: vision[ \t]*\r?\n[ \t]+name: '@linenxi-ctrl\/dsh-vision'[ \t]*\r?\n?/g,
    '',
  );
  // 同时移除历史版本（未 scoped）的 vision 行
  out = out.replace(
    /- insert:[ \t]*\r?\n[ \t]+- id: vision[ \t]*\r?\n[ \t]+name: 'dsh-vision'[ \t]*\r?\n?/g,
    '',
  );
  // 移除关联注释行
  out = out.replace(/# @linenxi-ctrl\/dsh-vision[^\n]*\r?\n?/g, '');
  // 清理多余空行
  out = out.replace(/\r?\n{3,}/g, '\n\n').replace(/^\s*\r?\n/, '');
  return out;
}

/** 从 settings.yaml 移除 agent-presets 段里的 default: vision；段空则删除整段。 */
function removeDefaultVision(content) {
  const lines = content.split(/\r?\n/);
  let inPresets = false;
  let presetIdx = -1;
  const out = [];
  for (const line of lines) {
    if (/^agent-presets:/.test(line)) {
      inPresets = true;
      presetIdx = out.length;
      out.push(line);
      continue;
    }
    if (inPresets && /^\S/.test(line)) inPresets = false; // 段结束（新顶层键）
    if (inPresets && /^\s+default:\s*vision\s*$/i.test(line)) continue; // 跳过 default: vision
    out.push(line);
  }
  // 若 agent-presets 段只剩标题（后面是空行或文件尾），删除标题行
  if (presetIdx >= 0 && (out[presetIdx + 1] === undefined || out[presetIdx + 1].trim() === '')) {
    out.splice(presetIdx, 1);
  }
  return out.join('\n');
}

const dshHome = findDshHome();
if (!dshHome) {
  console.error('未检测到 DSH home 目录。无法继续卸载。');
  process.exit(1);
}
const profilesDir = join(dshHome, 'profiles');
const presetsDir = join(dshHome, '.agent-presets');

log(`DSH home：${dshHome}`);
log(`卸载脚本位置：${SCRIPT_DIR}`);
log(`运行场景：${IN_NODE_MODULES ? 'npm 插件（node_modules 内）' : '目录（手动/离线）'}`);

if (IN_NODE_MODULES) {
  log('');
  log('提示：npm 安装的插件请先用 `dsh plugin --profile web remove @linenxi-ctrl/dsh-vision` 卸载 npm 包；');
  log('本脚本继续清理 agent preset 与默认 preset 设置。');
}

// ── 1. 目录场景：删除英文副本 ──
if (!IN_NODE_MODULES) {
  const enDir = join(dshHome, 'dsh-vision');
  if (existsSync(enDir)) {
    rmSync(enDir, { recursive: true, force: true });
    log(`✔ 已删除英文副本：${enDir}`);
  }
}

// ── 2. 目录场景：删除 profile node_modules 副本 + cordis.patch.yml 移除 vision ──
if (!IN_NODE_MODULES && existsSync(profilesDir)) {
  for (const name of readdirSync(profilesDir)) {
    const profileDir = join(profilesDir, name);
    try { if (!statSync(profileDir).isDirectory()) continue; } catch { continue; }

    const nmDir = join(profileDir, 'node_modules');
    const scoped = join(nmDir, '@linenxi-ctrl', 'dsh-vision');
    if (existsSync(scoped)) {
      rmSync(scoped, { recursive: true, force: true });
      log(`✔ 已从 profile「${name}」删除插件文件（@linenxi-ctrl/dsh-vision）`);
    }
    const legacy = join(nmDir, 'dsh-vision');
    if (existsSync(legacy)) {
      rmSync(legacy, { recursive: true, force: true });
      log(`✔ 已从 profile「${name}」删除旧版插件文件（dsh-vision）`);
    }

    const patchPath = join(profileDir, 'cordis.patch.yml');
    if (existsSync(patchPath)) {
      const before = readFileSync(patchPath, 'utf8');
      const after = removeVisionBlock(before);
      if (after !== before) {
        writeFileSync(patchPath, after, 'utf8');
        log(`✔ 已从 profile「${name}」的 cordis.patch.yml 移除 vision 挂载行`);
      }
    }
  }
}

// ── 3. 删除 vision agent preset ──
const visionDir = join(presetsDir, 'vision');
if (existsSync(visionDir)) {
  rmSync(visionDir, { recursive: true, force: true });
  log('✔ 已删除 agent preset「vision」');
}

// ── 4. settings.yaml 移除 default: vision ──
const settingsPath = join(dshHome, 'settings.yaml');
if (existsSync(settingsPath)) {
  const before = readFileSync(settingsPath, 'utf8');
  const after = removeDefaultVision(before);
  if (after !== before) {
    writeFileSync(settingsPath, after, 'utf8');
    log('✔ 已从 settings.yaml 移除默认 preset（vision）');
  }
}

// ── 5. 总结 ──
section('卸载完成');
log('插件已卸载。重启 DSH（dsh web）后，页面右下角的鲸鱼按钮将不再出现。');
if (IN_NODE_MODULES) {
  log('');
  log('提示：如果还通过 npm 安装过（node_modules 里存在），请先执行：');
  log('  dsh plugin --profile web remove @linenxi-ctrl/dsh-vision');
}
