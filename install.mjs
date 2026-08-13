#!/usr/bin/env node
/**
 * dsh-vision 一键安装脚本（零依赖，Node 18+ 跨平台）
 *
 * 用法：node install.mjs
 *
 * 实测结论（DSH 0.1.0-rc.6）：
 *  - host + client 插件（cordis.patch.yml）：name 必须用「包名」，需要把插件放进 profile 的 node_modules
 *  - agent 工具插件（agent preset）：name 支持「绝对路径」（DSH 会自动转 file:// URL）
 *
 * 本脚本会：
 *   1. 把 dsh-vision 复制进每个 profile 的 node_modules（供 host + client 插件用包名解析）
 *   2. 在每个 profile 的 cordis.patch.yml 里加 vision 行
 *   3. 尽力把 screenshot/recognize_image 工具写进 agent preset（绝对路径）
 */
import {
  writeFileSync, existsSync, readFileSync, readdirSync, statSync, cpSync, mkdirSync,
} from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const ABS = PLUGIN_DIR.split(sep).join('/'); // Windows 正斜杠，供 YAML 与 pathToFileURL
const TOOL_PATH = `${ABS}/lib/tool.js`;

const log = (m) => console.log(m);
const section = (m) => { console.log('\n' + '='.repeat(56) + '\n' + m + '\n' + '='.repeat(56)); };

// ── 定位 DSH home 与 profiles ──
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
const profilesDir = dshHome ? join(dshHome, 'profiles') : null;

// ── 1. 复制 dsh-vision 到每个 profile 的 node_modules ──
const installedProfiles = [];
if (profilesDir && existsSync(profilesDir)) {
  for (const name of readdirSync(profilesDir)) {
    const profileDir = join(profilesDir, name);
    if (!statSync(profileDir).isDirectory()) continue;
    const nm = join(profileDir, 'node_modules');
    if (!existsSync(nm)) continue; // 无 node_modules 的 profile 跳过（例如随附 profile）
    const target = join(nm, 'dsh-vision');
    cpSync(PLUGIN_DIR, target, { recursive: true, force: true });
    installedProfiles.push(name);
    log(`✔ 已把 dsh-vision 复制进 profile「${name}」的 node_modules`);
  }
}
if (installedProfiles.length === 0) {
  log('⚠ 未找到可写的 profile node_modules（.dsh/profiles/*/node_modules）。');
  log('  请先用 dsh 跑过一次你的 profile，或手动把本目录复制进 profile 的 node_modules/dsh-vision。');
}

// ── 2. 在每个 profile 的 cordis.patch.yml 加 vision 行 ──
if (profilesDir && existsSync(profilesDir)) {
  for (const name of installedProfiles) {
    const patchPath = join(profilesDir, name, 'cordis.patch.yml');
    if (!existsSync(patchPath)) continue;
    let content = readFileSync(patchPath, 'utf8');
    if (content.includes('dsh-vision') || content.includes('id: vision')) {
      log(`· profile「${name}」的 cordis.patch.yml 已含 vision 行，跳过`);
      continue;
    }
    const insertBlock = [
      '',
      '# dsh-vision：外挂识图插件（host 服务 + 客户端按钮，双面）',
      '- insert:',
      '    - id: vision',
      "      name: 'dsh-vision'",
      '',
    ].join('\n');
    if (content.trim() === '[]') {
      content = content.replace('[]', insertBlock.trim() + '\n');
    } else {
      content = content.replace(/\s*$/, '') + '\n' + insertBlock;
    }
    writeFileSync(patchPath, content, 'utf8');
    log(`✔ 已在 profile「${name}」的 cordis.patch.yml 里加入 vision 行`);
  }
}

// ── 3. 尽力写入 agent preset（绝对路径，agent-presets 原生支持） ──
let presetNote = '';
const presetsDir = dshHome ? join(dshHome, '.agent-presets') : null;
if (presetsDir) {
  try {
    mkdirSync(presetsDir, { recursive: true });
    const entries = readdirSync(presetsDir).filter((n) => {
      try { return statSync(join(presetsDir, n)).isDirectory(); } catch { return false; }
    });
    const source = entries.includes('standard') ? 'standard' : entries[0];

    if (!source) {
      presetNote = `未在 ${presetsDir} 找到可复制的 preset（standard）。请在 Web 界面「Agent Preset」里复制 standard 后，在其 agent.cordis.yml 末尾追加：\n  - name: '${TOOL_PATH}'`;
    } else {
      const targetDir = join(presetsDir, source);
      const cordisPath = join(targetDir, 'agent.cordis.yml');
      if (!existsSync(cordisPath)) {
        presetNote = `未在 preset「${source}」找到 agent.cordis.yml，请手动在其末尾追加：\n  - name: '${TOOL_PATH}'`;
      } else {
        const lines = readFileSync(cordisPath, 'utf8').split(/\r?\n/);
        const has = lines.some((l) => l.includes('/lib/tool.js') || l.includes('dsh-vision/tool'));
        if (has) {
          log(`· preset「${source}」已含识图工具，跳过`);
        } else {
          const out = lines.slice();
          while (out.length && out[out.length - 1].trim() === '') out.pop();
          out.push(`- id: tool-vision`);
          out.push(`  name: '${TOOL_PATH}'`);
          out.push('');
          writeFileSync(cordisPath, out.join('\n'), 'utf8');
          log(`✔ 已把识图工具写入 preset「${source}」`);
        }
        presetNote = `识图工具已就绪（preset「${source}」）。新建会话即可让模型自己截图 + 识图。`;
      }
    }
  } catch (err) {
    presetNote = `自动写入 preset 失败（${err.message}）。请手动把下面这行加入 agent preset 的 agent.cordis.yml 末尾：\n  - name: '${TOOL_PATH}'`;
  }
} else {
  presetNote = `未检测到 DSH home。请手动把下面这行加入 agent preset 的 agent.cordis.yml 末尾：\n  - name: '${TOOL_PATH}'`;
}

// ── 4. 总结 ──
section('安装完成');
log(`插件源目录：${PLUGIN_DIR}`);
log(`DSH home：${dshHome ?? '（未检测到）'}`);
if (installedProfiles.length) log(`已安装 profile：${installedProfiles.join('、')}`);
log('');
log('【下一步】');
log('1. 重启 DSH（关闭后重新运行：dsh web）。');
log('2. 打开网页，点右下角「🖼️ 识图」按钮，填写外挂识图模型的地址/密钥/模型名，保存。');
log('3. 拖一张图片进页面即可自动识图并回传给 DeepSeek。');
log('');
log('【让模型自己截图识图（agent 工具）】');
log(presetNote);
log('');
log('提示：如果移动了本插件源目录，请重新运行 node install.mjs；');
log('host/client 插件通过 profile node_modules 里的副本加载，tool 插件通过上面的绝对路径加载。');
