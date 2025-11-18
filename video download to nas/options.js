document.addEventListener('DOMContentLoaded', function() {
  const form = document.querySelector('#options');
  const saveButton = document.querySelector('.submit-button');
  const authMethodSelect = document.querySelector('#authMethod');
  
  // 각 인증 방식의 필드 그룹
  const configUrlFields = document.querySelector('#configUrlFields');
  const tokenFields = document.querySelector('#tokenFields');
  const passwordFields = document.querySelector('#passwordFields');
  
  // 비밀번호/토큰 표시 토글
  const togglePassword = document.querySelector('#togglePassword');
  const toggleToken = document.querySelector('#toggleToken');
  const pwField = document.querySelector('#pw');
  const tokenField = document.querySelector('#apiToken');

  // 저장된 설정 불러오기
  chrome.storage.sync.get([
    'authMethod', 
    'configUrl',
    'restUrl', 'id', 'pw',
    'restUrlToken', 'idToken', 'apiToken'
  ], function(items) {
    // 인증 방법 설정 (기본값: config_url)
    const authMethod = items.authMethod || 'config_url';
    authMethodSelect.value = authMethod;
    showAuthFields(authMethod);
    
    // Config URL 방식
    if (items.configUrl) {
      form.configUrl.value = items.configUrl;
    }
    
    // Token 방식
    if (items.restUrlToken) {
      form.restUrlToken.value = items.restUrlToken;
    }
    if (items.idToken) {
      form.idToken.value = items.idToken;
    }
    // API Token은 항상 공란으로 표시
    form.apiToken.value = '';
    
    // Password 방식
    if (items.restUrl) {
      form.restUrl.value = items.restUrl;
    }
    if (items.id) {
      form.id.value = items.id;
    }
    // 비밀번호는 항상 공란으로 표시
    form.pw.value = '';
  });

  // 인증 방법 변경 시 필드 표시/숨김
  authMethodSelect.addEventListener('change', function() {
    showAuthFields(this.value);
  });

  function showAuthFields(method) {
    configUrlFields.style.display = 'none';
    tokenFields.style.display = 'none';
    passwordFields.style.display = 'none';
    
    if (method === 'config_url') {
      configUrlFields.style.display = 'block';
    } else if (method === 'token') {
      tokenFields.style.display = 'block';
    } else if (method === 'password') {
      passwordFields.style.display = 'block';
    }
  }

  // 비밀번호 표시/숨기기
  if (togglePassword) {
    togglePassword.addEventListener('click', function() {
      if (pwField.type === 'password') {
        pwField.type = 'text';
        togglePassword.textContent = '👁️‍🗨️';
      } else {
        pwField.type = 'password';
        togglePassword.textContent = '👁️';
      }
    });
  }

  // API Token 표시/숨기기
  if (toggleToken) {
    toggleToken.addEventListener('click', function() {
      if (tokenField.type === 'password') {
        tokenField.type = 'text';
        toggleToken.textContent = '👁️‍🗨️';
      } else {
        tokenField.type = 'password';
        toggleToken.textContent = '👁️';
      }
    });
  }

  // Config URL 파싱 함수
  function parseConfigUrl(configUrl) {
    if (!configUrl || !configUrl.includes('#')) {
      return null;
    }
    
    const parts = configUrl.split('#');
    if (parts.length !== 2) {
      return null;
    }
    
    let serverUrl = parts[0].trim().replace(/\/+$/, '');
    const token = parts[1].trim();
    
    // /rest 엔드포인트 추가
    const restUrl = serverUrl + '/rest';
    
    return { restUrl, token };
  }

  // 폼 제출
  form.addEventListener('submit', function(event) {
    event.preventDefault();
    
    const authMethod = authMethodSelect.value;
    let dataToSave = { authMethod };
    let valid = true;
    let errorFields = [];

    // 모든 필드 테두리 초기화
    document.querySelectorAll('.input-field').forEach(field => {
      field.style.border = '';
    });

    if (authMethod === 'config_url') {
      const configUrl = form.configUrl.value.trim();
      
      if (!configUrl) {
        valid = false;
        errorFields.push(form.configUrl);
      } else {
        // Config URL 파싱
        const parsed = parseConfigUrl(configUrl);
        if (!parsed) {
          valid = false;
          errorFields.push(form.configUrl);
          alert('Config URL 형식이 올바르지 않습니다.\n형식: http://server#token');
        } else {
          dataToSave.configUrl = configUrl;
          dataToSave.restUrl = parsed.restUrl;
          dataToSave.apiToken = parsed.token;
        }
      }
    } else if (authMethod === 'token') {
      let restUrlToken = form.restUrlToken.value.trim();
      const idToken = form.idToken.value.trim();
      const apiToken = form.apiToken.value.trim();
      
      if (!restUrlToken) {
        valid = false;
        errorFields.push(form.restUrlToken);
      }
      if (!idToken) {
        valid = false;
        errorFields.push(form.idToken);
      }
      if (!apiToken) {
        valid = false;
        errorFields.push(form.apiToken);
      }
      
      if (valid) {
        // /rest 자동 추가
        if (!restUrlToken.endsWith('/rest')) {
          restUrlToken = restUrlToken.replace(/\/+$/, '') + '/rest';
        }
        
        dataToSave.restUrlToken = restUrlToken;
        dataToSave.restUrl = restUrlToken;
        dataToSave.idToken = idToken;
        dataToSave.id = idToken;
        dataToSave.apiToken = apiToken;
      }
    } else if (authMethod === 'password') {
      let restUrl = form.restUrl.value.trim();
      const id = form.id.value.trim();
      const pw = form.pw.value.trim();
      
      if (!restUrl) {
        valid = false;
        errorFields.push(form.restUrl);
      }
      if (!id) {
        valid = false;
        errorFields.push(form.id);
      }
      if (!pw) {
        valid = false;
        errorFields.push(form.pw);
      }
      
      if (valid) {
        // /rest 자동 추가
        if (!restUrl.endsWith('/rest')) {
          restUrl = restUrl.replace(/\/+$/, '') + '/rest';
        }
        
        dataToSave.restUrl = restUrl;
        dataToSave.id = id;
        dataToSave.pw = pw;
      }
    }

    // 유효성 검사 실패 시
    if (!valid) {
      errorFields.forEach(field => {
        field.style.border = '1px solid red';
      });
      alert('모든 필드를 올바르게 채워주세요.');
      return;
    }

    // 저장
    chrome.storage.sync.set(dataToSave, function() {
      saveButton.textContent = '저장 완료!';
      saveButton.disabled = true;

      setTimeout(function() {
        saveButton.textContent = '저장';
        saveButton.disabled = false;
        window.close();
      }, 1000);
    });
  });
});
