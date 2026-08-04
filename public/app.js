const $ = (id) => document.getElementById(id);
const storeKey = 'hahacode.image.sessions';
const apiKeyStoreKey = 'hahacode.image.apiKey';
const defaultModel = 'gpt-image-2';
const imageDbName = 'hahacode.image.storage';
const imageStoreName = 'session-images';
const imageRefPrefix = 'idb:';
let imageDbPromise = null;
const sessionRequests = new Map();

const state = {
  sessions: [],
  activeId: null,
  apiKey: '',
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

function findSession(sessionId) {
  return state.sessions.find((session) => session.id === sessionId) || null;
}

function defaultSettings() {
  return {
    model: defaultModel,
    ratio: '1:1',
    quality: 'auto',
    background: 'auto',
    output_format: 'png',
    n: 1,
  };
}

function normalizeSettings(settings = {}) {
  const defaults = defaultSettings();
  return {
    model: settings.model === 'gpt-image-2-2k' ? defaultModel : settings.model || defaults.model,
    ratio: settings.ratio || defaults.ratio,
    quality: normalizeQuality(settings.quality || settings.size || defaults.quality),
    background: settings.background || defaults.background,
    output_format: settings.output_format || defaults.output_format,
    n: Math.max(1, Math.min(4, Number(settings.n || defaults.n))),
  };
}

function normalizeSession(value) {
  const session = value && typeof value === 'object' ? value : {};
  const prompt = typeof session.prompt === 'string' ? session.prompt : '';
  let stageStatus = session.stageStatus && typeof session.stageStatus === 'object' ? session.stageStatus : null;
  let statusText = typeof session.statusText === 'string'
    ? session.statusText
    : Array.isArray(session.images) && session.images.length ? '生成完成' : '准备就绪';

  if (stageStatus?.kind === 'loading') {
    stageStatus = {
      kind: 'error',
      icon: '!',
      title: '生成已中断',
      message: '页面刷新后无法继续跟踪上一条生成请求，请重新发送。',
    };
    statusText = '生成已中断';
  }

  return {
    ...session,
    id: typeof session.id === 'string' && session.id ? session.id : uid(),
    title: typeof session.title === 'string' && session.title ? session.title : prompt.slice(0, 24) || '新建草稿',
    prompt,
    images: Array.isArray(session.images) ? session.images.filter((image) => typeof image === 'string' && image) : [],
    settings: normalizeSettings(session.settings),
    mode: session.mode === 'edit' ? 'edit' : 'generate',
    referenceImage: typeof session.referenceImage === 'string' ? session.referenceImage : '',
    referenceName: typeof session.referenceName === 'string' ? session.referenceName : '',
    stageStatus,
    statusText,
    busy: false,
  };
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadState() {
  try {
    const storedSessions = JSON.parse(localStorage.getItem(storeKey) || '[]');
    state.sessions = Array.isArray(storedSessions) ? storedSessions.map(normalizeSession) : [];
  } catch {
    state.sessions = [];
  }
  await hydrateStoredImages();
  state.apiKey = localStorage.getItem(apiKeyStoreKey) || '';
  els.apiKey.value = state.apiKey;
  state.activeId = state.sessions[0]?.id || null;
  persistSessions();
  applySessionToForm(activeSession());
}

function persistSessions() {
  const sessions = state.sessions.map((session) => {
    const stored = { ...session };
    delete stored._persistedImages;
    delete stored._persistedReference;
    delete stored.busy;
    stored.images = (session.images || []).map((image, index) => {
      if (!isEmbeddedImage(image)) return image;
      if (!('indexedDB' in window)) return '';

      const key = storedImageKey(session.id, index);
      session._persistedImages ||= {};
      if (session._persistedImages[index] !== image) {
        session._persistedImages[index] = image;
        storeImageValue(key, image).catch((error) => console.warn('Failed to store session image:', error));
      }
      return `${imageRefPrefix}${key}`;
    });
    if (isEmbeddedImage(session.referenceImage)) {
      if (!('indexedDB' in window)) {
        stored.referenceImage = '';
      } else {
        const key = storedReferenceKey(session.id);
        if (session._persistedReference !== session.referenceImage) {
          session._persistedReference = session.referenceImage;
          storeImageValue(key, session.referenceImage).catch((error) => console.warn('Failed to store reference image:', error));
        }
        stored.referenceImage = `${imageRefPrefix}${key}`;
      }
    }
    return stored;
  });

  const serialized = JSON.stringify(sessions);
  try {
    localStorage.setItem(storeKey, serialized);
  } catch (error) {
    try {
      localStorage.removeItem(storeKey);
      localStorage.setItem(storeKey, serialized);
    } catch (retryError) {
      console.warn('Failed to store session metadata:', retryError || error);
    }
  }
}

function isEmbeddedImage(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function storedImageKey(sessionId, index) {
  return `${sessionId}:${index}`;
}

function storedReferenceKey(sessionId) {
  return `${sessionId}:reference`;
}

function openImageDb() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
  if (imageDbPromise) return imageDbPromise;

  imageDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(imageDbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(imageStoreName)) {
        request.result.createObjectStore(imageStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
  return imageDbPromise;
}

async function runImageStore(mode, operation) {
  const db = await openImageDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(imageStoreName, mode);
    const store = transaction.objectStore(imageStoreName);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB operation failed'));
  });
}

function storeImageValue(key, value) {
  return runImageStore('readwrite', (store) => store.put(value, key));
}

function loadImageValue(key) {
  return runImageStore('readonly', (store) => store.get(key));
}

function deleteImageValue(key) {
  return runImageStore('readwrite', (store) => store.delete(key));
}

function clearImageValues() {
  return runImageStore('readwrite', (store) => store.clear());
}

async function hydrateStoredImages() {
  await Promise.all(state.sessions.map(async (session) => {
    const images = await Promise.all((session.images || []).map(async (image, index) => {
      if (typeof image !== 'string' || !image.startsWith(imageRefPrefix)) return image;
      try {
        const value = await loadImageValue(image.slice(imageRefPrefix.length));
        if (value) {
          session._persistedImages ||= {};
          session._persistedImages[index] = value;
        }
        return value || '';
      } catch {
        return '';
      }
    }));
    session.images = images.filter(Boolean);

    if (typeof session.referenceImage === 'string' && session.referenceImage.startsWith(imageRefPrefix)) {
      try {
        const value = await loadImageValue(session.referenceImage.slice(imageRefPrefix.length));
        session.referenceImage = typeof value === 'string' ? value : '';
        session._persistedReference = session.referenceImage;
      } catch {
        session.referenceImage = '';
      }
    }
  }));
}

function persistApiKey(value) {
  state.apiKey = value;
  if (value) localStorage.setItem(apiKeyStoreKey, value);
  else localStorage.removeItem(apiKeyStoreKey);
  updateSendState();
}

function createSession(prompt = '', initial = {}) {
  const now = new Date().toISOString();
  const session = normalizeSession({
    id: uid(),
    title: prompt ? prompt.slice(0, 24) : '新建草稿',
    prompt,
    images: [],
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    ...initial,
  });
  state.sessions.unshift(session);
  state.activeId = session.id;
  persistSessions();
  applySessionToForm(session);
  render();
  return session;
}

function updateSession(sessionId, patch, { moveToFront = false } = {}) {
  const session = findSession(sessionId);
  if (!session) return null;

  Object.assign(session, patch, { updatedAt: new Date().toISOString() });
  if (patch.prompt !== undefined) session.title = patch.prompt ? patch.prompt.slice(0, 24) : '新建草稿';
  if (patch.settings) session.settings = normalizeSettings(patch.settings);
  if (moveToFront) state.sessions = [session, ...state.sessions.filter((item) => item.id !== session.id)];
  persistSessions();
  return session;
}

function updateActiveSession(patch) {
  let session = activeSession();
  if (!session) session = createSession(patch.prompt || '');
  return updateSession(session.id, {
    settings: readSettings(),
    ...patch,
  }, { moveToFront: true });
}

function deleteSession(sessionId) {
  const index = state.sessions.findIndex((session) => session.id === sessionId);
  if (index < 0) return;
  abortSessionRequest(sessionId);
  const [removed] = state.sessions.splice(index, 1);
  for (let imageIndex = 0; imageIndex < Math.max(4, removed.images?.length || 0); imageIndex += 1) {
    deleteImageValue(storedImageKey(sessionId, imageIndex)).catch(() => undefined);
  }
  deleteImageValue(storedReferenceKey(sessionId)).catch(() => undefined);
  if (state.activeId === sessionId) {
    state.activeId = state.sessions[index]?.id || state.sessions[index - 1]?.id || null;
    applySessionToForm(activeSession());
  }
  persistSessions();
  render();
  toast(`已删除「${removed.title || '会话'}」`);
}

function applySessionToForm(session) {
  const settings = normalizeSettings(session?.settings);
  els.prompt.value = session?.prompt || '';
  els.ratio.value = settings.ratio;
  els.size.value = settings.quality;
  els.model.value = settings.model;
  els.background.value = settings.background;
  els.format.value = settings.output_format;
  els.count.value = settings.n;
  els.referenceInput.value = '';
  reconcileModelSize();
  updateReferencePreview(session);
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
  if (!els.model.value) els.model.value = defaultModel;

  const singleImageOnly = els.model.value.startsWith('gpt-image-nana-');
  if (singleImageOnly) els.count.value = '1';
  els.count.disabled = singleImageOnly;
  els.count.title = singleImageOnly ? '该模型每次生成 1 张图片' : '';
}

function normalizeQuality(value) {
  const legacyMap = { '1K': 'auto', '2K': 'high', '4K': 'high' };
  const normalized = legacyMap[value] || value || 'auto';
  return ['low', 'medium', 'high', 'auto'].includes(normalized) ? normalized : 'auto';
}

function render() {
  const session = activeSession();
  els.draftTitle.textContent = session?.title || '新建草稿';
  els.draftSubtitle.textContent = session
    ? `${session.statusText || '准备就绪'} · API Key 只保存在当前浏览器。`
    : '输入提示词开始画图。API Key 只保存在当前浏览器。';
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
    const sessionStatus = session.busy ? '生成中' : session.stageStatus?.kind === 'error' ? '生成失败' : '';
    card.innerHTML = `
      <button class="session-main" type="button">
        <strong>${escapeHtml(session.title)}</strong>
        <span>${escapeHtml(session.prompt || '空提示词')}${sessionStatus ? ` · ${escapeHtml(sessionStatus)}` : ''}</span>
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
  const notice = session?.stageStatus || null;
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

function setSessionStageStatus(sessionId, kind, title, message, icon = '✦') {
  const session = updateSession(sessionId, {
    stageStatus: { kind, title, message, icon },
    statusText: kind === 'loading' ? '生成中' : title,
  });
  if (session) render();
}

function clearSessionStageStatus(sessionId, statusText) {
  const session = findSession(sessionId);
  if (!session) return;
  updateSession(sessionId, {
    stageStatus: null,
    statusText: statusText || (session.images?.length ? '生成完成' : '准备就绪'),
  });
}

function updateTags() {
  const mode = activeSession()?.mode || 'generate';
  els.modelTag.textContent = els.model.value;
  els.ratioTag.textContent = labels.ratio[els.ratio.value] || els.ratio.value;
  els.sizeTag.textContent = ({ low: '低清晰度', medium: '中清晰度', high: '高清晰度', auto: '自动清晰度' })[normalizeQuality(els.size.value)] || '自动清晰度';
  els.bgTag.textContent = labels.bg[els.background.value] || els.background.value;
  els.fmtTag.textContent = labels.fmt[els.format.value] || els.format.value;
  els.countTag.textContent = String(Math.max(1, Math.min(4, Number(els.count.value || 1))));
  els.modeLabel.textContent = mode === 'generate' ? '生成模式' : '编辑模式';
  els.generateModeBtn.classList.toggle('active', mode === 'generate');
  els.editModeBtn.classList.toggle('active', mode === 'edit');
}

function updateSendState() {
  const hasPrompt = Boolean(els.prompt.value.trim());
  const session = activeSession();
  const busy = Boolean(session?.busy);
  els.sendBtn.disabled = busy || !hasPrompt;
  els.sendIcon.textContent = busy ? '…' : '✦';
  els.sendText.textContent = busy ? '生成中' : '发送';
  els.statusLine.textContent = session?.statusText || '准备就绪';
}

function startSessionRequest(sessionId) {
  abortSessionRequest(sessionId);
  const id = uid();
  const controller = new AbortController();
  const request = { id, controller };
  sessionRequests.set(sessionId, request);
  return request;
}

function isCurrentRequest(sessionId, requestId) {
  return Boolean(findSession(sessionId) && sessionRequests.get(sessionId)?.id === requestId);
}

function finishSessionRequest(sessionId, requestId) {
  const request = sessionRequests.get(sessionId);
  if (!request || request.id !== requestId) return;
  sessionRequests.delete(sessionId);
}

function abortSessionRequest(sessionId) {
  const request = sessionRequests.get(sessionId);
  if (!request) return;
  sessionRequests.delete(sessionId);
  request.controller.abort();
}

async function sendPrompt() {
  const prompt = els.prompt.value.trim();
  if (!prompt) return toast('先写提示词', 'error');
  let session = activeSession() || createSession(prompt);
  const sessionId = session.id;
  if (!state.apiKey.trim()) {
    setSessionStageStatus(sessionId, 'error', '缺少 API Key', '请先在右侧输入 API Key，它只会保存在当前浏览器。', '!');
    return toast('先填 API Key', 'error');
  }

  const settings = readSettings();
  session = updateSession(sessionId, { prompt, settings }, { moveToFront: true });
  const referenceImage = session.mode === 'edit' ? session.referenceImage : '';
  const request = startSessionRequest(sessionId);
  updateSession(sessionId, {
    busy: true,
    statusText: '生成中',
    stageStatus: {
      kind: 'loading',
      title: '正在生成图片',
      message: '请求已提交到 HaHaCode 图片接口，复杂提示词或高分辨率可能需要几十秒。',
      icon: '…',
    },
  });
  render();

  try {
    const body = { prompt, ...settings, reference_image: referenceImage || undefined };
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.apiKey.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.controller.signal,
    });
    if (res.headers.get('Content-Type')?.includes('text/event-stream')) {
      const data = await readImageStream(res, {
        sessionId,
        requestId: request.id,
        prompt,
        format: settings.output_format,
      });
      if (!isCurrentRequest(sessionId, request.id)) return;
      updateSession(sessionId, {
        prompt,
        images: data.images,
        stageStatus: null,
        statusText: data.incomplete ? '已保留部分结果' : '生成完成',
        busy: false,
      });
      render();
      if (state.activeId === sessionId) {
        toast(data.incomplete ? '最终图片传输中断，已保留收到的预览图。' : '图片生成完成', data.incomplete ? 'error' : 'success');
      }
      return;
    }
    const data = await readApiResponse(res);
    if (!res.ok && data.detail) console.warn('Image API detail:', data.detail);
    if (!res.ok) throw new Error(formatApiError(res.status, data.error || data.message || '生成失败'));
    if (!isCurrentRequest(sessionId, request.id)) return;
    updateSession(sessionId, {
      prompt,
      images: data.images || [data.image].filter(Boolean),
      stageStatus: null,
      statusText: '生成完成',
      busy: false,
    });
    render();
    if (state.activeId === sessionId) toast('图片生成完成');
  } catch (error) {
    if (!isCurrentRequest(sessionId, request.id)) return;
    const message = formatRequestError(error, request.controller.signal);
    updateSession(sessionId, {
      busy: false,
      statusText: '生成失败',
      stageStatus: { kind: 'error', title: '生成失败', message, icon: '!' },
    });
    render();
    if (state.activeId === sessionId) toast(message, 'error');
  } finally {
    if (isCurrentRequest(sessionId, request.id)) {
      updateSession(sessionId, { busy: false });
      finishSessionRequest(sessionId, request.id);
    }
    render();
  }
}

async function readImageStream(res, context) {
  const { sessionId, requestId, prompt, format } = context;
  if (!res.ok) {
    const data = await readApiResponse(res);
    throw new Error(formatApiError(res.status, data.error || data.message || '生成失败'));
  }
  if (!res.body) throw new Error('浏览器没有收到图片生成流。');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const images = [];
  let buffer = '';

  const processChunk = (chunk) => {
    const event = parseSseChunk(chunk);
    if (!event.data || event.data === '[DONE]') return null;
    const data = parseJson(event.data);
    const type = data.type || event.event || data.object;

    if (type === 'status' || type === 'image_generation.started') {
      setSessionStageStatus(sessionId, 'loading', '正在生成图片', data.message || '模型正在处理，请保持页面打开。', '…');
    }
    if (type === 'image_generation.status') {
      const progress = Number(data.progress);
      const message = Number.isFinite(progress)
        ? `图片生成中，当前进度 ${Math.max(0, Math.min(100, progress))}%...`
        : '图片生成中，请保持页面打开。';
      setSessionStageStatus(sessionId, 'loading', '正在生成图片', message, '…');
    }
    if (type === 'image.generation.chunk') {
      const message = String(data.progress_text || '').trim() || '模型正在生成图片，请保持页面打开。';
      setSessionStageStatus(sessionId, 'loading', '正在生成图片', message, '…');
    }

    const isPartial = type === 'partial'
      || type === 'image_generation.partial_image'
      || type === 'response.image_generation_call.partial_image';
    const partialValue = data.image || data.b64_json || data.partial_image_b64;
    if (isPartial && partialValue) {
      const index = data.index ?? data.partial_image_index ?? 0;
      images[index] = normalizeStreamImageValue(partialValue, format);
      updateSession(sessionId, { prompt, images: images.filter(Boolean) });
      setSessionStageStatus(sessionId, 'loading', '收到部分图片', '模型还在继续完善图片，请稍等最终结果。', '…');
    }

    const isCompleted = type === 'done'
      || type === 'image_generation.completed'
      || type === 'image.generation.result'
      || type === 'response.output_item.done'
      || type === 'response.completed';
    if (isCompleted) {
      const completedImages = extractStreamImages(data, format);
      if (completedImages.length) return { images: completedImages, incomplete: false };
      if (type === 'done' && images.length) return { images: images.filter(Boolean), incomplete: false };
      if (type !== 'response.completed') throw new Error('上游返回了完成事件，但没有图片地址。');
    }

    if (type === 'error') {
      if (data.detail) console.warn('Image stream detail:', data.detail);
      throw new Error(data.error?.message || data.error || data.message || '图片生成失败');
    }
    return null;
  };

  while (true) {
    let result;
    try {
      result = await reader.read();
    } catch (error) {
      if (images.length) {
        console.warn('Final image stream was interrupted; keeping partial images:', error);
        return { images: images.filter(Boolean), incomplete: true };
      }
      throw error;
    }
    const { value, done } = result;
    if (done) break;
    if (!isCurrentRequest(sessionId, requestId)) {
      await reader.cancel();
      throw new DOMException('Session request was cancelled', 'AbortError');
    }
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n+/);
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const completed = processChunk(chunk);
      if (completed) return completed;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const completed = processChunk(buffer);
    if (completed) return completed;
  }

  if (images.length) return { images: images.filter(Boolean), incomplete: true };
  throw new Error('图片生成流结束，但没有收到图片。');
}

function formatRequestError(error, signal) {
  const reason = signal.reason || error;
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/network error|failed to fetch|networkerror|load failed/i.test(message)) {
    return '图片返回链路在传输完成前中断。上游可能已经生成并产生使用记录，请先到 HaHaCode 使用记录确认后再决定是否重试。';
  }
  return message;
}

function extractStreamImages(data, format) {
  const values = [];
  const collect = (item) => {
    if (!item) return;
    if (typeof item === 'string') {
      values.push(normalizeStreamImageValue(item, format));
      return;
    }

    const inlineValue = item.b64_json || item.partial_image_b64 || item.result;
    if (inlineValue) values.push(normalizeStreamImageValue(inlineValue, item.output_format || format));
    if (item.image) values.push(normalizeStreamImageValue(item.image, item.output_format || format));
    if (item.image_url) values.push(item.image_url);
    if (!inlineValue && item.url) values.push(item.url);
    for (const content of item.content || []) collect(content);
  };

  collect(data);
  for (const item of data.data || []) collect(item);
  for (const item of data.images || []) collect(item);
  for (const item of data.output || []) collect(item);
  for (const item of data.response?.output || []) collect(item);
  if (data.item) collect(data.item);

  return values.filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}

function normalizeStreamImageValue(value, format) {
  if (!value) return '';
  if (value.startsWith('data:image/') || value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `data:image/${format};base64,${value}`;
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
  if (/current account image benefits do not support the requested image parameters/i.test(message)) {
    const requestId = message.match(/request id:\s*([^\s)]+)/i)?.[1];
    return `当前上游图片账号的生成权益不可用或已耗尽，这与 API Key 的 HaHaCode 余额无关。请切换其他生图模型，或等待上游账号恢复后重试。${requestId ? `（request id: ${requestId}）` : ''}`;
  }
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

function updateReferencePreview(session = activeSession()) {
  const referenceImage = session?.referenceImage || '';
  if (!referenceImage) {
    els.referencePreview.innerHTML = '<span>参考图</span><button class="ghost-button" id="pickReferenceBtn" type="button">选择图片</button>';
  } else {
    els.referencePreview.innerHTML = `<img src="${referenceImage}" alt="参考图" /><span>${escapeHtml(session.referenceName || '已添加参考图')}</span><button class="ghost-button" id="clearReferenceBtn" type="button">移除</button>`;
  }
  bindReferenceButtons();
  els.referenceBadge.textContent = referenceImage ? '已添加参考图' : '未添加参考图';
}

function bindReferenceButtons() {
  const pick = $('pickReferenceBtn');
  if (pick) pick.addEventListener('click', () => els.referenceInput.click());
  const clear = $('clearReferenceBtn');
  if (clear) clear.addEventListener('click', () => {
    const session = activeSession();
    if (!session) return;
    deleteImageValue(storedReferenceKey(session.id)).catch(() => undefined);
    updateSession(session.id, { referenceImage: '', referenceName: '', _persistedReference: '' });
    els.referenceInput.value = '';
    updateReferencePreview(session);
    render();
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
  for (const sessionId of [...sessionRequests.keys()]) abortSessionRequest(sessionId);
  state.sessions = [];
  state.activeId = null;
  clearImageValues().catch(() => undefined);
  persistSessions();
  applySessionToForm(null);
  render();
});
els.prompt.addEventListener('input', () => {
  const session = activeSession();
  if (session && session.stageStatus?.kind !== 'loading') clearSessionStageStatus(session.id);
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
  const session = activeSession() || createSession();
  updateSession(session.id, { mode: 'generate', settings: readSettings() }, { moveToFront: true });
  render();
});
els.editModeBtn.addEventListener('click', () => {
  const session = activeSession() || createSession();
  updateSession(session.id, { mode: 'edit', settings: readSettings() }, { moveToFront: true });
  if (!session.referenceImage) els.referenceInput.click();
  render();
});
['ratio', 'size', 'model', 'background', 'format', 'count'].forEach((id) => {
  $(id).addEventListener('change', () => {
    const session = activeSession();
    if (session && session.stageStatus?.kind !== 'loading') clearSessionStageStatus(session.id);
    reconcileModelSize();
    updateActiveSession({ prompt: els.prompt.value.trim() });
    render();
  });
});
els.referenceInput.addEventListener('change', async () => {
  const file = els.referenceInput.files?.[0];
  if (!file) return;
  const session = activeSession() || createSession();
  const referenceImage = await fileToDataUrl(file);
  updateSession(session.id, {
    referenceImage,
    referenceName: file.name,
    mode: 'edit',
    settings: readSettings(),
  }, { moveToFront: true });
  updateReferencePreview(session);
  render();
});
els.clearPromptBtn.addEventListener('click', () => {
  els.prompt.value = '';
  const session = activeSession();
  if (session && session.stageStatus?.kind !== 'loading') clearSessionStageStatus(session.id);
  updateActiveSession({ prompt: '' });
  render();
});
els.duplicateBtn.addEventListener('click', () => {
  const session = activeSession();
  if (!session) return createSession();
  const now = new Date().toISOString();
  const copy = normalizeSession({
    ...session,
    id: uid(),
    title: `${session.title} 副本`,
    images: [...(session.images || [])],
    settings: { ...session.settings },
    stageStatus: null,
    statusText: session.images?.length ? '生成完成' : '准备就绪',
    busy: false,
    createdAt: now,
    updatedAt: now,
    _persistedImages: {},
    _persistedReference: '',
  });
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

async function initialize() {
  await loadState();
  bindReferenceButtons();
  render();
}

initialize();
