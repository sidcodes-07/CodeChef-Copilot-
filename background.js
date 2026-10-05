importScripts('backend-config.js');

const API_BASE_URL = globalThis.CODECHEF_COPILOT_CONFIG?.apiBaseUrl;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    codechefCopilotState: {
      state: 'IDLE',
      currentQuestion: 'Not started',
      questionType: 'UNKNOWN',
      progress: '0 / 0',
      status: 'Idle',
      logs: ['Extension initialized.']
    }
  });
});

async function solveViaBackend(payload) {
  if (!API_BASE_URL || !/^https:\/\//.test(API_BASE_URL)) {
    throw new Error('The public backend URL is not configured. Reload the extension after configuring its backend.');
  }
  const response = await fetch(`${API_BASE_URL.replace(/\/+$/, '')}/api/solve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Backend request failed: ${response.status}`);
  }

  return data.result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'COPILOT_STATE_UPDATE') {
    chrome.storage.local.set({ codechefCopilotState: message.payload });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'COPILOT_GET_STATE') {
    chrome.storage.local.get(['codechefCopilotState'], (result) => {
      sendResponse({ state: result.codechefCopilotState || null });
    });
    return true;
  }

  if (message?.type === 'COPILOT_REQUEST') {
    solveViaBackend(message.payload)
      .then((data) => sendResponse({ ok: true, result: data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
