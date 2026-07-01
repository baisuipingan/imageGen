const $ = (id) => document.getElementById(id);
const storeKey = 'hahacode.image.sessions';
const apiKeyStoreKey = 'hahacode.image.apiKey';

const state = {
  sessions: [],
  activeId: null,
  mode: 'generate',
  referenceImage: '',
  busy: false,
  apiKey: '',
  stageStatus: null,
};

const els = {
  sidebar: $('sidebar'),
  sidebarToggle: $('sidebarToggle'),
  closeSidebarBtn: $('closeSidebarBtn'),
  sidebarBackdrop: $('sidebarBackdrop'),
  sessionList: $('sessionList'),
  sessionCount: $('sessionCount'),
  newSessionBtn: $('newSessionBtn'),
  newSessionTopBtn: $('newSessionTopBtn'),
  clearSessionsBtn: $('clearSessionsBtn'),
  draftTitle: $('draftTitle'),
  draftSubtitle: $('draftSubtitle'),
  modeLabel: $('modeLabel'),
  prompt: $('prompt'),
  charCount: $('charCount'),
  apiKey: $('apiKey'),
  apiKeyForm: $('apiKeyForm'),
  toggleKeyBtn: $('toggleKeyBtn'),
  ratio: $('ratio'),
  size: $('size'),
  model: $('model'),
  background: $('background'),
  format: $('format'),
  count: $('count'),
  modelTag: $('modelTag'),
  ratioTag: $('ratioTag'),
  sizeTag: $('sizeTag'),
  bgTag: $('bgTag'),
  fmtTag: $('fmtTag'),
  countTag: $('countTag'),
  emptyState: $('emptyState'),
  resultGrid: $('resultGrid'),
  generateModeBtn: $('generateModeBtn'),
  editModeBtn: $('editModeBtn'),
  referenceBadge: $('referenceBadge'),
  referenceInput: $('referenceInput'),
  referencePreview: $('referencePreview'),
  pickReferenceBtn: $('pickReferenceBtn'),
  clearPromptBtn: $('clearPromptBtn'),
  duplicateBtn: $('duplicateBtn'),
  sendBtn: $('sendBtn'),
  sendIcon: $('sendIcon'),
  sendText: $('sendText'),
  statusLine: $('statusLine'),
  toastStack: $('toastStack'),
  lightbox: $('lightbox'),
  lightboxImage: $('lightboxImage'),
  lightboxCloseBtn: $('lightboxCloseBtn'),
};

const labels = {
  ratio: { unspecified: '未指定', '1:1': '1:1（正方形）', '16:9': '16:9 横版', '4:3': '4:3 横版', '3:4': '3:4 竖版', '9:16': '9:16 竖版' },
  bg: { auto: '自动背景', transparent: '透明背景' },
  fmt: { png: 'PNG', webp: 'WebP', jpeg: 'JPEG' },
};

function activeSession() {
  return state.sessions.find((session) => session.id === state.activeId) || null;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadState() {
  try {
    state.sessions = JSON.parse(localStorage.getItem(storeKey) || '[]');
  } catch {
    state.sessions = [];
  }
  state.apiKey = localStorage.getItem(apiKeyStoreKey) || '';
  els.apiKey.value = state.apiKey;
  state.activeId = state.sessions[0]?.id || null;
  applySessionToForm(activeSession());
}

function persistSessions() {
  localStorage.setItem(storeKey, JSON.stringify(state.sessions));
}

function persistApiKey(value) {
  state.apiKey = value;
  if (value) localStorage.setItem(apiKeyStoreKey, value);
  else localStorage.removeItem(apiKeyStoreKey);
  updateSendState();
}

function createSession(prompt = '') {
  const session = {
    id: uid(),
    title: prompt ? prompt.slice(0, 24) : '新建草稿',
    prompt,
    images: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: readSettings(),
  };
  state.sessions.unshift(session);
  state.activeId = session.id;
  persistSessions();
  applySessionToForm(session);
  render();
  return session;
}

function updateActiveSession(patch) {
  let session = activeSession();
  if (!session) session = createSession(patch.prompt || '');
  Object.assign(session, patch, { updatedAt: new Date().toISOString() });
  if (patch.prompt !== undefined) session.title = patch.prompt ? patch.prompt.slice(0, 24) : '新建草稿';
  session.settings = readSettings();
  state.sessions = [session, ...state.sessions.filter((item) => item.id !== session.id)];
  state.activeId = session.id;
  persistSessions();
}

function deleteSession(sessionId) {
  const index = state.sessions.findIndex((session) => session.id === sessionId);
  if (index < 0) return;
  const [removed] = state.sessions.splice(index, 1);
  if (state.activeId === sessionId) {
    state.activeId = state.sessions[index]?.id || state.sessions[index - 1]?.id || null;
    applySessionToForm(activeSession());
  }
  persistSessions();
  render();
  toast(`已删除「${removed.title || '会话'}」`);
}

function applySessionToForm(session) {
  els.prompt.value = session?.prompt || '';
  if (session?.settings) {
    els.ratio.value = session.settings.ratio || '1:1';
    els.size.value = normalizeQuality(session.settings.quality || session.settings.size || 'auto');
    els.model.value = session.settings.model || 'gpt-image-2';
    els.background.value = session.settings.background || 'auto';
    els.format.value = session.settings.output_format || 'png';
    els.count.value = session.settings.n || 1;
  }
  reconcileModelSize();
  updateTags();
  updateSendState();
}

function readSettings() {
  reconcileModelSize();
  return {
    model: els.model.value,
    ratio: els.ratio.value,
    quality: normalizeQuality(els.size.value),
    background: els.background.value,
    output_format: els.format.value,
    n: Math.max(1, Math.min(4, Number(els.count.value || 1))),
  };
}

function reconcileModelSize() {
  if (els.model.value === 'gpt-image-2-2k') {
    els.model.value = 'gpt-image-2';
  }
}

function normalizeQuality(value) {
  const legacyMap = { '1K': 'auto', '2K': 'high', '4K': 'high' };
  const normalized = legacyMap[value] || value || 'auto';
  return ['low', 'medium', 'high', 'auto'].includes(normalized) ? normalized : 'auto';
}

function render() {
  renderSessions();
  renderStage();
  updateTags();
  updateSendState();
  els.charCount.textContent = `${els.prompt.value.trim().length} 字`;
}

function renderSessions() {
  els.sessionCount.textContent = String(state.sessions.length);
  els.sessionList.innerHTML = '';
  if (!state.sessions.length) {
    const empty = document.createElement('div');
    empty.className = 'session-card active';
    empty.innerHTML = '<button class="session-main" type="button"><strong>新建草稿</strong><span>输入提示词开始画图</span></button>';
    empty.querySelector('.session-main').addEventListener('click', () => createSession());
    els.sessionList.appendChild(empty);
    return;
  }
  for (const session of state.sessions) {
    const card = document.createElement('div');
    card.className = `session-card${session.id === state.activeId ? ' active' : ''}`;
    card.innerHTML = `
      <button class="session-main" type="button">
        <strong>${escapeHtml(session.title)}</strong>
        <span>${escapeHtml(session.prompt || '空提示词')}</span>
      </button>
      <button class="session-delete" type="button" title="删除会话" aria-label="删除 ${escapeHtml(session.title || '会话')}">×</button>`;
    card.querySelector('.session-main').addEventListener('click', () => {
      state.activeId = session.id;
      applySessionToForm(session);
      closeSidebar();
      render();
    });
    card.querySelector('.session-delete').addEventListener('click', () => {
      if (!confirm('删除这个本地会话？')) return;
      deleteSession(session.id);
    });
    els.sessionList.appendChild(card);
  }
}

function renderStage() {
  const session = activeSession();
  const images = session?.images || [];
  const notice = state.stageStatus;
  const showNotice = Boolean(notice) || !images.length;
  els.emptyState.style.display = showNotice ? 'block' : 'none';
  els.emptyState.className = `empty-state ${notice?.kind || 'idle'}`;
  if (showNotice) els.emptyState.innerHTML = renderStageNotice(notice);
  els.resultGrid.innerHTML = '';
  els.resultGrid.style.display = notice ? 'none' : '';
  if (!images.length || notice) return;
  for (const [index, image] of images.entries()) {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.innerHTML = `
      <img src="${image}" alt="生成结果 ${index + 1}" />
      <div class="result-actions">
        <button class="ghost-button" type="button" data-action="open" data-index="${index}">放大</button>
        <button class="ghost-button" type="button" data-action="download" data-index="${index}">下载</button>
      </div>`;
    els.resultGrid.appendChild(card);
  }
}

function renderStageNotice(notice) {
  const view = notice || {
    kind: 'idle',
    icon: '✦',
    title: '开始一段画图对话',
    message: '写下第一句描述后会创建一个本地会话。后续可以继续追加提示词，也可以带参考图进入编辑模式。',
  };
  return `
    <div class="spark ${escapeHtml(view.kind)}">${escapeHtml(view.icon || '✦')}</div>
    <h3>${escapeHtml(view.title)}</h3>
    <p>${escapeHtml(view.message)}</p>`;
}

function setStageStatus(kind, title, message, icon = '✦') {
  state.stageStatus = { kind, title, message, icon };
  renderStage();
}

function clearStageStatus() {
  state.stageStatus = null;
}

function updateTags() {
  els.modelTag.textContent = els.model.value;
  els.ratioTag.textContent = labels.ratio[els.ratio.value] || els.ratio.value;
  els.sizeTag.textContent = ({ low: '低清晰度', medium: '中清晰度', high: '高清晰度', auto: '自动清晰度' })[normalizeQuality(els.size.value)] || '自动清晰度';
  els.bgTag.textContent = labels.bg[els.background.value] || els.background.value;
  els.fmtTag.textContent = labels.fmt[els.format.value] || els.format.value;
  els.countTag.textContent = String(Math.max(1, Math.min(4, Number(els.count.value || 1))));
  els.modeLabel.textContent = state.mode === 'generate' ? '生成模式' : '编辑模式';
}

function updateSendState() {
  const hasPrompt = Boolean(els.prompt.value.trim());
  els.sendBtn.disabled = state.busy || !hasPrompt;
}

async function sendPrompt() {
  const prompt = els.prompt.value.trim();
  if (!prompt) return toast('先写提示词', 'error');
  if (!state.apiKey.trim()) {
    els.statusLine.textContent = '先填 API Key';
    setStageStatus('error', '缺少 API Key', '请先在右侧输入 API Key，它只会保存在当前浏览器。', '!');
    return toast('先填 API Key', 'error');
  }

  state.busy = true;
  els.sendIcon.textContent = '…';
  els.sendText.textContent = '生成中';
  els.statusLine.textContent = '生成中';
  setStageStatus('loading', '正在生成图片', '请求已提交到 HaHaCode 图片接口，复杂提示词或高分辨率可能需要几十秒。', '…');
  updateSendState();

  try {
    updateActiveSession({ prompt });
    const body = { prompt, ...readSettings(), reference_image: state.referenceImage || undefined };
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.headers.get('Content-Type')?.includes('text/event-stream')) {
      const data = await readImageStream(res, prompt);
      clearStageStatus();
      updateActiveSession({ prompt, images: data.images });
      els.statusLine.textContent = '生成完成';
      toast('图片生成完成');
      return;
    }
    const data = await readApiResponse(res);
    if (!res.ok && data.detail) console.warn('Image API detail:', data.detail);
    if (!res.ok) throw new Error(formatApiError(res.status, data.error || data.message || '生成失败'));
    clearStageStatus();
    updateActiveSession({ prompt, images: data.images || [data.image].filter(Boolean) });
    els.statusLine.textContent = '生成完成';
    toast('图片生成完成');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    els.statusLine.textContent = '生成失败';
    setStageStatus('error', '生成失败', message, '!');
    toast(message, 'error');
  } finally {
    state.busy = false;
    els.sendIcon.textContent = '✦';
    els.sendText.textContent = '发送';
    render();
  }
}

async function readImageStream(res, prompt) {
  if (!res.ok) {
    const data = await readApiResponse(res);
    throw new Error(formatApiError(res.status, data.error || data.message || '生成失败'));
  }
  if (!res.body) throw new Error('浏览器没有收到图片生成流。');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const images = [];
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n+/);
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const event = parseSseChunk(chunk);
      if (!event.data) continue;
      const data = parseJson(event.data);
      if (event.event === 'status') {
        setStageStatus('loading', '正在生成图片', data.message || '模型正在处理，请保持页面打开。', '…');
      }
      if (event.event === 'partial' && data.image) {
        images[data.index || 0] = data.image;
        updateActiveSession({ prompt, images: images.filter(Boolean) });
        setStageStatus('loading', '收到部分图片', '模型还在继续完善图片，请稍等最终结果。', '…');
      }
      if (event.event === 'done') {
        return { images: data.images || images.filter(Boolean) };
      }
      if (event.event === 'error') {
        if (data.detail) console.warn('Image stream detail:', data.detail);
        throw new Error(data.error || '图片生成失败');
      }
    }
  }

  if (images.length) return { images: images.filter(Boolean) };
  throw new Error('图片生成流结束，但没有收到图片。');
}

function parseSseChunk(chunk) {
  const result = { event: '', data: '' };
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith('event:')) result.event = line.slice(6).trim();
    if (line.startsWith('data:')) result.data += line.slice(5).trim();
  }
  return result;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function readApiResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function formatApiError(status, errorText) {
  const message = extractError(errorText);
  if (status === 504) {
    return '上游接口超时（504）：HaHaCode 或其后面的图片模型没有在网关等待时间内返回。建议先用自动清晰度、张数 1 重试，或稍后再试。';
  }
  if (status === 429) return `请求过于频繁或额度不足（429）：${message}`;
  if (status >= 500) return `上游接口异常（${status}）：${message}`;
  return message;
}

function extractError(errorText) {
  try {
    const parsed = JSON.parse(errorText);
    return parsed.error?.message || parsed.message || errorText;
  } catch {
    return String(errorText);
  }
}

function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'error' : ''}`;
  item.textContent = message;
  els.toastStack.appendChild(item);
  setTimeout(() => item.remove(), 3600);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function openSidebar() {
  els.sidebar.classList.add('open');
  els.sidebarBackdrop.classList.add('open');
}

function closeSidebar() {
  els.sidebar.classList.remove('open');
  els.sidebarBackdrop.classList.remove('open');
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function updateReferencePreview(fileName = '') {
  if (!state.referenceImage) {
    els.referencePreview.innerHTML = '<span>参考图</span><button class="ghost-button" id="pickReferenceBtn" type="button">选择图片</button>';
  } else {
    els.referencePreview.innerHTML = `<img src="${state.referenceImage}" alt="参考图" /><span>${escapeHtml(fileName || '已添加参考图')}</span><button class="ghost-button" id="clearReferenceBtn" type="button">移除</button>`;
  }
  bindReferenceButtons();
  els.referenceBadge.textContent = state.referenceImage ? '已添加参考图' : '未添加参考图';
}

function bindReferenceButtons() {
  const pick = $('pickReferenceBtn');
  if (pick) pick.addEventListener('click', () => els.referenceInput.click());
  const clear = $('clearReferenceBtn');
  if (clear) clear.addEventListener('click', () => {
    state.referenceImage = '';
    els.referenceInput.value = '';
    updateReferencePreview();
  });
}

function downloadImage(image, index) {
  const a = document.createElement('a');
  a.href = image;
  a.download = `hahacode-image-${index + 1}.${els.format.value}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openLightbox(image) {
  els.lightboxImage.src = image;
  els.lightbox.classList.add('open');
  els.lightbox.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
  els.lightbox.classList.remove('open');
  els.lightbox.setAttribute('aria-hidden', 'true');
  els.lightboxImage.removeAttribute('src');
}

els.sidebarToggle.addEventListener('click', openSidebar);
els.closeSidebarBtn.addEventListener('click', closeSidebar);
els.sidebarBackdrop.addEventListener('click', closeSidebar);
els.newSessionBtn.addEventListener('click', () => createSession());
els.newSessionTopBtn.addEventListener('click', () => createSession());
els.clearSessionsBtn.addEventListener('click', () => {
  if (!confirm('清空所有本地会话？')) return;
  state.sessions = [];
  state.activeId = null;
  persistSessions();
  applySessionToForm(null);
  render();
});
els.prompt.addEventListener('input', () => {
  if (state.stageStatus?.kind !== 'loading') clearStageStatus();
  updateActiveSession({ prompt: els.prompt.value.trim() });
  render();
});
els.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPrompt();
  }
});
els.apiKey.addEventListener('input', () => persistApiKey(els.apiKey.value.trim()));
els.apiKey.addEventListener('change', () => persistApiKey(els.apiKey.value.trim()));
els.apiKeyForm.addEventListener('submit', (event) => event.preventDefault());
els.toggleKeyBtn.addEventListener('click', () => {
  const next = els.apiKey.type === 'password' ? 'text' : 'password';
  els.apiKey.type = next;
  els.toggleKeyBtn.textContent = next === 'password' ? '显示' : '隐藏';
});
els.generateModeBtn.addEventListener('click', () => {
  state.mode = 'generate';
  els.generateModeBtn.classList.add('active');
  els.editModeBtn.classList.remove('active');
  render();
});
els.editModeBtn.addEventListener('click', () => {
  state.mode = 'edit';
  els.editModeBtn.classList.add('active');
  els.generateModeBtn.classList.remove('active');
  els.referenceInput.click();
  render();
});
['ratio', 'size', 'model', 'background', 'format', 'count'].forEach((id) => {
  $(id).addEventListener('change', () => {
    if (state.stageStatus?.kind !== 'loading') clearStageStatus();
    reconcileModelSize();
    updateActiveSession({ prompt: els.prompt.value.trim() });
    render();
  });
});
els.referenceInput.addEventListener('change', async () => {
  const file = els.referenceInput.files?.[0];
  if (!file) return;
  state.referenceImage = await fileToDataUrl(file);
  state.mode = 'edit';
  els.editModeBtn.classList.add('active');
  els.generateModeBtn.classList.remove('active');
  updateReferencePreview(file.name);
  render();
});
els.clearPromptBtn.addEventListener('click', () => {
  els.prompt.value = '';
  updateActiveSession({ prompt: '' });
  render();
});
els.duplicateBtn.addEventListener('click', () => {
  const session = activeSession();
  if (!session) return createSession();
  const copy = { ...session, id: uid(), title: `${session.title} 副本`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  state.sessions.unshift(copy);
  state.activeId = copy.id;
  persistSessions();
  applySessionToForm(copy);
  render();
});
els.sendBtn.addEventListener('click', sendPrompt);
els.resultGrid.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const index = Number(button.dataset.index);
  const image = activeSession()?.images?.[index];
  if (!image) return;
  if (button.dataset.action === 'open') openLightbox(image);
  if (button.dataset.action === 'download') downloadImage(image, index);
});
els.lightboxCloseBtn.addEventListener('click', closeLightbox);
els.lightbox.addEventListener('click', (event) => {
  if (event.target === els.lightbox) closeLightbox();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.lightbox.classList.contains('open')) closeLightbox();
});

loadState();
bindReferenceButtons();
render();
