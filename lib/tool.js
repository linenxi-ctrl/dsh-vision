/**
 * dsh-vision — agent 工具插件（tool.js）
 *
 * 职责：
 *  - 注册 `recognize_image` 工具：模型把图片文件路径交给外挂识图模型，等待识别文本返回
 *  - 注册 `screenshot` 工具：对当前屏幕截图并保存到临时文件，返回路径（配合 recognize_image 用）
 *  - 注入系统提示词段，告诉模型「你可以截图 + 识图」
 *
 * 该插件运行在 agent 平面（通过 agent preset 的 agent.cordis.yml 挂载），
 * 通过 ctx.get('vision') 软依赖复用 host 平面的识图服务。
 *
 * 注意：本文件零外部依赖 —— 不 import 任何 @deepseek-ai/* 包，直接手写
 * ToolDefinition（parameters 用 JSON Schema，output 用 {schema, render}），
 * 因此 agent-presets 按绝对路径挂载时不会因裸包解析失败。
 */
import { readFile } from 'node:fs/promises';
import { execFile as _execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFile = promisify(_execFile);

const name = 'vision-tool';
const inject = ['tools', 'systemPrompt'];

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

function mimeOf(path) {
  const ext = String(path).split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] || 'image/png';
}

/** 平台化截图：Windows 走 PowerShell + System.Drawing，macOS 走 screencapture，Linux 走 ImageMagick import。 */
async function captureScreen(outputPath) {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
      '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
      '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
      '$g = [System.Drawing.Graphics]::FromImage($bmp)',
      '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
      `$bmp.Save('${outputPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$g.Dispose(); $bmp.Dispose()',
    ].join('; ');
    await execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  } else if (process.platform === 'darwin') {
    await execFile('screencapture', ['-x', outputPath]);
  } else {
    await execFile('import', ['-window', 'root', outputPath]);
  }
}

/** 系统提示词段：教会模型「看屏幕」的完整路径。order 130 落在工具引导区间（100–199）。 */
const GUIDANCE = [
  '## 视觉识别能力（识图插件）',
  '你无法直接“看到”屏幕，但可以通过以下两个工具组合来识别图像与屏幕内容：',
  '1. `screenshot`：对当前屏幕截图，返回保存好的图片文件路径。',
  '2. `recognize_image`：把图片文件路径交给外挂视觉模型，返回图片内容的识别文本。',
  '当你需要理解用户屏幕上的内容（程序界面、终端、网页、图表、报错信息等）时，',
  '请先调用 `screenshot` 截图，再把返回的路径交给 `recognize_image` 识别，然后基于识别结果继续。',
  '你也可以直接对用户拖入、或磁盘上已有的图片文件调用 `recognize_image`。',
].join('\n');

export function apply(ctx) {
  const getVision = () => ctx.get('vision');

  // ── 识图工具（手写 ToolDefinition，零依赖）──
  ctx.tools.register({
    name: 'recognize_image',
    description: '把一张本地图片交给外挂视觉识别模型，返回图片内容的详细文本描述（含文字转录）。用于“看”截图、照片、图表、UI、报错截图等。',
    parameters: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: '图片文件的绝对路径（例如 screenshot 工具返回的路径，或用户拖入/磁盘上的图片）' },
        prompt: { type: 'string', description: '可选：本次识图的具体指令，覆盖默认识图 skill（例如“只转录这段代码的报错信息”）' },
      },
      required: ['image_path'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 120000,
    async execute(args, exec) {
      const vision = getVision();
      if (!vision) {
        throw new Error('识图服务（dsh-vision host 插件）未安装：请在宿主 cordis.patch.yml 中挂载 dsh-vision。');
      }
      const data = await readFile(args.image_path);
      if (data.byteLength === 0) throw new Error(`图片文件为空：${args.image_path}`);
      if (data.byteLength > 20 * 1024 * 1024) throw new Error(`图片过大（>20MB）：${args.image_path}`);
      return vision.recognize(data.toString('base64'), mimeOf(args.image_path), args.prompt);
    },
  });

  // ── 截图工具（手写 ToolDefinition，零依赖）──
  ctx.tools.register({
    name: 'screenshot',
    description: '对当前屏幕截图并保存为 PNG 文件，返回该文件的绝对路径。截图后请调用 recognize_image 识别其内容。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      render: (_args, value) => [{ type: 'text', text: `截图已保存到：${value.path}\n请用 recognize_image 识别这张图片。` }],
    },
    timeoutMs: 30000,
    async execute() {
      const outPath = join(tmpdir(), `dsh-vision-${randomUUID()}.png`);
      await captureScreen(outPath);
      return { path: outPath };
    },
  });

  // ── 提示词注入 ──
  ctx.systemPrompt.section({ name: 'vision:guidance', order: 130, text: GUIDANCE });
}

export { inject, name };
