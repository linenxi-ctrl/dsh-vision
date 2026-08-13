/**
 * dsh-vision — 客户端插件（client.js）
 *
 * 浏览器端 bundle（window.__ModuleLoader__.load 格式，零构建依赖）。
 *
 * 职责：
 *  - 页面右下角「🖼️ 识图」浮动按钮（可拖动），点击打开配置面板
 *  - 面板内提供「📤 发送图片」：用户在此选择图片，发给外挂识图模型，
 *    识别完成后把文本作为用户消息发回当前会话
 *  - 面板内「🔌 连接拉取」：拉取 API 支持的模型列表（含协议），点击自动选协议
 *  - 识图过程中右上角显示旋转圈圈 + 说明文字（可拖动）
 *
 * 注意：本插件不拦截整页拖图——拖图给 DeepSeek 的默认行为完全不受影响，
 * 只有面板里「发送图片」才走外挂识图。
 */
window.__ModuleLoader__.load({
  id: 'dsh-vision',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // ───────────────────────── 小工具 ─────────────────────────
    function el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) {
        for (const key of Object.keys(attrs)) {
          if (key === 'style' && typeof attrs[key] === 'object') {
            Object.assign(node.style, attrs[key]);
          } else if (key.startsWith('on') && typeof attrs[key] === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
          } else if (key === 'text') {
            node.textContent = attrs[key];
          } else {
            node.setAttribute(key, attrs[key]);
          }
        }
      }
      if (children) {
        for (const child of [].concat(children)) {
          if (child == null) continue;
          node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        }
      }
      return node;
    }

    // DeepSeek 官方鲸鱼 logo（simple-icons 矢量路径，viewBox 0 0 24 24，fill 跟随按钮颜色）
    const DEEPSEEK_LOGO_SVG =
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136 9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653 1.857 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.132-.284 4.994-1.86.47.234.962.328 1.78.398.629.058 1.235-.031 1.705-.129.735-.155.684-.836.418-.961-2.155-1.004-1.682-.595-2.112-.926 1.095-1.295 2.768-3.598 3.284-6.733.05-.346.115-.834.108-1.114-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287.3.3 0 0 1 .113.074.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"></path>' +
      '</svg>';

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
    }

    let toastEl = null;
    function showToast(text, kind) {
      if (!toastEl) {
        toastEl = el('div', {
          style: {
            position: 'fixed', left: '50%', bottom: '96px', transform: 'translateX(-50%)',
            padding: '10px 16px', borderRadius: '12px', fontSize: '13px', lineHeight: '20px',
            zIndex: '2147483000', maxWidth: '80vw', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
            transition: 'opacity .15s ease', pointerEvents: 'none',
            fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          },
        });
        document.body.appendChild(toastEl);
      }
      const colors = {
        info: ['var(--dsw-alias-bg-overlay, #2a2a2a)', 'var(--dsw-alias-label-primary, #e8e8e8)'],
        error: ['#3a1d1d', '#ffb4b4'],
        ok: ['#12311f', '#9fe7b5'],
      }[kind] || ['var(--dsw-alias-bg-overlay, #2a2a2a)', 'var(--dsw-alias-label-primary, #e8e8e8)'];
      toastEl.style.background = colors[0];
      toastEl.style.color = colors[1];
      toastEl.textContent = text;
      toastEl.style.opacity = '1';
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => { toastEl.style.opacity = '0'; }, kind === 'error' ? 6000 : 4000);
    }

    function injectStyle(css) {
      const tag = el('style', { type: 'text/css' });
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    /** 让元素可拖动（mousedown 拖动；移动超过 3px 才视为拖动，点击不受影响）。 */
    function makeDraggable(el) {
      el.addEventListener('mousedown', (e) => {
        const rect = el.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!dragging && Math.abs(dx) + Math.abs(dy) > 3) {
            dragging = true;
            el.style.left = rect.left + 'px';
            el.style.top = rect.top + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
          }
          if (dragging) {
            el.style.left = (rect.left + dx) + 'px';
            el.style.top = (rect.top + dy) + 'px';
          }
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      el.addEventListener('dragstart', (e) => e.preventDefault());
    }

    /** 右上角「识图中」指示器：旋转圈圈 + 说明文字，可拖动。 */
    function buildLoadingIndicator() {
      const wrap = el('div', {
        style: {
          position: 'fixed', top: '16px', right: '16px', zIndex: '2147483002',
          display: 'none', alignItems: 'center', gap: '10px',
          padding: '10px 16px', borderRadius: '12px',
          background: 'var(--dsw-alias-bg-layer-1, #1f1f1f)',
          border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
          color: 'var(--dsw-alias-label-primary, #e8e8e8)',
          boxShadow: '0 8px 30px rgba(0,0,0,.3)',
          fontSize: '13px', cursor: 'move', userSelect: 'none',
        },
      });
      const spinner = el('div', {
        style: {
          width: '16px', height: '16px', borderRadius: '50%', flexShrink: '0',
          border: '2px solid rgba(255,255,255,.2)',
          borderTopColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
          animation: 'dsh-vision-spin 0.8s linear infinite',
        },
      });
      wrap.appendChild(spinner);
      wrap.appendChild(el('span', { text: '外挂模型正在识图当中，请稍后' }));
      document.body.appendChild(wrap);
      makeDraggable(wrap);
      return {
        show() { wrap.style.display = 'flex'; },
        hide() { wrap.style.display = 'none'; },
        remove() { wrap.remove(); },
      };
    }

    // ───────────────────────── 模块级状态 ─────────────────────────
    let activeCtx = null;
    let loading = null;
    let sending = false;

    /** 把一张图片发给外挂识图模型，识别完成后把文本作为用户消息发回当前会话。 */
    async function sendImage(file) {
      if (sending) return;
      const ctx = activeCtx;
      if (!ctx) { showToast('插件未就绪', 'error'); return; }
      const currentId = ctx.sessions?.list?.getSnapshot?.().current;
      if (!currentId) {
        showToast('请先打开一个会话，再发送图片', 'error');
        return;
      }
      sending = true;
      loading?.show();
      try {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/vision/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mimeType: file.type || 'image/png' }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const binding = ctx.sessions?.binding?.(currentId);
        if (!binding?.session) throw new Error('会话未就绪');
        await binding.session.prompt([{ type: 'text', text: data.text }], 'queue');
        showToast('已把识别结果发送给 DeepSeek', 'ok');
      } catch (err) {
        showToast('识图失败：' + (err?.message || err), 'error');
      } finally {
        sending = false;
        loading?.hide();
      }
    }

    // ───────────────────────── 配置面板 ─────────────────────────
    const FIELDS = [
      { key: 'apiBase', label: 'API 地址', type: 'text', placeholder: 'https://api.openai.com/v1' },
      { key: 'apiKey', label: 'API 密钥', type: 'password', placeholder: 'sk-...' },
      { key: 'model', label: '模型名称', type: 'text', placeholder: 'gpt-4o-mini' },
      { key: 'protocol', label: 'API 协议', type: 'select', options: [
        { value: 'auto', label: 'auto（自动探测）' },
        { value: 'openai-chat', label: 'openai-chat（OpenAI 兼容）' },
        { value: 'openai-responses', label: 'openai-responses（OpenAI Responses）' },
        { value: 'anthropic', label: 'anthropic（Anthropic Messages）' },
        { value: 'gemini', label: 'gemini（Google Gemini）' },
        { value: 'custom', label: 'custom（自定义模板）' },
      ] },
      { key: 'prompt', label: '识图提示词（skill）', type: 'textarea' },
      { key: 'proxy', label: 'HTTP 代理（可选）', type: 'text', placeholder: 'http://127.0.0.1:65532' },
      { key: 'timeoutMs', label: '超时（毫秒）', type: 'number', placeholder: '60000' },
      { key: 'requestTemplate', label: '自定义请求模板（仅 custom 协议）', type: 'textarea', customOnly: true },
      { key: 'responsePath', label: '响应文本路径（仅 custom 协议）', type: 'text', placeholder: 'choices.0.message.content', customOnly: true },
    ];

    function buildPanel() {
      const inputs = {};

      const form = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '420px', maxWidth: '560px' } });

      // 模型列表容器（可滚动，点击某项填入 model + protocol）
      const modelsBox = el('div', {
        style: {
          display: 'none', maxHeight: '200px', overflowY: 'auto', marginTop: '6px',
          border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)', borderRadius: '8px',
          background: 'var(--dsw-alias-bg-layer-2, #161616)',
        },
      });

      // 「连接拉取模型」按钮（放在模型名称字段旁边）
      const fetchBtn = el('button', {
        type: 'button', text: '🔌 连接拉取',
        style: {
          padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
          cursor: 'pointer', fontSize: '12px', background: 'transparent',
          color: 'var(--dsw-alias-label-primary, #e8e8e8)', fontFamily: 'inherit', flexShrink: '0',
        },
      });

      // 「发送图片」：隐藏的 file input + 按钮
      const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
      const sendImgBtn = el('button', {
        type: 'button', text: '📤 发送图片给识图 AI',
        style: {
          width: '100%', padding: '10px 16px', borderRadius: '8px',
          border: '1px solid var(--dsw-alias-brand-primary, #4d6bfe)',
          background: 'var(--dsw-alias-brand-primary, #4d6bfe)', color: '#fff',
          cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit',
        },
      });
      sendImgBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (file) sendImage(file);
      });

      for (const field of FIELDS) {
        const label = el('label', { style: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #9a9a9a)' } });
        if (field.key === 'model') {
          const head = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } });
          head.appendChild(document.createTextNode(field.label));
          head.appendChild(fetchBtn);
          label.appendChild(head);
        } else {
          label.appendChild(document.createTextNode(field.label));
        }
        let input;
        if (field.type === 'textarea') {
          input = el('textarea', { rows: '6', placeholder: field.placeholder || '', style: inputStyle('140px') });
        } else if (field.type === 'select') {
          input = el('select', { style: inputStyle('36px') });
          for (const opt of field.options || []) {
            input.appendChild(el('option', { value: opt.value, text: opt.label }));
          }
        } else {
          input = el('input', { type: field.type, placeholder: field.placeholder || '', style: inputStyle('36px') });
        }
        inputs[field.key] = input;
        if (field.customOnly) label.dataset.customOnly = '1';
        label.appendChild(input);
        if (field.key === 'model') label.appendChild(modelsBox);
        form.appendChild(label);
      }

      // 「连接拉取模型」：用当前面板草稿里的地址/密钥/协议去 /models 拉取
      fetchBtn.addEventListener('click', async () => {
        const apiBase = (inputs.apiBase?.value || '').trim();
        const apiKey = (inputs.apiKey?.value || '').trim();
        const protocol = inputs.protocol?.value || 'auto';
        fetchBtn.disabled = true;
        fetchBtn.textContent = '连接中…';
        modelsBox.style.display = 'none';
        modelsBox.innerHTML = '';
        try {
          const res = await fetch('/api/vision/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiBase, apiKey, protocol }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
          const models = data.models || [];
          if (!models.length) {
            showToast('未获取到模型列表（检查地址/密钥/协议）', 'error');
            return;
          }
          const protoShort = { 'openai-chat': 'chat', 'openai-responses': 'responses', anthropic: 'messages', gemini: 'gemini' };
          for (const entry of models) {
            const item = el('div', {
              style: {
                padding: '8px 12px', cursor: 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                borderBottom: '1px solid var(--dsw-alias-border-l1, #2a2a2a)',
                color: 'var(--dsw-alias-label-primary, #e8e8e8)',
              },
              onMouseenter: () => { item.style.background = 'var(--dsw-alias-interactive-bg-hover, #2a2a2a)'; },
              onMouseleave: () => { item.style.background = 'transparent'; },
              onClick: () => {
                inputs.model.value = entry.id;
                if (inputs.protocol && entry.protocol && entry.protocol !== 'custom') inputs.protocol.value = entry.protocol;
                const show = inputs.protocol && inputs.protocol.value === 'custom';
                for (const f of FIELDS) {
                  if (f.customOnly && inputs[f.key]) {
                    const lbl = inputs[f.key].closest('label');
                    if (lbl) lbl.style.display = show ? 'flex' : 'none';
                  }
                }
                modelsBox.style.display = 'none';
              },
            });
            item.appendChild(el('span', { text: entry.id, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }));
            item.appendChild(el('span', {
              text: protoShort[entry.protocol] || entry.protocol || 'auto',
              style: {
                padding: '1px 7px', borderRadius: '4px', fontSize: '11px', flexShrink: '0',
                background: 'var(--dsw-alias-bg-layer-1, #1f1f1f)',
                color: 'var(--dsw-alias-label-secondary, #9a9a9a)',
              },
            }));
            modelsBox.appendChild(item);
          }
          modelsBox.style.display = 'block';
          showToast(`已加载 ${models.length} 个模型，点击选择`, 'ok');
        } catch (err) {
          showToast('拉取失败：' + (err?.message || err), 'error');
        } finally {
          fetchBtn.disabled = false;
          fetchBtn.textContent = '🔌 连接拉取';
        }
      });

      // protocol 切换到 custom 时才显示自定义模板字段
      const protocolSel = inputs.protocol;
      const refreshCustomVisibility = () => {
        const show = protocolSel && protocolSel.value === 'custom';
        for (const field of FIELDS) {
          if (field.customOnly && inputs[field.key]) {
            const lbl = inputs[field.key].closest('label');
            if (lbl) lbl.style.display = show ? 'flex' : 'none';
          }
        }
      };
      if (protocolSel) protocolSel.addEventListener('change', refreshCustomVisibility);

      const actions = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' } });
      const cancelBtn = el('button', { text: '取消', style: btnStyle('secondary') });
      const saveBtn = el('button', { text: '保存', style: btnStyle('primary') });
      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);
      form.appendChild(actions);

      const panel = el('div', {
        role: 'dialog', 'aria-label': '识图模型配置',
        style: {
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'var(--dsw-alias-bg-layer-1, #1f1f1f)',
          border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
          borderRadius: '16px', padding: '20px', zIndex: '2147483001',
          boxShadow: '0 20px 60px rgba(0,0,0,.4)', color: 'var(--dsw-alias-label-primary, #e8e8e8)',
        },
      });
      const title = el('div', { text: '外挂识图模型', style: { fontSize: '15px', fontWeight: '600', marginBottom: '14px' } });
      const sendHint = el('div', { text: '选择一张图片，发给识图 AI，识别结果会自动回传给 DeepSeek。', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #9a9a9a)', marginBottom: '10px' } });
      panel.appendChild(title);
      panel.appendChild(sendImgBtn);
      panel.appendChild(sendHint);
      panel.appendChild(fileInput);
      panel.appendChild(el('hr', { style: { border: 'none', borderTop: '1px solid var(--dsw-alias-border-l2, #3a3a3a)', margin: '4px 0 14px' } }));
      panel.appendChild(form);

      const overlay = el('div', {
        style: { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.5)', zIndex: '2147483000' },
      });

      function close() { overlay.remove(); panel.remove(); }
      overlay.addEventListener('click', close);
      cancelBtn.addEventListener('click', close);
      panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

      saveBtn.addEventListener('click', async () => {
        const patch = {};
        for (const field of FIELDS) {
          const v = inputs[field.key].value.trim();
          if (field.type === 'number') {
            if (v !== '') patch[field.key] = Number(v);
          } else if (field.key === 'apiKey') {
            if (v !== '') patch.apiKey = v;
          } else {
            patch[field.key] = v;
          }
        }
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';
        try {
          const res = await fetch('/api/vision/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
          });
          const data = await res.json();
          if (data.ok) { showToast('配置已保存', 'ok'); close(); }
          else showToast('保存失败：' + (data.error || res.status), 'error');
        } catch (err) {
          showToast('保存失败：' + err.message, 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
        }
      });

      // 打开时拉取现有配置（密钥不回传，仅标记“已配置”）
      (async () => {
        try {
          const res = await fetch('/api/vision/config');
          const data = await res.json();
          if (data.ok && data.config) {
            for (const field of FIELDS) {
              if (field.key === 'apiKey') {
                inputs.apiKey.placeholder = data.config.apiKeyConfigured ? '（已配置，留空保持不变）' : 'sk-...';
              } else if (field.key === 'timeoutMs') {
                inputs[field.key].value = data.config[field.key] ?? '';
              } else if (data.config[field.key] != null) {
                inputs[field.key].value = data.config[field.key];
              }
            }
            refreshCustomVisibility();
          }
        } catch { /* 忽略：面板仍可用，仅不预填 */ }
      })();

      document.body.appendChild(overlay);
      document.body.appendChild(panel);
    }

    function inputStyle(height) {
      return {
        boxSizing: 'border-box', width: '100%', minHeight: height,
        background: 'var(--dsw-alias-bg-layer-2, #161616)',
        border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)', borderRadius: '8px',
        padding: '8px 10px', color: 'var(--dsw-alias-label-primary, #e8e8e8)',
        fontSize: '13px', lineHeight: '18px', fontFamily: 'inherit', resize: 'vertical',
      };
    }
    function btnStyle(kind) {
      return {
        padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #3a3a3a)',
        cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit',
        background: kind === 'primary' ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'transparent',
        color: kind === 'primary' ? '#fff' : 'var(--dsw-alias-label-primary, #e8e8e8)',
      };
    }

    // ───────────────────────── 插件主体 ─────────────────────────
    const inject = ['connection', 'sessions'];

    function apply(ctx) {
      ctx.effect(() => {
        activeCtx = ctx;
        const removeStyle = injectStyle(`
          #dsh-vision-fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
            display:flex; align-items:center; justify-content:center; width:48px; height:48px; padding:0;
            border-radius: 50%;
            border:1px solid var(--dsw-alias-border-l2, #3a3a3a);
            background: var(--dsw-alias-bg-layer-1, #1f1f1f); color: var(--dsw-alias-brand-primary, #4d6bfe);
            cursor:move; user-select:none; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
          #dsh-vision-fab:hover { border-color: var(--dsw-alias-brand-primary, #4d6bfe); }
          #dsh-vision-fab svg { width:26px; height:26px; display:block; }
          @keyframes dsh-vision-spin { to { transform: rotate(360deg); } }
        `);

        const fab = el('button', { type: 'button', id: 'dsh-vision-fab', title: '点击打开识图模型配置；按住可拖动位置' });
        fab.innerHTML = DEEPSEEK_LOGO_SVG;
        fab.addEventListener('click', buildPanel);
        document.body.appendChild(fab);
        makeDraggable(fab);

        loading = buildLoadingIndicator();

        return () => {
          const l = loading;
          activeCtx = null;
          loading = null;
          removeStyle();
          fab.remove();
          l?.remove();
        };
      }, 'dsh-vision: client UI');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
