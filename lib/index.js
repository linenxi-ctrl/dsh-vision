/**
 * dsh-vision — host 平面插件（index.js）
 *
 * 职责：
 *  - 注册 settings 命名空间 `vision`（外挂识图 API 的地址 / 密钥 / 模型 / 提示词 / 代理）
 *  - 提供 `ctx.vision` 服务（调用外挂识图模型；工具插件与 HTTP 路由共用）
 *  - 注册两个 HTTP 路由供浏览器客户端调用（拖图识图 / 读写配置）
 *
 * 这是一个 ESM 模块，作为 host 平面插件挂载进 cordis.patch.yml。
 */
import http from 'node:http';
import https from 'node:https';
import z from '@deepseek-ai/schemastery';

/** settings 命名空间（必须小写 kebab-case）。 */
const NAMESPACE = 'vision';

/** 默认识图提示词（skill）：用户可覆盖。 */
const DEFAULT_PROMPT = [
  '你是一名专业的图像识别助手。请仔细观察用户提供的图片，并完成以下任务：',
  '1. 详细描述图片中的主要内容、物体、人物、文字、界面元素等。',
  '2. 如果图片包含文字（代码、报错信息、UI 文本、文档、表格等），请逐字准确地转录所有可见文字。',
  '3. 如果图片是截图（程序界面、终端、网页、图表、日志等），请重点描述其功能、状态和关键信息。',
  '请用清晰、结构化、便于后续理解和引用原文的方式输出识别结果。',
].join('\n');

/** 单个外挂识图请求允许的最大图片字节数（base64 解码后）。 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** 支持的协议 id 集合。 */
const PROTOCOL_IDS = ['auto', 'openai-chat', 'openai-responses', 'anthropic', 'gemini', 'custom'];

/** settings schema：字段既用于持久化，也作为配置面板的表单描述。 */
const Config = z.object({
  apiBase: z.string().default('https://api.openai.com/v1').description('识图模型的 API 地址（按所选协议填到基础路径即可）'),
  apiKey: z.string().role('secret').default('').description('API 密钥'),
  model: z.string().default('gpt-4o-mini').description('模型名称'),
  protocol: z.string().default('auto').description('API 协议：auto（自动探测）/ openai-chat / openai-responses / anthropic / gemini / custom'),
  prompt: z.string().default(DEFAULT_PROMPT).description('识图提示词（skill）'),
  proxy: z.string().default('').description('可选 HTTP 代理，例如 http://127.0.0.1:65532'),
  timeoutMs: z.number().default(60000).description('单次识图超时（毫秒）'),
  requestTemplate: z.string().default('').description('custom 协议：请求体 JSON 模板，占位符 {{model}}/{{prompt}}/{{image}}/{{dataUrl}}/{{mime}}'),
  responsePath: z.string().default('').description('custom 协议：响应文本的取路径，如 choices.0.message.content'),
});

/** 拼接 URL：若 base 已以 suffix 结尾则原样返回，否则拼接（去掉 base 尾部斜杠）。 */
function joinUrl(base, suffix) {
  const b = String(base).replace(/\/+$/, '');
  if (b.endsWith(suffix)) return b;
  return b + suffix;
}

/** 组装 data: URL。 */
function dataUrl(imageBase64, mimeType) {
  return `data:${mimeType || 'image/png'};base64,${imageBase64}`;
}

/** 归一化任意 content（字符串 / 数组 / 对象数组）为文本。 */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
      .filter(Boolean)
      .join('');
  }
  return '';
}

/** 按点号路径（含数字下标）从响应对象取值。 */
function getPath(obj, path) {
  let cur = obj;
  for (const seg of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * 协议适配层：每种协议提供 build（构造 {url, headers, body}）与 extract（从响应取文本）。
 * 新增协议只需在这里加一项，并让 detectProtocol 能命中即可。
 */
const PROTOCOLS = {
  'openai-chat': {
    build(cfg, b64, mime, prompt) {
      return {
        url: joinUrl(cfg.apiBase, '/chat/completions'),
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl(b64, mime) } },
          ] }],
        }),
      };
    },
    extract(data) {
      const c = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
      return textOf(c);
    },
  },
  'openai-responses': {
    build(cfg, b64, mime, prompt) {
      return {
        url: joinUrl(cfg.apiBase, '/responses'),
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        body: JSON.stringify({
          model: cfg.model,
          input: [{ role: 'user', content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: dataUrl(b64, mime) },
          ] }],
        }),
      };
    },
    extract(data) {
      const parts = (data?.output ?? []).flatMap((o) => o?.content ?? []);
      return parts.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
    },
  },
  anthropic: {
    build(cfg, b64, mime, prompt) {
      const suffix = /\/v1$/.test(String(cfg.apiBase).replace(/\/+$/, '')) ? '/messages' : '/v1/messages';
      return {
        url: joinUrl(cfg.apiBase, suffix),
        headers: {
          ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image', source: { type: 'base64', media_type: mime || 'image/png', data: b64 } },
          ] }],
        }),
      };
    },
    extract(data) {
      return textOf(data?.content);
    },
  },
  gemini: {
    build(cfg, b64, mime, prompt) {
      const model = String(cfg.model).replace(/^models\//, '');
      return {
        url: joinUrl(cfg.apiBase, `/models/${model}:generateContent`),
        headers: cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {},
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mime || 'image/png', data: b64 } },
          ] }],
        }),
      };
    },
    extract(data) {
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p?.text ?? '').join('');
    },
  },
  custom: {
    build(cfg, b64, mime, prompt) {
      const template = cfg.requestTemplate
        || '{"model":{{model}},"messages":[{"role":"user","content":[{"type":"text","text":{{prompt}}},{"type":"image_url","image_url":{"url":{{dataUrl}}}}]}]}';
      const body = template
        .split('{{model}}').join(JSON.stringify(cfg.model))
        .split('{{prompt}}').join(JSON.stringify(prompt))
        .split('{{image}}').join(JSON.stringify(b64))
        .split('{{dataUrl}}').join(JSON.stringify(dataUrl(b64, mime)))
        .split('{{mime}}').join(JSON.stringify(mime || 'image/png'));
      return {
        url: String(cfg.apiBase).replace(/\/+$/, ''),
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        body,
      };
    },
    extract(data, cfg) {
      return textOf(getPath(data, cfg.responsePath || 'choices.0.message.content'));
    },
  },
};

/** 自动探测协议：优先显式指定，否则按 apiBase 特征识别，最终回退 openai-chat。 */
function detectProtocol(apiBase, explicit) {
  if (explicit && explicit !== 'auto' && PROTOCOLS[explicit]) return explicit;
  const u = String(apiBase || '').toLowerCase();
  if (u.includes('anthropic')) return 'anthropic';
  if (u.includes('gemini') || u.includes('generativelanguage') || u.includes('googleapis')) return 'gemini';
  if (u.includes('/responses')) return 'openai-responses';
  return 'openai-chat';
}

/**
 * 发送一个 HTTP 请求（GET/POST），支持可选的 HTTP 代理（http 目标走转发、https 目标走 CONNECT 隧道）。
 * 使用 node:http / node:https 原生实现，避免引入额外依赖。
 */
function httpRequest(method, targetUrl, headers, body, proxyUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === 'https:';
    const hasBody = body != null;
    const payload = hasBody ? Buffer.from(body, 'utf8') : null;
    const finalHeaders = {
      ...(hasBody ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      ...headers,
    };

    const collect = (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    };

    const requestOptions = (path) => ({
      method,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : (isHttps ? 443 : 80),
      path,
      headers: finalHeaders,
    });

    const send = (opts) => {
      const mod = isHttps ? https : http;
      const req = mod.request(opts, collect);
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    };

    if (!proxyUrl) {
      send(requestOptions(url.pathname + url.search));
      return;
    }

    // 有代理：http 目标直接向代理发完整 URL；https 目标先 CONNECT 建隧道。
    const proxy = new URL(proxyUrl);
    const proxyPort = proxy.port ? Number(proxy.port) : 80;

    if (isHttps) {
      const connectReq = http.request({
        method: 'CONNECT',
        hostname: proxy.hostname,
        port: proxyPort,
        path: `${url.hostname}:${url.port || 443}`,
        headers: { host: `${url.hostname}:${url.port || 443}` },
      });
      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          reject(new Error(`代理 CONNECT 失败：HTTP ${res.statusCode}`));
          return;
        }
        const req = https.request({
          method,
          hostname: url.hostname,
          port: url.port ? Number(url.port) : 443,
          path: url.pathname + url.search,
          headers: finalHeaders,
          socket,
          agent: false,
        }, collect);
        req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时（${timeoutMs}ms）`)));
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
      });
      connectReq.on('error', reject);
      connectReq.end();
    } else {
      send({
        method,
        hostname: proxy.hostname,
        port: proxyPort,
        path: targetUrl,
        headers: finalHeaders,
      });
    }
  });
}

function postJson(targetUrl, headers, body, proxyUrl, timeoutMs) {
  return httpRequest('POST', targetUrl, headers, body, proxyUrl, timeoutMs);
}

function getJson(targetUrl, headers, proxyUrl, timeoutMs) {
  return httpRequest('GET', targetUrl, headers, null, proxyUrl, timeoutMs);
}

/**
 * 猜测一个模型 id 应该使用的协议（启发式，覆盖主流模型命名；opencode 网关的模型另有特判）。
 * @param modelId 模型 id
 * @param apiBase API 地址
 * @returns 协议 id（openai-chat / openai-responses / anthropic / gemini）
 */
function guessProtocol(modelId, apiBase) {
  const m = String(modelId || '').toLowerCase();
  const u = String(apiBase || '').toLowerCase();
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('grok')) return 'openai-responses';
  if (m.includes('gpt-5.6')) return 'openai-responses';
  // opencode 网关：minimax/qwen 走 anthropic 的 /v1/messages，gpt 走 responses
  if (u.includes('opencode')) {
    if (m.includes('minimax') || m.includes('qwen')) return 'anthropic';
    if (m.includes('gpt')) return 'openai-responses';
  }
  return 'openai-chat';
}

/**
 * 拉取外挂 API 支持的模型列表（兼容 OpenAI 的 /models、Anthropic 的 /v1/models、Gemini 的 /models）。
 * @param cfg 已解析的配置
 * @returns `{ id, protocol }[]`（按 id 升序）
 */
async function fetchModels(cfg) {
  const protocol = PROTOCOLS[detectProtocol(cfg.apiBase, cfg.protocol)] ?? PROTOCOLS['openai-chat'];
  let url;
  let headers;
  if (protocol === PROTOCOLS.anthropic) {
    const suffix = /\/v1$/.test(String(cfg.apiBase).replace(/\/+$/, '')) ? '/models' : '/v1/models';
    url = joinUrl(cfg.apiBase, suffix);
    headers = { ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}), 'anthropic-version': '2023-06-01' };
  } else if (protocol === PROTOCOLS.gemini) {
    url = joinUrl(cfg.apiBase, '/models');
    headers = cfg.apiKey ? { 'x-goog-api-key': cfg.apiKey } : {};
  } else {
    // openai-chat / openai-responses / custom：均为 OpenAI 兼容 GET {base}/models
    url = joinUrl(cfg.apiBase, '/models');
    headers = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
  }

  const res = await getJson(url, headers, cfg.proxy, cfg.timeoutMs || 30000);
  if (!res.status || res.status < 200 || res.status >= 300) {
    throw new Error(`拉取模型列表失败（HTTP ${res.status}）：${res.body.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new Error('模型列表返回了非 JSON 内容');
  }

  const toEntry = (id) => {
    const modelId = String(id ?? '').replace(/^models\//, '').trim();
    if (!modelId) return null;
    return { id: modelId, protocol: guessProtocol(modelId, cfg.apiBase) };
  };

  if (Array.isArray(data?.data)) {
    return data.data
      .map((m) => toEntry(typeof m === 'string' ? m : m?.id))
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  if (Array.isArray(data?.models)) {
    return data.models
      .map((m) => toEntry(typeof m === 'string' ? m : m?.name))
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return [];
}

/**
 * 调用外挂识图模型，返回识别文本。自动按 apiBase 探测协议（可用 protocol 覆盖）。
 * @param cfg 已解析的配置
 * @param imageBase64 不含 data: 前缀的 base64 图片
 * @param mimeType 图片 MIME
 * @param promptOverride 可选的本次调用提示词（覆盖配置里的 prompt）
 */
async function recognizeImage(cfg, imageBase64, mimeType, promptOverride) {
  const raw = typeof imageBase64 === 'string' ? imageBase64 : '';
  if (!raw) throw new Error('图片内容为空');

  // 粗略估算解码后的字节数，避免向外部 API 发送超大请求。
  if (Math.floor(raw.length * 3 / 4) > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB）`);
  }

  const prompt = promptOverride?.trim() ? promptOverride : (cfg.prompt || DEFAULT_PROMPT);
  const protocol = PROTOCOLS[detectProtocol(cfg.apiBase, cfg.protocol)] ?? PROTOCOLS['openai-chat'];

  const { url, headers, body } = protocol.build(cfg, raw, mimeType, prompt);
  const res = await postJson(url, headers, body, cfg.proxy, cfg.timeoutMs || 60000);

  if (!res.status || res.status < 200 || res.status >= 300) {
    throw new Error(`外挂识图模型返回 HTTP ${res.status}：${res.body.slice(0, 500)}`);
  }

  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new Error(`外挂识图模型返回了非 JSON 内容：${res.body.slice(0, 500)}`);
  }

  const text = String(protocol.extract(data, cfg) ?? '').trim();
  if (!text) throw new Error('外挂识图模型返回了空结果');
  return text;
}

/** 从 HTTP 请求读取 JSON 请求体（带字节上限）。 */
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** host 插件入口。 */
export function apply(ctx, config) {
  // ── 配置：settings 为软依赖 —— 存在时注册 namespace（可持久化到 settings.yaml），
  //    否则退回 entry config。用 ctx.inject 避免在无 settings 的部署上加载失败。 ──
  let settingsScope = null;
  ctx.inject(['settings'], (sctx) => {
    settingsScope = sctx.settings.register(NAMESPACE, Config, { base: config ?? {} });
  });

  const defaults = Config({});
  const getConfig = () => {
    if (settingsScope) return settingsScope.get();
    return { ...defaults, ...(config ?? {}) };
  };

  // ── 识图服务（工具插件与 HTTP 路由共用；随本插件 fiber 生命周期卸载） ──
  const vision = {
    name: 'vision',
    getConfig,
    recognize: (imageBase64, mimeType, promptOverride) =>
      recognizeImage(getConfig(), imageBase64, mimeType, promptOverride),
  };
  ctx.provide('vision', vision);

  // ── HTTP 路由（软依赖 webServer：Web 表层存在则注册，TUI/headless 自动跳过） ──
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const disposeRecognize = sctx.webServer.register({
        kind: 'exact',
        path: '/api/vision/recognize',
        handler: async (req, res) => {
          try {
            const body = await readJsonBody(req, MAX_IMAGE_BYTES + 64 * 1024);
            const text = await recognizeImage(getConfig(), body.imageBase64, body.mimeType, body.prompt);
            sendJson(res, 200, { ok: true, text });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
          }
        },
      });

      const disposeConfig = sctx.webServer.register({
        kind: 'exact',
        path: '/api/vision/config',
        handler: async (req, res) => {
          try {
            if (req.method === 'GET') {
              const cfg = getConfig();
              // 密钥绝不回传；只报告“是否已配置”。
              const { apiKey, ...safe } = cfg;
              sendJson(res, 200, { ok: true, config: { ...safe, apiKeyConfigured: Boolean(apiKey) } });
              return;
            }
            if (req.method === 'POST') {
              const patch = await readJsonBody(req, 256 * 1024);
              if (!settingsScope) {
                sendJson(res, 500, { ok: false, error: '当前部署未挂载 settings 服务，无法保存配置' });
                return;
              }
              // 只接受已知字段，且空密钥表示“保持不变”。
              const clean = {};
              for (const key of ['apiBase', 'model', 'protocol', 'prompt', 'proxy', 'timeoutMs', 'requestTemplate', 'responsePath']) {
                if (typeof patch[key] !== 'undefined') clean[key] = patch[key];
              }
              if (typeof patch.apiKey === 'string' && patch.apiKey.length > 0) clean.apiKey = patch.apiKey;
              await settingsScope.update(clean);
              sendJson(res, 200, { ok: true });
              return;
            }
            sendJson(res, 405, { ok: false, error: 'method not allowed' });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
          }
        },
      });

      const disposeModels = sctx.webServer.register({
        kind: 'exact',
        path: '/api/vision/models',
        handler: async (req, res) => {
          try {
            const body = await readJsonBody(req, 256 * 1024);
            // 优先用面板草稿（未保存）里的地址/密钥/协议，否则用已保存配置
            const cfg = {
              ...getConfig(),
              ...(typeof body.apiBase === 'string' && body.apiBase ? { apiBase: body.apiBase } : {}),
              ...(typeof body.apiKey === 'string' && body.apiKey ? { apiKey: body.apiKey } : {}),
              ...(typeof body.protocol === 'string' && body.protocol ? { protocol: body.protocol } : {}),
            };
            const models = await fetchModels(cfg);
            sendJson(res, 200, { ok: true, models });
          } catch (err) {
            sendJson(res, 500, { ok: false, error: String(err?.message ?? err) });
          }
        },
      });

      return () => {
        disposeRecognize();
        disposeConfig();
        disposeModels();
      };
    }, 'dsh-vision: http routes');
  });
}

export const inject = [];
export const name = 'vision';

export { Config, DEFAULT_PROMPT, NAMESPACE, recognizeImage };
