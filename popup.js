const stateEl = document.getElementById('status-pill');
const progressEl = document.getElementById('progress-value');
const questionEl = document.getElementById('current-question');
const typeEl = document.getElementById('question-type');
const logList = document.getElementById('log-list');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
let renderedLogs = '';

function setStatus(text, tone) {
  stateEl.textContent = text;
  stateEl.className = `status-${tone}`;
}

function logMessage(message) {
  const item = document.createElement('li');
  item.textContent = message;
  logList.prepend(item);
  while (logList.children.length > 6) {
    logList.removeChild(logList.lastChild);
  }
}

async function getState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'COPILOT_GET_STATE' }, (response) => {
      resolve(response?.state || null);
    });
  });
}

function renderState(state) {
  if (!state) {
    return;
  }

  progressEl.textContent = state.progress || '0 / 0';
  questionEl.textContent = state.currentQuestion || 'Question 1';
  typeEl.textContent = state.questionType || 'UNKNOWN';
  const statusLabels = {
    IDLE: ['Idle', 'idle'],
    DETECTING_MODULE: ['Detecting module', 'solving'],
    DETECTING_QUESTION: ['Detecting question', 'solving'],
    CLASSIFYING: ['Classifying', 'solving'],
    SOLVING: ['Solving', 'solving'],
    VERIFYING: ['Verifying', 'solving'],
    MOVING_NEXT: ['Moving next', 'solving'],
    COMPLETED: ['Completed', 'success'],
    FAILED: ['Failed', 'failed'],
    WAITING_FOR_USER: ['Waiting for you', 'idle']
  };
  const [label, tone] = statusLabels[state.state] || [state.status || 'Idle', 'idle'];
  setStatus(label, tone);

  const logs = Array.isArray(state.logs) ? state.logs : [];
  const logKey = logs.join('\n');
  if (logs.length && logKey !== renderedLogs) {
    renderedLogs = logKey;
    logList.replaceChildren();
    logs.forEach((message) => {
      const item = document.createElement('li');
      item.textContent = message;
      logList.append(item);
    });
  }
}

async function refreshState() {
  const state = await getState();
  renderState(state);
}

startButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    logMessage('No active CodeChef tab found.');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'COPILOT_START' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      logMessage(chrome.runtime.lastError?.message || 'Could not start on this page.');
      return;
    }
    logMessage('Start signal sent to the CodeChef page.');
    setStatus('Detecting', 'solving');
  });
});

stopButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    logMessage('No active CodeChef tab found.');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'COPILOT_STOP' }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      logMessage(chrome.runtime.lastError?.message || 'Could not stop the agent on this page.');
      return;
    }
    logMessage('Stop signal sent to the CodeChef page.');
    setStatus('Stopped', 'failed');
  });
});

refreshState();
setInterval(refreshState, 1200);
