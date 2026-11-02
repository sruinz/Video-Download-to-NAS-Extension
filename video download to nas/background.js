importScripts('queue.js');

const QUEUE_STORAGE_KEY = 'vdtnDownloadQueue';
const SESSION_STORAGE_KEY = 'vdtnQueueSessionActive';
const RETRY_ALARM_NAME = 'vdtnQueueRetry';
const WATCHDOG_DELAY_MS = 30_000;
const INTERRUPTED_ERROR = '전송이 중단되어 서버 접수 여부를 확인해 주세요.';
const OPTION_KEYS = ['authMethod', 'restUrl', 'id', 'pw', 'apiToken'];

let queueState = null;
let processingPromise = null;
let saveChain = Promise.resolve();

function storageGet(area, keys) {
  return new Promise((resolve, reject) => {
    area.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(area, values) {
  return new Promise((resolve, reject) => {
    area.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function restoreQueueState(storedState) {
  const state = VdtnQueue.createState();
  if (!storedState || !Array.isArray(storedState.items)) {
    return state;
  }

  state.nextItemId = Number.isInteger(storedState.nextItemId)
    ? storedState.nextItemId
    : storedState.items.length + 1;
  state.nextBatchId = Number.isInteger(storedState.nextBatchId)
    ? storedState.nextBatchId
    : 1;
  state.paused = storedState.paused === true;
  state.resumeRequired = storedState.resumeRequired === true;
  state.items = storedState.items.map((item) => ({ ...item }));
  return state;
}

function failInterruptedSending() {
  for (const item of queueState.items) {
    if (item.status === 'sending') {
      VdtnQueue.updateItem(queueState, item.id, {
        status: 'failed',
        error: INTERRUPTED_ERROR,
        retryAt: null
      });
    }
  }
}

async function updateBadge() {
  if (!queueState) {
    return;
  }
  const summary = VdtnQueue.getSummary(queueState);
  const unaccepted = summary.outstanding + summary.failed;
  const badgeText = unaccepted > 0 ? String(Math.min(unaccepted, 999)) : '';
  const color = summary.failed > 0 ? '#c62828' : '#0f766e';

  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text: badgeText });
}

function saveQueueState() {
  const snapshot = clone(queueState);
  const writePromise = saveChain.then(async () => {
    await storageSet(chrome.storage.local, { [QUEUE_STORAGE_KEY]: snapshot });
  });
  saveChain = writePromise.catch(() => {});
  return writePromise.then(updateBadge);
}

async function initializeQueue() {
  const [localResult, sessionResult] = await Promise.all([
    storageGet(chrome.storage.local, [QUEUE_STORAGE_KEY]),
    storageGet(chrome.storage.session, [SESSION_STORAGE_KEY])
  ]);
  const sameBrowserSession = sessionResult[SESSION_STORAGE_KEY] === true;
  queueState = restoreQueueState(localResult[QUEUE_STORAGE_KEY]);

  await storageSet(chrome.storage.session, { [SESSION_STORAGE_KEY]: true });

  if (sameBrowserSession) {
    failInterruptedSending();
  } else if (VdtnQueue.getSummary(queueState).outstanding > 0) {
    queueState.paused = true;
    queueState.resumeRequired = true;
  }

  await saveQueueState();
}

const initializationPromise = initializeQueue();
initializationPromise
  .then(() => startQueueProcessing())
  .catch((error) => console.error('전송 대기열 초기화 실패:', error));

function normalizeHttpUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  try {
    const parsedUrl = new URL(trimmedValue);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }
    return parsedUrl.href;
  } catch (error) {
    return null;
  }
}

function resolveContextMenuUrl(info, tab) {
  const linkUrl = normalizeHttpUrl(info.linkUrl);
  if (linkUrl) {
    return linkUrl;
  }

  const selectionUrl = normalizeHttpUrl(info.selectionText);
  if (selectionUrl) {
    return selectionUrl;
  }

  if (info.mediaType === 'video') {
    return normalizeHttpUrl(info.srcUrl)
      || normalizeHttpUrl(info.pageUrl)
      || normalizeHttpUrl(tab && tab.url);
  }

  return null;
}

async function resolveContextMenuTarget(info, tab) {
  const linkUrl = normalizeHttpUrl(info && info.linkUrl);
  if (linkUrl) {
    return { url: linkUrl, title: (tab && tab.title) || '' };
  }

  const selectionUrl = normalizeHttpUrl(info && info.selectionText);
  if (selectionUrl) {
    return { url: selectionUrl, title: (tab && tab.title) || '' };
  }

  if (info && info.mediaType === 'video') {
    const directSrcUrl = normalizeHttpUrl(info.srcUrl);
    if (directSrcUrl) {
      return { url: directSrcUrl, title: (tab && tab.title) || '' };
    }

    if (tab && tab.id && chrome.tabs && typeof chrome.tabs.sendMessage === 'function') {
      try {
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { action: 'getContextMenuVideoUrl' }, (res) => {
            if (chrome.runtime.lastError || !res) {
              resolve(null);
            } else {
              resolve(res);
            }
          });
        });
        if (response && normalizeHttpUrl(response.url)) {
          return {
            url: normalizeHttpUrl(response.url),
            title: response.title || (tab.title ? tab.title : '')
          };
        }
      } catch (_error) {
      }
    }
  }

  const fallbackUrl = resolveContextMenuUrl(info, tab);
  return {
    url: fallbackUrl,
    title: (tab && tab.title) || ''
  };
}

function parseRetryAt(response, now = Date.now()) {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return now + Math.max(0, seconds) * 1000;
    }
    const dateValue = Date.parse(retryAfter);
    if (Number.isFinite(dateValue)) {
      return Math.max(now, dateValue);
    }
  }

  const resetValue = Number(response.headers.get('X-RateLimit-Reset'));
  if (Number.isFinite(resetValue) && resetValue > 0) {
    if (resetValue > 1_000_000_000_000) {
      return resetValue;
    }
    if (resetValue > 1_000_000_000) {
      return resetValue * 1000;
    }
    return now + resetValue * 1000;
  }
  return now + 60_000;
}

async function readResponseBody(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function isEligibleCustomFilename(filename, targetUrl) {
  if (typeof filename !== 'string') {
    return false;
  }
  const trimmed = filename.trim();
  if (!trimmed) {
    return false;
  }
  if (normalizeHttpUrl(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return false;
  }
  if (targetUrl) {
    const normalizedTarget = normalizeHttpUrl(targetUrl);
    if (trimmed === targetUrl.trim() || (normalizedTarget && trimmed === normalizedTarget)) {
      return false;
    }
  }
  if (/^watch[\?_]v=/i.test(trimmed)) {
    return false;
  }
  const genericNames = new Set(['videoplayback', 'playlist', 'manifest', 'video', 'audio', 'master']);
  if (genericNames.has(trimmed.toLowerCase())) {
    return false;
  }
  if (targetUrl) {
    try {
      const parsedTarget = new URL(targetUrl);
      const segments = parsedTarget.pathname.split('/').filter(Boolean);
      const lastSegment = segments.at(-1);
      if (lastSegment && trimmed === lastSegment && !/\.[a-z0-9]{2,6}$/i.test(trimmed)) {
        return false;
      }
    } catch (_error) {
      // ignore URL parsing error
    }
  }
  return true;
}

async function sendDownloadRequest(options, url, resolution, filename) {
  const validatedUrl = normalizeHttpUrl(url);
  const restUrl = normalizeHttpUrl(options && options.restUrl);
  if (!validatedUrl) {
    return { kind: 'failed', error: '지원하지 않는 영상 주소입니다.' };
  }
  if (!restUrl) {
    return { kind: 'failed', error: 'VDtN 서버 주소를 확인해 주세요.' };
  }

  const authMethod = options.authMethod || 'password';
  const headers = { 'Content-Type': 'application/json;charset=UTF-8' };
  const body = { url: validatedUrl, resolution: resolution || 'best' };
  if (isEligibleCustomFilename(filename, validatedUrl)) {
    body.filename = filename.trim();
  }

  if (authMethod === 'config_url' || authMethod === 'token') {
    if (!options.apiToken) {
      return { kind: 'failed', error: 'API 토큰이 설정되지 않았습니다.' };
    }
    headers.Authorization = `Bearer ${options.apiToken}`;
  } else {
    body.id = options.id;
    body.pw = options.pw;
  }

  try {
    const response = await fetch(new Request(restUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }));

    if (response.ok) {
      const responseBody = await readResponseBody(response);
      return {
        kind: 'accepted',
        downloadId: responseBody.download_id || responseBody.downloadId || null
      };
    }
    if (response.status === 429) {
      return { kind: 'waiting', retryAt: parseRetryAt(response) };
    }
    return { kind: 'failed', error: `서버 응답 오류 (${response.status})` };
  } catch (error) {
    return { kind: 'failed', error: error.message || '서버 연결에 실패했습니다.' };
  }
}

async function getOptions() {
  return storageGet(chrome.storage.sync, OPTION_KEYS);
}

function scheduleRetry(retryAt) {
  chrome.alarms.create(RETRY_ALARM_NAME, {
    when: Math.max(retryAt, Date.now() + 1000)
  });
}

function scheduleQueueWake() {
  if (queueState.paused || queueState.resumeRequired) {
    return;
  }
  const nextItem = queueState.items.find((item) => (
    item.status === 'pending' || item.status === 'sending' || item.status === 'waiting'
  ));
  if (!nextItem) {
    return;
  }
  if (nextItem.status === 'waiting' && nextItem.retryAt > Date.now()) {
    scheduleRetry(nextItem.retryAt);
    return;
  }
  scheduleRetry(Date.now() + WATCHDOG_DELAY_MS);
}

async function runQueueProcessor() {
  while (!queueState.paused && !queueState.resumeRequired) {
    const nextItem = queueState.items.find((item) => (
      item.status === 'pending' || item.status === 'sending' || item.status === 'waiting'
    ));
    if (!nextItem) {
      await chrome.alarms.clear(RETRY_ALARM_NAME);
      const addedWhileClearing = queueState.items.some((item) => (
        item.status === 'pending' || item.status === 'sending' || item.status === 'waiting'
      ));
      if (addedWhileClearing) {
        continue;
      }
      break;
    }

    if (nextItem.status === 'waiting') {
      if (nextItem.retryAt && nextItem.retryAt > Date.now()) {
        scheduleRetry(nextItem.retryAt);
        break;
      }
      VdtnQueue.updateItem(queueState, nextItem.id, {
        status: 'pending',
        retryAt: null
      });
    }

    if (nextItem.status === 'sending') {
      VdtnQueue.updateItem(queueState, nextItem.id, { status: 'pending' });
    }

    VdtnQueue.updateItem(queueState, nextItem.id, {
      status: 'sending',
      error: null
    });
    await saveQueueState();
    scheduleQueueWake();

    const result = await sendDownloadRequest(
      await getOptions(),
      nextItem.url,
      nextItem.resolution,
      nextItem.title
    );

    if (result.kind === 'accepted') {
      VdtnQueue.updateItem(queueState, nextItem.id, {
        status: 'accepted',
        downloadId: result.downloadId,
        error: null,
        retryAt: null
      });
      await saveQueueState();
      continue;
    }
    if (result.kind === 'waiting') {
      VdtnQueue.updateItem(queueState, nextItem.id, {
        status: 'waiting',
        retryAt: result.retryAt,
        error: '서버 요청 제한으로 대기 중입니다.'
      });
      await saveQueueState();
      scheduleRetry(result.retryAt);
      break;
    }

    VdtnQueue.updateItem(queueState, nextItem.id, {
      status: 'failed',
      error: result.error,
      retryAt: null
    });
    await saveQueueState();
  }
}

function startQueueProcessing() {
  scheduleQueueWake();
  if (processingPromise) {
    return processingPromise;
  }
  processingPromise = runQueueProcessor()
    .catch((error) => console.error('전송 대기열 처리 실패:', error))
    .finally(() => {
      processingPromise = null;
    });
  return processingPromise;
}

async function enqueueDownloads(candidates, source) {
  await initializationPromise;
  const validCandidates = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      url: normalizeHttpUrl(candidate && candidate.url),
      title: candidate && candidate.title,
      resolution: candidate && candidate.resolution
    }))
    .filter((candidate) => candidate.url);
  const result = VdtnQueue.enqueue(
    queueState,
    validCandidates,
    source || {},
    Date.now()
  );
  await saveQueueState();
  startQueueProcessing();
  return { ok: true, ...result, summary: VdtnQueue.getSummary(queueState) };
}

function queueResponse() {
  return {
    ok: true,
    state: clone(queueState),
    summary: VdtnQueue.getSummary(queueState)
  };
}

async function handleQueueMessage(request, sender) {
  await initializationPromise;

  if (request.action === 'enqueueDownloads') {
    return enqueueDownloads(request.candidates, request.source);
  }
  if (request.action === 'downloadVideo') {
    return enqueueDownloads(
      [{ url: request.url, resolution: request.resolution || 'best' }],
      {
        title: sender && sender.tab ? sender.tab.title : '',
        url: sender && sender.tab ? sender.tab.url : ''
      }
    );
  }
  if (request.action === 'getQueueState') {
    return queueResponse();
  }
  if (request.action === 'pauseQueue') {
    queueState.paused = true;
    queueState.resumeRequired = false;
    await saveQueueState();
    return queueResponse();
  }
  if (request.action === 'resumeQueue') {
    const recoveryRequired = queueState.resumeRequired;
    queueState.paused = false;
    queueState.resumeRequired = false;
    if (recoveryRequired) {
      failInterruptedSending();
    }
    await saveQueueState();
    startQueueProcessing();
    return queueResponse();
  }
  if (request.action === 'retryFailed') {
    const changed = VdtnQueue.retryFailed(queueState);
    await saveQueueState();
    startQueueProcessing();
    return { ...queueResponse(), changed };
  }
  if (request.action === 'removePending') {
    const changed = VdtnQueue.removePending(queueState);
    await saveQueueState();
    return { ...queueResponse(), changed };
  }
  if (request.action === 'clearAccepted') {
    const changed = VdtnQueue.clearAccepted(queueState);
    await saveQueueState();
    return { ...queueResponse(), changed };
  }
  return { ok: false, error: '지원하지 않는 요청입니다.' };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleQueueMessage(request, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== RETRY_ALARM_NAME) {
    return;
  }
  await initializationPromise;
  if (queueState.paused || queueState.resumeRequired) {
    return;
  }
  const now = Date.now();
  for (const item of queueState.items) {
    if (item.status === 'waiting' && (!item.retryAt || item.retryAt <= now)) {
      item.status = 'pending';
      item.retryAt = null;
      item.error = null;
    }
  }
  await saveQueueState();
  return startQueueProcessing();
});

chrome.action.onClicked.addListener((tab) => {
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'findVideos' }, () => {
      if (chrome.runtime.lastError) {
        console.error('영상 선택 화면을 열지 못했습니다:', chrome.runtime.lastError);
      }
    });
  }
});

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'my-extension',
      title: 'Download with VDtN',
      contexts: ['link', 'selection', 'video']
    });

    const resolutions = [
      'best', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'
    ];
    for (const resolution of resolutions) {
      chrome.contextMenus.create({
        parentId: 'my-extension',
        id: resolution,
        title: resolution,
        type: 'radio',
        contexts: ['link', 'selection', 'video']
      });
    }

    chrome.contextMenus.create({
      parentId: 'my-extension', id: 'sep1', type: 'separator',
      contexts: ['link', 'selection', 'video']
    });
    for (const format of ['audio-m4a', 'audio-mp3']) {
      chrome.contextMenus.create({
        parentId: 'my-extension', id: format, title: format, type: 'radio',
        contexts: ['link', 'selection', 'video']
      });
    }

    chrome.contextMenus.create({
      parentId: 'my-extension', id: 'sep2', type: 'separator',
      contexts: ['link', 'selection', 'video']
    });
    const languages = [
      { code: 'ko', title: 'Korean' },
      { code: 'en', title: 'English' },
      { code: 'ja', title: 'Japanese' }
    ];
    for (const format of ['srt', 'vtt']) {
      const parentId = `${format}-parent`;
      chrome.contextMenus.create({
        parentId: 'my-extension', id: parentId, title: format,
        contexts: ['link', 'selection', 'video']
      });
      for (const language of languages) {
        chrome.contextMenus.create({
          parentId, id: `${format}|${language.code}`, title: language.title,
          type: 'radio', contexts: ['link', 'selection', 'video']
        });
      }
    }
  });
}

createContextMenu();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (String(info.menuItemId).startsWith('sep')) {
    return;
  }
  const target = await resolveContextMenuTarget(info, tab);
  if (!target || !target.url) {
    return;
  }
  await enqueueDownloads(
    [{ url: target.url, title: target.title, resolution: String(info.menuItemId) }],
    { title: tab && tab.title ? tab.title : '', url: tab && tab.url ? tab.url : '' }
  );
});
