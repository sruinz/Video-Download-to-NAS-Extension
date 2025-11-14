chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'findVideos') {
    const videos = [...document.querySelectorAll('video')].map(video => video.src);
    
    const iframes = [...document.querySelectorAll('iframe')];
    iframes.forEach(iframe => {
      const src = iframe.src;
      if (src.includes('embed') || src.includes('watch')) {
        videos.push(src);
      }
    });

    function extractVideoUrl() {
      const currentUrl = document.URL;
      const videoIdMatch = currentUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
      if (videoIdMatch) {
        return `${currentUrl.split('?')[0]}?v=${videoIdMatch[1]}`;
      }
      const otherIdMatch = currentUrl.match(/viewkey=([a-zA-Z0-9]+)/);
      if (otherIdMatch) {
        return `${currentUrl.split('?')[0]}?viewkey=${otherIdMatch[1]}`;
      }
      return null;
    }

    const videoUrl = extractVideoUrl();
    if (videoUrl) {
      videos.push(videoUrl);
    }

    if (videos.length > 0) {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      overlay.style.color = '#fff';
      overlay.style.zIndex = '9999';
      overlay.style.padding = '20px';
      overlay.style.overflowY = 'auto';
      overlay.style.display = 'flex'; 
      overlay.style.flexDirection = 'column'; 
      overlay.style.alignItems = 'center'; 
      overlay.style.justifyContent = 'flex-start'; 
      overlay.innerHTML = '<h2 style="margin: 0;">Select a video to download:</h2>';

      videos.forEach((videoUrl) => {
        if (!videoUrl.startsWith('blob:')) {
          const videoButton = document.createElement('button');
          videoButton.innerText = videoUrl;
          videoButton.style.color = '#fff';
          videoButton.style.backgroundColor = '#212529'; 
          videoButton.style.border = 'none'; 
          videoButton.style.padding = '10px 20px'; 
          videoButton.style.margin = '5px 0'; 
          videoButton.style.cursor = 'pointer'; 
          videoButton.style.width = '100%'; 
          videoButton.style.borderRadius = '5px'; 
          videoButton.style.fontSize = '16px'; 

          videoButton.onclick = (event) => {
            event.preventDefault(); 

            console.log(`Requesting download for: ${videoUrl}`);
            chrome.runtime.sendMessage({ action: 'downloadVideo', url: videoUrl }, (response) => {
              console.log(`Response received: ${JSON.stringify(response)}`);

              const responseOverlay = document.createElement('div');
              responseOverlay.style.position = 'fixed';
              responseOverlay.style.top = '50%';
              responseOverlay.style.left = '50%';
              responseOverlay.style.transform = 'translate(-50%, -50%)';
              responseOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
              responseOverlay.style.color = '#fff';
              responseOverlay.style.padding = '20px';
              responseOverlay.style.borderRadius = '5px';
              responseOverlay.innerText = response.message || '다운로드 요청 완료!';
              document.body.appendChild(responseOverlay);

              setTimeout(() => {
                if (responseOverlay.parentNode) {
                  responseOverlay.parentNode.removeChild(responseOverlay);
                }
              }, 2000);
            });

            if (overlay.parentNode) {
              overlay.parentNode.removeChild(overlay);
            }
          };

          overlay.appendChild(videoButton);
        }
      });

      overlay.onclick = (event) => {
        if (event.target === overlay) {
          overlay.parentNode.removeChild(overlay);
        }
      };

      document.body.appendChild(overlay);
    } else {
      console.log("No videos found on this page.");
    }
  }
});