(function initializeContentSelector(globalScope) {
  'use strict';

  const INTERRUPTED_ERROR = '전송이 중단되어 서버 접수 여부를 확인해 주세요.';
  let activeSelector = null;

  function toHttpUrl(value) {
    if (typeof value !== 'string' || value.length === 0) return '';
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch (_error) {
      return '';
    }
  }

  function candidateName(url) {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).at(-1) || parsed.hostname;
  }

  function linkedCandidateName(pageDocument, url) {
    for (const link of pageDocument.querySelectorAll('a[href]')) {
      if (toHttpUrl(link.href) !== url) continue;
      const downloadName = link.getAttribute?.('download')?.trim();
      if (downloadName) return downloadName;
      const directText = Array.from(link.childNodes || [])
        .filter((node) => node.nodeType === 3)
        .map((node) => node.nodeValue || '')
        .join(' ')
        .trim();
      if (directText) return directText;
    }
    return '';
  }

  function addCandidate(candidates, seenUrls, url, details) {
    if (!url || seenUrls.has(url)) return;
    const parsed = new URL(url);
    seenUrls.add(url);
    candidates.push({
      url,
      poster: details.poster || '',
      title: details.title || candidateName(url),
      domain: parsed.hostname,
      video: details.video || null
    });
  }

  function selectPreviewVideo(videos) {
    return videos.find((video) => video.paused === false && !video.ended)
      || videos.find((video) => video.readyState >= 2)
      || videos[0]
      || null;
  }

  function backgroundImageUrl(value) {
    if (typeof value !== 'string' || value === 'none') return '';
    const match = value.match(/^url\(["']?(.*?)["']?\)$/);
    return toHttpUrl(match?.[1] || '');
  }

  function nearbyPreviewImage(pageDocument, video) {
    if (!video) return '';
    const poster = toHttpUrl(video.poster || '');
    if (poster) return poster;
    let element = video;
    for (let depth = 0; element && depth < 4; depth += 1) {
      const image = element.querySelector?.('img');
      const imageUrl = toHttpUrl(image?.currentSrc || image?.src || image?.getAttribute?.('data-src') || '');
      if (imageUrl) return imageUrl;
      const style = pageDocument.defaultView?.getComputedStyle?.(element);
      const backgroundUrl = backgroundImageUrl(style?.backgroundImage || '');
      if (backgroundUrl) return backgroundUrl;
      element = element.parentElement;
    }
    return '';
  }

  function hasSpecificPagePath(value) {
    const url = toHttpUrl(value);
    if (!url) return false;
    return new URL(url).pathname.split('/').some(Boolean);
  }

  function pagePreviewImage(pageDocument) {
    const meta = pageDocument.querySelector?.('meta[property="og:image"], meta[name="twitter:image"]');
    return toHttpUrl(meta?.content || '');
  }

  function collectCandidates(pageDocument) {
    const candidates = [];
    const seenUrls = new Set();
    const videos = Array.from(pageDocument.querySelectorAll('video'));
    for (const video of videos) {
      const url = toHttpUrl(video.currentSrc) || toHttpUrl(video.src);
      addCandidate(candidates, seenUrls, url, {
        poster: nearbyPreviewImage(pageDocument, video),
        title: linkedCandidateName(pageDocument, url),
        video
      });
    }
    if (candidates.length > 0) return candidates;
    if (videos.length > 0) {
      if (!hasSpecificPagePath(pageDocument.URL)) return candidates;
      const previewVideo = selectPreviewVideo(videos);
      addCandidate(candidates, seenUrls, toHttpUrl(pageDocument.URL), {
        title: pageDocument.title || '',
        poster: nearbyPreviewImage(pageDocument, previewVideo) || pagePreviewImage(pageDocument),
        video: previewVideo
      });
      return candidates;
    }
    for (const frame of pageDocument.querySelectorAll('iframe')) {
      addCandidate(candidates, seenUrls, toHttpUrl(frame.src), {});
    }
    return candidates;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
      } catch (_error) {
        resolve({});
      }
    });
  }

  function statusText(status) {
    return {
      pending: '전송 대기',
      sending: '서버에 전송 중',
      waiting: '제한으로 대기 중',
      accepted: '서버 접수 완료',
      failed: '전송 실패'
    }[status] || '상태 확인 중';
  }

  function queueItemPresentation(item) {
    const interrupted = item.status === 'failed' && item.error === INTERRUPTED_ERROR;
    return {
      status: interrupted ? '서버 접수 여부 확인 필요' : statusText(item.status),
      error: item.error || ''
    };
  }

  function formatTime(timestamp) {
    return timestamp ? new Date(timestamp).toLocaleString('ko-KR') : '';
  }

  function getSummary(queueState) {
    const summary = { pending: 0, sending: 0, waiting: 0, accepted: 0, failed: 0, outstanding: 0 };
    for (const item of queueState.items || []) {
      if (Object.hasOwn(summary, item.status)) summary[item.status] += 1;
      if (['pending', 'sending', 'waiting'].includes(item.status)) summary.outstanding += 1;
    }
    return summary;
  }

  function appendThumbnail(pageDocument, candidate, container) {
    if (candidate.frameCanvas) {
      if (candidate.frameCanvas.height > candidate.frameCanvas.width) container.classList?.add('portrait');
      candidate.frameCanvas.style.objectFit = 'contain';
      container.appendChild(candidate.frameCanvas);
      return;
    }
    const video = candidate.video;
    if (video && video.readyState >= 2 && !candidate.frameCaptureTried) {
      candidate.frameCaptureTried = true;
      try {
        const canvas = pageDocument.createElement('canvas');
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.style.objectFit = 'contain';
        if (canvas.height > canvas.width) container.classList?.add('portrait');
        candidate.frameCanvas = canvas;
        container.appendChild(canvas);
        return;
      } catch (_error) {
      }
    }
    if (video && video.readyState < 2) {
      video.addEventListener?.('loadeddata', () => {
        candidate.frameCaptureTried = false;
        container.replaceChildren?.();
        appendThumbnail(pageDocument, candidate, container);
      }, { once: true });
    }
    if (candidate.poster) {
      const image = pageDocument.createElement('img');
      image.src = candidate.poster;
      image.alt = '';
      image.style.objectFit = 'contain';
      image.addEventListener?.('load', () => {
        if (image.naturalHeight > image.naturalWidth) container.classList?.add('portrait');
      }, { once: true });
      container.appendChild(image);
      return;
    }
    const placeholder = pageDocument.createElement('span');
    placeholder.textContent = `${candidate.domain} · ${candidate.title}`;
    container.appendChild(placeholder);
  }

  function createResumeNotice(pageDocument, queueState) {
    if (!queueState.resumeRequired) return null;
    const notice = pageDocument.createElement('p');
    notice.className = 'resume-notice';
    notice.textContent = '브라우저 재시작 후 전송 재개가 필요합니다.';
    return notice;
  }

  function createRetryNotice(pageDocument, queueState) {
    const needsConfirmation = (queueState.items || []).some((item) => (
      item.status === 'failed' && item.error === INTERRUPTED_ERROR
    ));
    if (!needsConfirmation) return null;
    const notice = pageDocument.createElement('p');
    notice.className = 'retry-notice';
    notice.textContent = '전송이 중단된 항목은 VDtN 서버에서 접수 여부를 먼저 확인한 뒤 재시도하세요.';
    return notice;
  }

  function groupQueueItems(items) {
    const groups = new Map();
    for (const item of items || []) {
      const fallbackKey = `${item.sourceTitle || ''}\u0000${item.sourceUrl || ''}\u0000${item.createdAt || ''}`;
      const key = item.batchId ? `batch:${item.batchId}` : `legacy:${fallbackKey}`;
      if (!groups.has(key)) {
        groups.set(key, {
          batchId: item.batchId || '',
          title: item.sourceTitle || '원본 페이지',
          createdAt: item.createdAt || null,
          items: []
        });
      }
      groups.get(key).items.push(item);
    }
    return Array.from(groups.values());
  }

  function openSelector(pageDocument) {
    if (activeSelector) activeSelector.close();
    const candidates = collectCandidates(pageDocument);
    const host = pageDocument.createElement('div');
    host.id = 'vdtn-video-selector';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 20px; box-sizing: border-box; background: rgba(7,13,23,.72); color: #edf2f7; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif; }
        .panel { width: min(920px,100%); max-height: min(760px,100%); display: flex; flex-direction: column; overflow: hidden; background: #111827; border: 1px solid #334155; border-radius: 14px; box-shadow: 0 24px 80px rgba(0,0,0,.45); }
        .header, .controls, .queue-actions { display: flex; align-items: center; gap: 8px; padding: 14px 16px; }
        .header { justify-content: space-between; border-bottom: 1px solid #334155; }
        h2 { margin: 0; font-size: 18px; } .tabs { display: flex; gap: 6px; }
        button { border: 1px solid #475569; border-radius: 7px; padding: 7px 10px; color: inherit; background: #1e293b; font: inherit; cursor: pointer; }
        button:hover, button[aria-selected="true"] { background: #2563eb; border-color: #60a5fa; } .primary { background: #2563eb; border-color: #60a5fa; }
        .content { overflow: auto; padding: 0 16px 16px; } .controls { flex-wrap: wrap; padding-left: 0; padding-right: 0; } .selection-count, .notice { color: #bfdbfe; }
        .cards { display: grid; grid-template-columns: repeat(auto-fill,minmax(210px,1fr)); gap: 12px; } .card { display: block; min-width: 0; padding: 0; overflow: hidden; text-align: left; background: #0f172a; } .card.selected { outline: 2px solid #60a5fa; }
        .thumbnail { display: grid; place-items: center; height: 118px; overflow: hidden; background: #1e293b; color: #cbd5e1; text-align: center; font-size: 12px; } .thumbnail.portrait { height: min(320px,45vh); } .thumbnail img, .thumbnail canvas { width: 100%; height: 100%; object-fit: contain; }
        .card-copy { display: block; padding: 10px; } .card-title, .card-domain { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .card-domain, .queue-detail { color: #94a3b8; font-size: 12px; }
        .empty { padding: 36px 0; color: #cbd5e1; text-align: center; } .queue-group { margin-top: 12px; border: 1px solid #334155; border-radius: 9px; overflow: hidden; } .queue-group h3 { margin: 0; padding: 10px 12px; background: #1e293b; font-size: 14px; }
        .queue-item { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px 12px; border-top: 1px solid #334155; } .queue-status { align-self: center; color: #bfdbfe; }
        .queue-error, .retry-notice { color: #fca5a5; } .queue-error { margin-top: 4px; font-size: 12px; } .retry-notice { margin: 0 0 10px; }
        @media (max-width:560px) { .backdrop { padding: 0; } .panel { height: 100%; max-height: none; border-radius: 0; } .header { align-items: flex-start; gap: 12px; flex-direction: column; } }
      </style>
      <div class="backdrop"><section class="panel" role="dialog" aria-modal="true" aria-label="영상 선택과 전송 대기열">
        <header class="header"><h2>영상 전송</h2><div class="tabs" role="tablist"><button type="button" data-tab="videos" role="tab" aria-selected="true">이 페이지의 영상</button><button type="button" data-tab="queue" role="tab" aria-selected="false">전송 대기열 (0)</button></div><button type="button" data-close>닫기</button></header>
        <main class="content"><div data-videos-panel></div><div data-queue-panel hidden></div></main>
      </section></div>`;

    const videosPanel = shadow.querySelector('[data-videos-panel]');
    const queuePanel = shadow.querySelector('[data-queue-panel]');
    const queueTab = shadow.querySelector('[data-tab="queue"]');
    const videoTab = shadow.querySelector('[data-tab="videos"]');
    const selected = new Set();
    let queueState = { items: [], paused: false };
    let closed = false;
    let refreshTimer = null;

    function close() {
      if (closed) return;
      closed = true;
      if (refreshTimer !== null) clearInterval(refreshTimer);
      host.remove();
      if (activeSelector && activeSelector.close === close) activeSelector = null;
    }

    function renderVideos() {
      videosPanel.replaceChildren();
      const controls = pageDocument.createElement('div');
      controls.className = 'controls';
      const selectAll = pageDocument.createElement('button');
      selectAll.type = 'button'; selectAll.textContent = '전체 선택';
      selectAll.addEventListener('click', () => { candidates.forEach((candidate) => selected.add(candidate.url)); renderVideos(); });
      const clearAll = pageDocument.createElement('button');
      clearAll.type = 'button'; clearAll.textContent = '전체 해제';
      clearAll.addEventListener('click', () => { selected.clear(); renderVideos(); });
      const count = pageDocument.createElement('span');
      count.className = 'selection-count'; count.textContent = `선택 ${selected.size}개`;
      const enqueue = pageDocument.createElement('button');
      enqueue.type = 'button'; enqueue.className = 'primary';
      enqueue.textContent = `선택한 ${selected.size}개 대기열에 추가`; enqueue.disabled = selected.size === 0;
      enqueue.addEventListener('click', async () => {
        const chosen = candidates.filter((candidate) => selected.has(candidate.url)).map((candidate) => ({ url: candidate.url, title: candidate.title, resolution: 'best' }));
        const result = await sendMessage({ action: 'enqueueDownloads', candidates: chosen, source: { title: pageDocument.title || '', url: toHttpUrl(pageDocument.URL) } });
        const notice = pageDocument.createElement('span');
        notice.className = 'notice'; notice.textContent = `${result.added || 0}개 추가 · 중복 ${result.skipped || 0}개 제외`;
        controls.querySelector('.notice')?.remove(); controls.appendChild(notice);
        await refreshQueue();
      });
      controls.append(selectAll, clearAll, count, enqueue);
      videosPanel.appendChild(controls);
      if (!candidates.length) {
        const empty = pageDocument.createElement('p');
        empty.className = 'empty'; empty.textContent = '찾은 영상이 없습니다. 전송 대기열을 확인할 수 있습니다.';
        videosPanel.appendChild(empty); return;
      }
      const cards = pageDocument.createElement('div');
      cards.className = 'cards';
      for (const candidate of candidates) {
        const card = pageDocument.createElement('button');
        card.type = 'button'; card.className = `card${selected.has(candidate.url) ? ' selected' : ''}`;
        card.setAttribute('aria-pressed', String(selected.has(candidate.url)));
        const thumbnail = pageDocument.createElement('span'); thumbnail.className = 'thumbnail'; appendThumbnail(pageDocument, candidate, thumbnail);
        const copy = pageDocument.createElement('span'); copy.className = 'card-copy';
        const title = pageDocument.createElement('strong'); title.className = 'card-title'; title.textContent = candidate.title;
        const domain = pageDocument.createElement('span'); domain.className = 'card-domain'; domain.textContent = candidate.domain;
        copy.append(title, domain); card.append(thumbnail, copy);
        card.addEventListener('click', () => { if (selected.has(candidate.url)) selected.delete(candidate.url); else selected.add(candidate.url); renderVideos(); });
        cards.appendChild(card);
      }
      videosPanel.appendChild(cards);
    }

    function renderQueue() {
      queuePanel.replaceChildren();
      const summary = getSummary(queueState);
      queueTab.textContent = `전송 대기열 (${summary.outstanding})`;
      const actions = pageDocument.createElement('div'); actions.className = 'queue-actions';
      const controls = [[queueState.paused ? '다시 시작' : '일시정지', queueState.paused ? 'resumeQueue' : 'pauseQueue'], ['실패 항목 재시도', 'retryFailed'], ['대기 항목 삭제', 'removePending'], ['접수 완료 목록 지우기', 'clearAccepted']];
      for (const [label, action] of controls) {
        const button = pageDocument.createElement('button'); button.type = 'button'; button.textContent = label;
        button.addEventListener('click', async () => { await sendMessage({ action }); await refreshQueue(); });
        actions.appendChild(button);
      }
      queuePanel.appendChild(actions);
      const retryNotice = createRetryNotice(pageDocument, queueState);
      if (retryNotice) queuePanel.appendChild(retryNotice);
      const resumeNotice = createResumeNotice(pageDocument, queueState);
      if (resumeNotice) queuePanel.appendChild(resumeNotice);
      if (!(queueState.items || []).length) {
        const empty = pageDocument.createElement('p'); empty.className = 'empty'; empty.textContent = '전송 대기열이 비어 있습니다.';
        queuePanel.appendChild(empty); return;
      }
      const groups = groupQueueItems(queueState.items);
      for (const group of groups) {
        const groupElement = pageDocument.createElement('section'); groupElement.className = 'queue-group';
        const heading = pageDocument.createElement('h3');
        const registeredAt = formatTime(group.createdAt);
        heading.textContent = registeredAt ? `${group.title} · ${registeredAt}` : group.title;
        groupElement.appendChild(heading);
        for (const item of group.items) {
          const row = pageDocument.createElement('div'); row.className = 'queue-item';
          const details = pageDocument.createElement('div');
          const presentation = queueItemPresentation(item);
          const title = pageDocument.createElement('strong'); title.textContent = item.title || item.url;
          const description = pageDocument.createElement('div'); description.className = 'queue-detail'; description.textContent = `${item.url} · ${formatTime(item.createdAt)}`;
          const status = pageDocument.createElement('span'); status.className = 'queue-status'; status.textContent = presentation.status;
          details.append(title, description);
          if (presentation.error) {
            const error = pageDocument.createElement('div'); error.className = 'queue-error'; error.textContent = presentation.error;
            details.appendChild(error);
          }
          row.append(details, status); groupElement.appendChild(row);
        }
        queuePanel.appendChild(groupElement);
      }
    }

    async function refreshQueue() {
      const response = await sendMessage({ action: 'getQueueState' });
      if (closed) return;
      queueState = response.state || response.queue || response;
      if (!Array.isArray(queueState.items)) queueState = { items: [], paused: false };
      renderQueue();
    }

    function setTab(tab) {
      const queueSelected = tab === 'queue';
      videoTab.setAttribute('aria-selected', String(!queueSelected)); queueTab.setAttribute('aria-selected', String(queueSelected));
      videosPanel.hidden = queueSelected; queuePanel.hidden = !queueSelected;
      if (queueSelected) refreshQueue();
    }

    shadow.querySelector('[data-close]').addEventListener('click', close);
    shadow.querySelector('.backdrop').addEventListener('click', (event) => { if (event.target === event.currentTarget) close(); });
    videoTab.addEventListener('click', () => setTab('videos'));
    queueTab.addEventListener('click', () => setTab('queue'));
    pageDocument.documentElement.appendChild(host);
    renderVideos(); refreshQueue(); refreshTimer = setInterval(refreshQueue, 1000);
    activeSelector = { close };
    return activeSelector;
  }

  globalScope.VdtnContent = {
    collectCandidates,
    appendThumbnail,
    queueItemPresentation,
    createResumeNotice,
    createRetryNotice,
    groupQueueItems,
    openSelector
  };
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'findVideos') {
      openSelector(document);
      sendResponse({ opened: true });
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
