console.log("Service Worker started.");

// VDtN 아이콘을 클릭하면 현재 페이지의 다운로드 가능한 비디오들을 찾는 메시지 전송
chrome.action.onClicked.addListener((tab) => {
  console.log("VDtN icon clicked.");

  // 탭이 유효한지 검사
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'findVideos' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("메시지 전송 실패: ", chrome.runtime.lastError);
      }
    });
  } else {
    console.error("유효하지 않은 탭입니다.");
  }
});

// 메뉴를 생성하는 함수 (수정된 버전)
function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    // 1. 최상위 부모 메뉴 생성
    chrome.contextMenus.create({
      id: 'my-extension',
      title: 'Download with VDtN',
      contexts: ['link', 'selection', 'video']
    });

    // 2. 일반 해상도 및 오디오 메뉴 생성
    const resolutions = [
      'best', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'
    ];
    resolutions.forEach(function(resolution) {
      chrome.contextMenus.create({
        parentId: 'my-extension',
        id: resolution,
        title: resolution,
        type: 'radio',
        contexts: ['link', 'selection', 'video']
      });
    });
    
    // 구분선 추가
    chrome.contextMenus.create({ parentId: 'my-extension', id: 'sep1', type: 'separator', contexts: ['link', 'selection', 'video']});

    const audioFormats = ['audio-m4a', 'audio-mp3'];
    audioFormats.forEach(function(format) {
        chrome.contextMenus.create({
            parentId: 'my-extension',
            id: format,
            title: format,
            type: 'radio',
            contexts: ['link', 'selection', 'video']
        });
    });

    // 구분선 추가
    chrome.contextMenus.create({ parentId: 'my-extension', id: 'sep2', type: 'separator', contexts: ['link', 'selection', 'video']});

    // 3. 자막 메뉴와 하위 언어 메뉴 생성
    const subtitleFormats = ['srt', 'vtt'];
    const languages = [
      { code: 'ko', title: 'Korean' },
      { code: 'en', title: 'English' },
      { code: 'ja', title: 'Japanese' }
    ];

    subtitleFormats.forEach(format => {
      // 'srt', 'vtt' 폴더 메뉴 생성
      const parentId = `${format}-parent`;
      chrome.contextMenus.create({
        parentId: 'my-extension',
        id: parentId,
        title: format,
        contexts: ['link', 'selection', 'video']
      });
      // 각 언어 자식 메뉴 생성
      languages.forEach(lang => {
        chrome.contextMenus.create({
          parentId: parentId,
          // ID 자체에 언어 코드를 포함 (예: 'srt|ko')
          id: `${format}|${lang.code}`,
          title: lang.title,
          type: 'radio',
          contexts: ['link', 'selection', 'video']
        });
      });
    });
  });
}

// 메뉴 생성
createContextMenu();

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
    return trimmedValue;
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

// 컨텍스트 메뉴 클릭 시 처리
chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (!info.menuItemId.startsWith('sep')) {
    chrome.storage.sync.get(['authMethod', 'restUrl', 'id', 'pw', 'apiToken'], function(options) {
      const url = resolveContextMenuUrl(info, tab);

      if (url) {
        sendDownloadRequest(options, url, info.menuItemId);
      }
    });
  }
});

// 다운로드 요청 전송 함수
function sendDownloadRequest(options, url, resolution) {
  const validatedUrl = normalizeHttpUrl(url);
  if (!validatedUrl) {
    console.error('지원하지 않는 URL이라 다운로드 요청을 보내지 않았습니다.');
    return;
  }

  const authMethod = options.authMethod || 'password'; // 기본값: password (하위 호환성)
  
  // 요청 헤더 준비
  const headers = {
    'Content-Type': 'application/json;charset=UTF-8'
  };
  
  // 요청 바디 준비
  const body = {
    url: validatedUrl,
    resolution: resolution
  };
  
  // 인증 방법에 따라 헤더 또는 바디 설정
  if (authMethod === 'config_url' || authMethod === 'token') {
    // Config URL 또는 Token 방식: Authorization 헤더 사용
    if (options.apiToken) {
      headers['Authorization'] = `Bearer ${options.apiToken}`;
    } else {
      console.error('API Token이 설정되지 않았습니다.');
      return;
    }
  } else {
    // Password 방식: 바디에 id, pw 포함 (레거시)
    body.id = options.id;
    body.pw = options.pw;
  }
  
  // 요청 전송
  const request = new Request(options.restUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });
  
  fetch(request)
    .then(response => {
      if (!response.ok) {
        console.error('다운로드 요청 실패:', response.status);
      }
    })
    .catch(error => {
      console.error('다운로드 요청 오류:', error);
    });
}

// 다운로드 요청 처리
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'downloadVideo') {
    const { url } = request;

    chrome.storage.sync.get(['authMethod', 'restUrl', 'id', 'pw', 'apiToken'], function(options) {
      sendDownloadRequest(options, url, 'best');
    });
  }
});
