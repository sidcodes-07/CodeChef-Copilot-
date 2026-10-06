(() => {
  const MODULE_STATE = {
    IDLE: 'IDLE',
    DETECTING_MODULE: 'DETECTING_MODULE',
    DETECTING_QUESTION: 'DETECTING_QUESTION',
    CLASSIFYING: 'CLASSIFYING',
    SOLVING: 'SOLVING',
    VERIFYING: 'VERIFYING',
    MOVING_NEXT: 'MOVING_NEXT',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    WAITING_FOR_USER: 'WAITING_FOR_USER'
  };

  const MAX_ATTEMPTS = 5;
  const QUESTION_CHANGE_TIMEOUT_MS = 8000;
  const RESULT_TIMEOUT_MS = 45000;
  const SELECTORS = {
    question: [
      '[class*="_mcqContainer_"]',
      '[class*="_mcq_"]',
      '[data-testid*="question"]',
      '[data-question-id]',
      '.mcq-question',
      '.question-container',
      '.question-box',
      '.problem-statement',
      '.problem_statement',
      '.problems-problem-content',
      '.problem-content'
    ],
    options: [
      '[class*="_optionBox_"]',
      '[class*="_optionsContainer_"] label',
      'label',
      'input[type="radio"]',
      '[role="radio"]',
      '[data-option]',
      '[data-choice]',
      '.mcq-option',
      '.answer-option',
      '.answer_option',
      '.option-box'
    ],
    editors: [
      'textarea[name*="code" i]',
      'textarea#code',
      '.CodeMirror',
      '.CodeMirror-scroll',
      '.CodeMirror-lines',
      '.ace_editor',
      '.ace_text-input',
      '.ace_scroller',
      '#submit-ide-v2',
      '.monaco-editor',
      '.view-lines',
      '.cm-editor',
      '.cm-content[contenteditable="true"]',
      '[data-testid*="editor"]',
      '.code-editor',
      '.editor',
      'textarea[id*="editor" i]',
      'textarea[name*="editor" i]',
      'textarea[aria-label*="code" i]',
      'textarea[placeholder*="code" i]',
      '[role="textbox"][aria-label*="code" i]'
    ]
  };

  const state = {
    status: MODULE_STATE.IDLE,
    questionType: 'UNKNOWN',
    currentQuestion: 'Not started',
    progress: '0 / ?',
    logs: [],
    active: false,
    busy: false,
    attempts: 0,
    aiCalls: 0,
    completed: new Set(),
    failedQuestion: null,
    currentFingerprint: null,
    panel: null,
    observers: []
  };

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const isVisible = (element) => Boolean(element && element.isConnected && element.getClientRects().length);
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const visibleText = (element) => normalize(element?.textContent || '');

  function setState(status, message) {
    state.status = status;
    if (message) {
      state.logs.push(message);
      state.logs = state.logs.slice(-12);
    }
    publishState();
    renderPanel();
  }

  function publishState() {
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    chrome.runtime.sendMessage({
      type: 'COPILOT_STATE_UPDATE',
      payload: {
        state: state.status,
        currentQuestion: state.currentQuestion,
        questionType: state.questionType,
        progress: state.progress,
        status: state.status.replaceAll('_', ' '),
        logs: state.logs.slice(-6)
      }
    }, () => {
      void chrome.runtime.lastError;
    });
  }

  function makeButton(label, action, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = `border:1px solid ${danger ? '#74404a' : '#294761'};border-radius:8px;padding:7px 9px;background:${danger ? '#3a2028' : '#122238'};color:#f2f7ff;font:600 12px Segoe UI,Arial,sans-serif;cursor:pointer`;
    button.addEventListener('click', action);
    return button;
  }

  function renderPanel() {
    if (!document.body) return;
    if (!state.panel?.isConnected) {
      const panel = document.createElement('aside');
      panel.id = 'codechef-copilot-panel';
      panel.style.cssText = 'position:fixed;right:16px;bottom:16px;width:330px;z-index:2147483647;padding:14px;border-radius:14px;background:#0c1625;color:#eef6ff;border:1px solid #23405d;box-shadow:0 14px 28px rgba(0,0,0,.3);font:13px Segoe UI,Arial,sans-serif';
      const title = document.createElement('strong');
      title.textContent = 'CODECHEF COPILOT';
      title.style.cssText = 'display:block;letter-spacing:.12em;font-size:11px;color:#9bbad0;margin-bottom:10px';
      panel.append(title);
      const details = document.createElement('div');
      details.dataset.role = 'details';
      details.style.cssText = 'line-height:1.65;white-space:pre-wrap';
      panel.append(details);
      const log = document.createElement('div');
      log.dataset.role = 'log';
      log.style.cssText = 'margin-top:8px;color:#b9cce0;font-size:12px;line-height:1.4';
      panel.append(log);
      const controls = document.createElement('div');
      controls.dataset.role = 'controls';
      controls.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px';
      panel.append(controls);
      const footer = document.createElement('div');
      footer.textContent = 'Made By Siddharth';
      footer.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid #203b54;color:#b9cce0;text-align:right;font-size:11px';
      panel.append(footer);
      document.body.append(panel);
      state.panel = panel;
    }

    const details = state.panel.querySelector('[data-role="details"]');
    details.textContent = `Progress  ${state.progress}\nCurrent  ${state.currentQuestion}\nType  ${state.questionType}\nStatus  ${state.status.replaceAll('_', ' ')}\nAttempts  ${state.attempts}  ·  AI calls  ${state.aiCalls}`;
    state.panel.querySelector('[data-role="log"]').textContent = state.logs.at(-1) || 'Ready when you are.';
    const controls = state.panel.querySelector('[data-role="controls"]');
    controls.replaceChildren();

    if (!state.active && state.status === MODULE_STATE.IDLE) {
      controls.append(makeButton('⚡ Solve Module', startCopilot));
    }
    if (state.active) {
      controls.append(makeButton('STOP COPILOT', stopCopilot, true));
    }
    if (state.status === MODULE_STATE.FAILED) {
      controls.append(makeButton('Retry', retryFailedQuestion));
      controls.append(makeButton('Skip question', skipFailedQuestion));
      controls.append(makeButton('Stop module', stopCopilot, true));
    }
    if (state.status === MODULE_STATE.WAITING_FOR_USER && !state.active) {
      controls.append(makeButton('Resume', startCopilot));
    }
  }

  function findFirstVisible(selectors, root = document) {
    for (const selector of selectors) {
      const match = Array.from(root.querySelectorAll(selector)).find(isVisible);
      if (match) return match;
    }
    return null;
  }

  function findVisibleEditors() {
    const candidates = Array.from(document.querySelectorAll(SELECTORS.editors.join(',')))
      .filter(isVisible)
      .filter((editor) => {
        if (editor.closest('#codechef-copilot-panel')) return false;
        if (editor.matches('.ace_editor') && editor.id === 'submit-ide-v2') return true;
        if (editor.matches('textarea,.ace_text-input') &&
            editor.closest('.CodeMirror,.ace_editor,.monaco-editor,.cm-editor,[data-testid*="editor"],.code-editor,.editor')) return false;
        if (editor.matches('.editor,[data-testid*="editor"]') &&
            editor.querySelector('.CodeMirror,.ace_editor,.monaco-editor,.cm-editor')) return false;
        const context = `${editor.className || ''} ${editor.parentElement?.className || ''} ${editor.parentElement?.getAttribute('aria-label') || ''}`;
        return !/custom.?input/i.test(context);
      });

    const unique = [...new Set(candidates.map((editor) =>
      editor.matches('.CodeMirror-scroll,.CodeMirror-lines') ? editor.closest('.CodeMirror') || editor :
      editor.matches('.ace_scroller,.view-lines') ? editor.closest('.ace_editor,.monaco-editor') || editor :
      editor
    ))];
    return unique.sort((left, right) => {
      const score = (element) => {
        const classes = typeof element.className === 'string' ? element.className : '';
        const rect = element.getBoundingClientRect();
        const customInput = /custom.?input/i.test(`${classes} ${element.getAttribute('aria-label') || ''}`);
        return (customInput ? -100 : 0) +
          (/CodeMirror|ace_editor|monaco-editor|cm-editor|code-editor|editor/i.test(classes) ? 20 : 0) +
          (rect.width > 250 && rect.height > 120 ? 10 : 0) +
          (rect.left > window.innerWidth * 0.35 ? 5 : 0);
      };
      return score(right) - score(left);
    });
  }

  function findQuestionRoot() {
    const courseMcq = Array.from(document.querySelectorAll('[class*="_mcqContainer_"]')).find(isVisible);
    if (courseMcq) return courseMcq;

    const explicitQuestion = Array.from(document.querySelectorAll(SELECTORS.question.join(','))).find(isVisible);
    if (explicitQuestion) return explicitQuestion;

    const editor = findVisibleEditors()[0];
    if (editor) return editor;

    const radio = findFirstVisible(['input[type="radio"]', '[role="radio"]']);
    if (radio) {
      let ancestor = radio.parentElement;
      for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.querySelectorAll('input[type="radio"],[role="radio"]').length >= 2) return ancestor;
      }
    }
    return null;
  }

  function collectOptions(root) {
    const nodes = Array.from(root.querySelectorAll(SELECTORS.options.join(','))).filter(isVisible);
    const options = [];
    const seen = new Set();

    for (const node of nodes) {
      const input = node.matches('input[type="radio"]') ? node : node.querySelector('input[type="radio"]');
      const roleRadio = node.matches('[role="radio"]');
      if (node.matches('label') && !input && !roleRadio) continue;
      const label = input?.id ? root.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      const text = visibleText(label || node.closest('label') || (input ? input.parentElement : node));
      if (!text || text.length < 2) continue;
      const id = normalize(input?.value || node.getAttribute('data-option') || node.getAttribute('data-choice') || '') ||
        String.fromCharCode(65 + options.length);
      const key = `${id}\u0000${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        options.push({ id: id || String(options.length + 1), text, input, node });
      }
    }
    return options;
  }

  function detectQuestion(root) {
    const editors = findVisibleEditors();
    if (!root) return null;
    const options = collectOptions(root);
    if (options.length >= 2 && !editors.length) {
      const statement = findStatementRoot(root) || root.querySelector('[class*="_mcqStatement_"]') || root;
      const title = visibleText(findFirstVisible(['h1', 'h2', 'h3', '[data-testid*="question-title"]'], statement)) || visibleText(statement).slice(0, 700);
      return { type: 'MCQ', root, statement, title, options };
    }
    if (editors.length >= 1) {
      const statement = findStatementRoot(document) ||
        Array.from(document.querySelectorAll('[class*="problem-statement"],[class*="problemStatement"],[class*="problemBody"],[class*="problemBodyContent"]')).find(isVisible);
      const title = visibleText(findFirstVisible(['h1', 'h2', 'h3', '.problem-statement', '[data-testid*="problem-title"]'], statement || root)) || visibleText(statement || root).slice(0, 700);
      return { type: 'PROGRAMMING', root, statement: statement || root, title, options: [], editor: editors[0], editorCount: editors.length };
    }
    return null;
  }

  function findStatementRoot(root) {
    const specific = findFirstVisible([
      '[class*="_mcqStatement_"]',
      '[class*="problem-statement"]',
      '[class*="problemStatement"]',
      '[class*="problemBodyContent"]',
      '[class*="problemBody"]',
      '[class*="problemStatementWrapper"]',
      '.problem-statement',
      '.problem_statement',
      '.problems-problem-content',
      '.problem-description',
      '.problem_description',
      '.problem-desc',
      '.problem-content',
      '[data-testid*="problem-statement"]',
      '[class*="ProblemDescription"]'
    ], root);
    if (specific) return specific;

    const headings = Array.from(root.querySelectorAll('h1,h2,h3')).filter(isVisible).slice(0, 20);
    for (const heading of headings) {
      let ancestor = heading.parentElement;
      for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
        const text = visibleText(ancestor);
        if (text.length > 100 && text.length < 18000 &&
            /input format|output format|constraints|sample/i.test(text)) {
          return ancestor;
        }
      }
    }
    return null;
  }

  function getFingerprint(question) {
    const identifier = question.root.getAttribute('data-question-id') || question.root.id || '';
    const page = `${location.pathname}${location.search}`;
    return `${page}|${identifier}|${question.type}|${normalize(question.title).slice(0, 400)}`;
  }

  function detectFinalAssessment() {
    const path = location.pathname.toLowerCase();
    const text = visibleText(document.body).toLowerCase();
    return /assessment|contest|exam|final|certification|proctored/.test(path) ||
      /\b(final assessment|final exam|submit assessment|end test)\b/.test(text);
  }

  function detectModuleCompletion() {
    const text = visibleText(document.body).toLowerCase();
    return /\b(module completed|module complete|all questions completed|you have completed this module)\b/.test(text) ||
      Boolean(document.querySelector('[data-testid="module-completed"],[aria-label*="module completed" i]'));
  }

  function compactProblemContext(question, currentCode = '', feedback = '') {
    const text = visibleText(question.statement || question.root).slice(0, 12000);
    return {
      type: 'PROGRAMMING',
      question: question.title.slice(0, 1000),
      problem: text,
      constraints: text.match(/constraints?[\s\S]{0,1500}/i)?.[0] || '',
      examples: [],
      currentCode: currentCode.slice(0, 12000),
      error: feedback.slice(0, 3000)
    };
  }

  function requestBackend(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'COPILOT_REQUEST', payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || 'AI backend request failed.'));
          return;
        }
        resolve(response.result);
      });
    });
  }

  function findOption(question, selectedId) {
    const wanted = String(selectedId).trim().toLowerCase();
    return question.options.find((option) => option.id.toLowerCase() === wanted) ||
      question.options.find((option, index) => String.fromCharCode(97 + index) === wanted) ||
      question.options.find((option, index) => String(index + 1) === wanted);
  }

  function selectMcqOption(option) {
    if (!option) return false;
    if (option.input) {
      option.input.click();
      if (!option.input.checked) {
        option.input.checked = true;
        option.input.dispatchEvent(new Event('input', { bubbles: true }));
        option.input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return option.input.checked;
    }
    const target = option.node.closest('label,button,[role="radio"],[role="option"]') || option.node;
    target.click();
    return target.getAttribute('aria-checked') === 'true' ||
      target.classList.contains('selected') ||
      target.classList.contains('active');
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function readEditorCode(editor) {
    const editorRoot = editor.matches('textarea') ? editor.parentElement : editor;
    const cmRoot = editor.matches('.CodeMirror') ? editor : editor.closest('.CodeMirror') || editor.querySelector('.CodeMirror') || editorRoot;
    const cm = cmRoot?.CodeMirror || editorRoot?.CodeMirror || editor.CodeMirror;
    if (cm && typeof cm.getValue === 'function') return cm.getValue();
    const ace = editor.env?.editor || editorRoot?.env?.editor ||
      globalThis.ace?.edit?.(editor.id || editor);
    if (ace && typeof ace.getValue === 'function') return ace.getValue();
    const textarea = editor.matches('textarea') ? editor : editor.querySelector('textarea');
    if (textarea?.value) return textarea.value;
    const visibleCode = editor.querySelector('.view-lines,.ace_text-layer,.cm-content');
    return visibleCode?.textContent || '';
  }

  function ensureCLanguage() {
    const codechefLanguageSelect = document.querySelector('#language-select[role="combobox"]');
    if (isVisible(codechefLanguageSelect)) {
      return normalize(codechefLanguageSelect.textContent) === 'C';
    }
    const languageSelect = Array.from(document.querySelectorAll('select')).find((select) =>
      isVisible(select) && Array.from(select.options).some((option) =>
        /^c(?: language)?$/i.test(normalize(option.textContent || option.value))
      )
    );
    if (!languageSelect) return false;
    const cOption = Array.from(languageSelect.options).find((option) =>
      /^c(?: language)?$/i.test(normalize(option.textContent || option.value))
    );
    if (!cOption) return false;
    if (languageSelect.value !== cOption.value) {
      languageSelect.value = cOption.value;
      languageSelect.dispatchEvent(new Event('input', { bubbles: true }));
      languageSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return languageSelect.value === cOption.value;
  }

  function injectCode(editor, code) {
    const editorRoot = editor.matches('textarea') ? editor.parentElement : editor;
    const cmRoot = editor.matches('.CodeMirror') ? editor : editor.closest('.CodeMirror') || editor.querySelector('.CodeMirror') || editorRoot;
    const cm = cmRoot?.CodeMirror || editorRoot?.CodeMirror || editor.CodeMirror;
    if (cm && typeof cm.setValue === 'function') {
      cm.setValue(code);
      cm.save?.();
      return true;
    }

    const ace = editor.env?.editor || editorRoot?.env?.editor ||
      globalThis.ace?.edit?.(editor.id || editor);
    if (ace && typeof ace.setValue === 'function') {
      ace.setValue(code, -1);
      ace.clearSelection?.();
      return true;
    }

    const textarea = editor.matches('textarea') ? editor : editor.querySelector('textarea');
    if (textarea) {
      textarea.focus();
      setNativeValue(textarea, code);
      if (textarea.value === code) return true;
      const rendered = editor.querySelector('.view-lines,.ace_text-layer,.cm-content');
      return Boolean(rendered && normalize(rendered.textContent) === normalize(code));
    }

    const editable = editor.isContentEditable ? editor : editor.querySelector('[contenteditable="true"]');
    if (editable) {
      editable.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editable);
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand('insertText', false, code);
    }
    return false;
  }

  function findButtonByText(patterns, scope = document) {
    return Array.from(scope.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
      .filter(isVisible)
      .find((button) => {
        if (button.disabled) return false;
        const text = normalize(button.innerText || button.value || button.getAttribute('aria-label')).toLowerCase();
        return patterns.some((pattern) => pattern.test(text));
      }) || null;
  }

  function findSubmitButton() {
    if (detectFinalAssessment()) return null;
    const codechefPractice = isCodeChefCoursePage() || isPracticeProblemPage();
    if (codechefPractice) {
      const submit = document.querySelector('#submit_btn');
      if (isVisible(submit) && !submit.disabled) return submit;
    }
    const isModulePractice = /\bprev(?:ious)?\s+module\b/i.test(visibleText(document.body)) &&
      /\bnext\b/i.test(visibleText(document.body));
    if (!isModulePractice && !isPracticeProblemPage()) return null;
    return findButtonByText([/^submit(?: solution| code)?$/]);
  }

  function isPracticeProblemPage() {
    return /^\/problems\/[^/]+\/?$/i.test(location.pathname) && !detectFinalAssessment();
  }

  function isCodeChefCoursePage() {
    return /^\/learn\/course\/[^/]+\/[^/]+\/problems\/[^/]+\/?$/i.test(location.pathname) &&
      /\bnext\b/i.test(visibleText(document.body)) &&
      /\bprev(?:ious)?\s+module\b/i.test(visibleText(document.body));
  }

  function readRunFeedback(root) {
    const candidates = Array.from(document.querySelectorAll(
      '[role="alert"],[aria-live],.result,.run-result,.submission-result,.compile-error,.runtime-error,[class*="result"],[class*="error"],[class*="output"],[data-testid*="output"]'
    )).filter((element) =>
      isVisible(element) &&
      !element.closest('#codechef-copilot-panel') &&
      !element.closest('[class*="problem-statement"],[class*="problemStatement"],[class*="problemBody"]') &&
      !element.closest('[class*="input_output__table"]') &&
      !/test against custom input/i.test(visibleText(element).slice(0, 100))
    );
    const matched = candidates.map(visibleText)
      .filter((text) => /accepted|wrong answer|compile|runtime|error|success|passed|failed|test case/i.test(text));
    if (matched.length) return matched.join('\n').slice(-3000);

    const output = candidates.find((element) => {
      const classes = typeof element.className === 'string' ? element.className : '';
      const text = visibleText(element);
      return /output/i.test(classes) && text.length > 0 && text.length <= 2000;
    });
    return output ? `OUTPUT:${visibleText(output).slice(-2000)}` : '';
  }

  function waitForResult(beforeText, timeoutMs = RESULT_TIMEOUT_MS) {
    const start = Date.now();
    return new Promise((resolve) => {
      const poll = () => {
        const root = getQuestionRoot() || document.body;
        const feedback = readRunFeedback(root);
        if (feedback && feedback !== beforeText) {
          resolve(feedback);
        } else if (Date.now() - start >= timeoutMs) {
          resolve('');
        } else {
          setTimeout(poll, 300);
        }
      };
      poll();
    });
  }

  async function solveMcq(question) {
    const payload = {
      type: 'MCQ',
      question: question.title.slice(0, 1500),
      options: question.options.map(({ id, text }) => ({ id, text: text.slice(0, 1000) }))
    };
    state.attempts += 1;
    state.aiCalls += 1;
    const answer = await requestBackend(payload);
    if (!state.active) return null;
    const selected = findOption(question, answer?.selectedOption);
    if (!selected) {
      throw new Error('The model returned an option that is not present in the detected question. No answer was selected.');
    }
    if (!selectMcqOption(selected)) {
      throw new Error('Could not verify that the selected MCQ option is marked in the page.');
    }

    const submit = document.querySelector('#submit_btn') ||
      question.root.closest('[class*="_mcq_"]')?.querySelector('[class*="_submit__btn_"]') ||
      findButtonByText([/^submit$/], question.root.closest('[class*="_mcq_"]') || document);
    if (submit && isVisible(submit) && !submit.disabled) {
      const previousFeedback = readMcqFeedback(question);
      submit.click();
      setState(MODULE_STATE.VERIFYING, `Selected “${selected.text}”. Submitted the MCQ answer and waiting for CodeChef feedback.`);
      await waitForMcqFeedback(question, previousFeedback);
    } else if (/\/learn\/course\//i.test(location.pathname)) {
      throw new Error('Selected the answer, but could not find the course MCQ Submit button to verify it.');
    }
    return selected;
  }

  function readMcqFeedback(question) {
    const candidates = Array.from(document.querySelectorAll(
      '[role="alert"],[aria-live],[class*="answerFeedback"],[class*="answer-feedback"],[class*="submission-result"],[class*="toast"],[class*="result"]'
    )).filter(isVisible);
    return candidates.map(visibleText)
      .filter((text) => /correct|incorrect|wrong answer|try again|accepted|great job|well done/i.test(text))
      .join('\n');
  }

  async function waitForMcqFeedback(question, previousFeedback) {
    const started = Date.now();
    while (state.active && Date.now() - started < 8000) {
      await sleep(200);
      const feedback = readMcqFeedback(question);
      if (feedback && feedback !== previousFeedback) {
        if (/incorrect|wrong answer|try again/i.test(feedback)) {
          throw new Error(`CodeChef marked the MCQ answer incorrect: ${feedback.slice(0, 300)}`);
        }
        if (/correct|accepted|great job|well done/i.test(feedback)) return;
      }
    }
    if (state.active) {
      throw new Error('The answer was selected and submitted, but CodeChef did not show verifiable MCQ feedback within 8 seconds.');
    }
  }

  async function solveProgramming(question) {
    let feedback = '';
    let shouldSubmit = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (!state.active) return false;
      state.attempts += 1;
      state.aiCalls += 1;
      setState(MODULE_STATE.SOLVING, `Requesting C solution, attempt ${attempt}/${MAX_ATTEMPTS}.`);
      if (!ensureCLanguage()) {
        throw new Error('Could not verify that the CodeChef editor is set to C. Select C manually, then retry.');
      }
      const currentCode = readEditorCode(question.editor);
      const answer = await requestBackend(compactProblemContext(question, currentCode, feedback));
      if (!state.active) return false;
      if (answer?.type !== 'PROGRAMMING' || answer.language?.toUpperCase() !== 'C' || typeof answer.solution !== 'string' || !answer.solution.trim()) {
        throw new Error('The model response did not contain a usable C solution.');
      }
      if (!injectCode(question.editor, answer.solution)) {
        throw new Error('The detected editor does not expose a supported code insertion interface. No code was submitted.');
      }

      const runButton = findButtonByText([/^run(?: code)?$/, /^test(?: code)?$/, /^run sample tests?$/]);
      if (!runButton) {
        state.active = false;
        setState(MODULE_STATE.WAITING_FOR_USER, 'C code inserted. Could not find Run, so code was not submitted. Please review it and use Run manually.');
        return false;
      }
      const before = readRunFeedback(question.root);
      runButton.click();
      setState(MODULE_STATE.VERIFYING, `Running C solution, attempt ${attempt}/${MAX_ATTEMPTS}.`);
      feedback = await waitForResult(before);
      if (!feedback) {
        const sample = extractSampleData(question.statement);
        const customInput = document.querySelector('textarea[class*="textarea"]')?.value || '';
        if (sample && normalize(customInput) === normalize(sample.input)) {
          setState(MODULE_STATE.SOLVING, 'The sample input is loaded, but CodeChef did not expose the Run output. Retrying is not useful; stopping for manual result review.');
          state.active = false;
          return false;
        }
        throw new Error(`No observable Run result appeared within ${RESULT_TIMEOUT_MS / 1000} seconds.`);
      }
      if (/wrong answer|compile error|runtime error|failed/i.test(feedback)) {
        setState(MODULE_STATE.SOLVING, `Run reported an error; preparing a corrected solution. ${feedback.slice(-350)}`);
        continue;
      }
      const sample = extractSampleData(question.statement);
      const customInput = document.querySelector('textarea[class*="textarea"]')?.value || '';
      const actual = extractOutputText(feedback);
      if (sample && normalize(customInput) === normalize(sample.input) && normalize(actual) === normalize(sample.output)) {
          shouldSubmit = true;
          break;
      }
      if (/accepted|all test cases passed|submission successful/i.test(feedback)) return true;

      if (sample && normalize(customInput) === normalize(sample.input)) {
        feedback = `Run output did not match the sample output. Expected: ${sample.output}. Observed: ${actual || feedback.slice(-500)}`;
        setState(MODULE_STATE.SOLVING, `Run output differs from the sample; debugging. ${feedback.slice(-350)}`);
        continue;
      }
      throw new Error(`Could not confidently verify the Run result: ${feedback.slice(-500)}`);
    }

    if (!shouldSubmit) {
      throw new Error(`Programming question did not pass sample validation after ${MAX_ATTEMPTS} attempts. ${feedback.slice(-500)}`);
    }

    const submit = findSubmitButton();
    if (!submit) {
      state.active = false;
      setState(MODULE_STATE.WAITING_FOR_USER, 'Code ran and matched the sample. Could not find the course Submit control; review and submit manually.');
      return false;
    }
    const beforeSubmit = readRunFeedback(question.root);
    submit.click();
    setState(MODULE_STATE.VERIFYING, 'Sample output matched. Submitted this practice solution; waiting for the judge result.');
    feedback = await waitForResult(beforeSubmit);
    if (/\baccepted\b|all test cases passed|submission successful/i.test(feedback) &&
        !/wrong answer|compile error|runtime error|failed/i.test(feedback)) return true;
    if (/wrong answer|compile error|runtime error|failed/i.test(feedback)) {
      throw new Error(`CodeChef judged the submitted solution as unsuccessful: ${feedback.slice(-500)}`);
    }
    state.active = false;
    setState(MODULE_STATE.WAITING_FOR_USER, 'Submitted after sample validation. Judge feedback was not recognizable; verify the result manually.');
    return false;
  }

  function extractSampleData(statement) {
    if (!statement) return null;
    const table = statement.querySelector('[class*="input_output__table"]');
    if (table) {
      const columns = Array.from(table.querySelectorAll('[class*="values_bh3c4_"]'))
        .filter((column) => column.querySelector('pre'));
      if (columns.length >= 2) {
        return {
          input: columns[0].querySelector('pre').textContent,
          output: columns[1].querySelector('pre').textContent
        };
      }
      const values = Array.from(table.querySelectorAll('pre'));
      if (values.length > 1) return { input: values[0].textContent, output: values[1].textContent };
    }

    const sampleHeading = Array.from(statement.querySelectorAll('h1,h2,h3,h4,h5,strong,b'))
      .find((element) => /^sample(?:\s+\d+)?\s*:?$/i.test(normalize(element.textContent)));
    if (!sampleHeading) return null;
    let section = sampleHeading.parentElement;
    while (section && section !== statement) {
      const text = normalize(section.textContent);
      if (/input/i.test(text) && /output/i.test(text) && section.querySelector('pre')) {
        const pres = Array.from(section.querySelectorAll('pre'));
        if (pres.length >= 2) return { input: pres[0].textContent, output: pres[1].textContent };
      }
      section = section.parentElement;
    }
    return null;
  }

  function extractOutputText(feedback) {
    if (feedback.startsWith('OUTPUT:')) {
      const outputText = feedback.slice('OUTPUT:'.length);
      const lines = outputText.split(/\r?\n/).map(normalize).filter(Boolean);
      const labelIndex = lines.findIndex((line) => /^output(?:\s*\(.*\))?$/i.test(line));
      return (labelIndex >= 0 ? lines.slice(labelIndex + 1) : lines).join('\n');
    }
    const lines = feedback.split(/\r?\n/).map(normalize).filter(Boolean);
    const outputIndex = lines.findIndex((line) => /^output(?:\s*\(.*\))?$/i.test(line));
    if (outputIndex >= 0) {
      return lines.slice(outputIndex + 1).filter((line) => !/^(input|custom input|run|submit)$/i.test(line)).join('\n');
    }
    return lines.at(-1) || '';
  }

  async function waitForChangedQuestion(previousFingerprint) {
    const started = Date.now();
    while (state.active && Date.now() - started < QUESTION_CHANGE_TIMEOUT_MS) {
      await sleep(250);
      const root = getQuestionRoot();
      if (!root) continue;
      const next = detectQuestion(root);
      if (!next) continue;
      const fingerprint = getFingerprint(next);
      if (fingerprint !== previousFingerprint) return next;
    }
    return null;
  }

  function findNavigationControl() {
    const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
      .filter(isVisible)
      .filter((element) => {
        if (element.disabled) return false;
        const text = normalize(element.innerText || element.value || element.getAttribute('aria-label')).toLowerCase();
        if (!/^(next|next question|continue)$/.test(text)) return false;
        let ancestor = element.parentElement;
        for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
          const context = visibleText(ancestor);
          if (context.length < 250 && /\bprev(?:ious)?\s+module\b/i.test(context)) return false;
        }
        return true;
      });
    return candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0] || null;
  }

  async function processLoop() {
    while (state.active) {
      if (detectFinalAssessment()) {
        state.active = false;
        setState(MODULE_STATE.WAITING_FOR_USER, 'Assessment-like page detected. Copilot stopped without submitting it.');
        return;
      }
      setState(MODULE_STATE.DETECTING_QUESTION, 'Scanning visible page content for the statement, answer choices, and editor.');
      const root = getQuestionRoot();
      const question = root && detectQuestion(root);
      if (!question) {
        state.active = false;
        state.questionType = 'UNKNOWN';
        state.currentQuestion = 'Unrecognized question';
        state.progress = `${state.completed.size} / ?`;
        setState(MODULE_STATE.WAITING_FOR_USER, '⚠ Unsupported question type. The Copilot stopped before making any changes.');
        return;
      }

      const fingerprint = getFingerprint(question);
      if (state.completed.has(fingerprint) || fingerprint === state.currentFingerprint) {
        const navigation = findNavigationControl();
        if (!navigation) {
          state.active = false;
          setState(MODULE_STATE.WAITING_FOR_USER, 'No verifiable next-question control found. Please check the page before continuing.');
          return;
        }
        navigation.click();
        const next = await waitForChangedQuestion(fingerprint);
        if (!next) {
          state.active = false;
          setState(MODULE_STATE.WAITING_FOR_USER, 'The question did not change after navigation. Copilot stopped to avoid a loop.');
          return;
        }
        state.currentFingerprint = null;
        continue;
      }

      state.currentFingerprint = fingerprint;
      state.questionType = question.type;
      state.currentQuestion = question.title.slice(0, 70) || `Question ${state.completed.size + 1}`;
      state.progress = `${state.completed.size} / ?`;
      setState(MODULE_STATE.CLASSIFYING, `Detected ${question.type} question.`);

      if (question.type === 'MCQ') {
        setState(MODULE_STATE.SOLVING, 'Sending only the question and options to the model.');
        const selected = await solveMcq(question);
        if (!state.active || !selected) return;
      } else if (question.type === 'PROGRAMMING') {
        if (detectFinalAssessment()) {
          state.active = false;
          setState(MODULE_STATE.WAITING_FOR_USER, 'Assessment-like page detected. Code may be prepared and run, but Copilot will not submit an assessment.');
          return;
        }
        const passed = await solveProgramming(question);
        if (!passed) {
          if (state.status === MODULE_STATE.WAITING_FOR_USER) return;
          throw new Error('The programming solution was not verified. No submit or next action was taken.');
        }
      } else {
        throw new Error('Unsupported question type. No changes were made.');
      }

      setState(MODULE_STATE.VERIFYING, `${question.type} interaction verified.`);
      state.completed.add(fingerprint);
      state.progress = `${state.completed.size} / ?`;
      state.currentFingerprint = null;

      const nextButton = findNavigationControl();
      if (!nextButton) {
        state.active = false;
        if (detectModuleCompletion()) {
          setState(MODULE_STATE.COMPLETED, `Module completed. ${state.completed.size} question(s) verified.`);
        } else {
          setState(MODULE_STATE.WAITING_FOR_USER, 'Current question is verified. No next control is visible; please verify whether the module is complete.');
        }
        return;
      }

      const oldFingerprint = fingerprint;
      setState(MODULE_STATE.MOVING_NEXT, 'Moving to the next question after verification.');
      nextButton.click();
      const next = await waitForChangedQuestion(oldFingerprint);
      if (!next) {
        state.active = false;
        setState(MODULE_STATE.WAITING_FOR_USER, 'Could not confirm that a new question loaded. Stopped safely.');
        return;
      }
    }
  }

  async function startCopilot() {
    if (state.busy) return;
    state.active = true;
    state.busy = true;
    state.failedQuestion = null;
    if (!state.completed.size) {
      state.attempts = 0;
      state.aiCalls = 0;
    }
    if (detectFinalAssessment()) {
      state.active = false;
      state.busy = false;
      setState(MODULE_STATE.WAITING_FOR_USER, 'Assessment-like page detected. Automatic module solving is disabled on assessment pages.');
      return;
    }
    setState(MODULE_STATE.DETECTING_QUESTION, 'Scanning the current CodeChef page now.');
    try {
      const initial = await waitForQuestion();
      if (!state.active) return;
      if (!initial) throw new Error(describeDetectionFailure());
      state.questionType = initial.type;
      state.currentQuestion = initial.title.slice(0, 70);
      setState(MODULE_STATE.CLASSIFYING, `Crawled visible page content; found ${initial.type} question and ${initial.type === 'PROGRAMMING' ? 'editor' : `${initial.options.length} answer options`}. Sending compact context to the model.`);
      await processLoop();
    } catch (error) {
      state.active = false;
      state.failedQuestion = getQuestionRoot() ? detectQuestion(getQuestionRoot()) : null;
      setState(MODULE_STATE.FAILED, error.message || 'Unexpected error while processing question.');
    } finally {
      state.busy = false;
      renderPanel();
    }
  }

  function waitForQuestion() {
    const root = getQuestionRoot();
    return Promise.resolve(root && detectQuestion(root));
  }

  function describeDetectionFailure() {
    const editorCount = findVisibleEditors().length;
    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .filter(isVisible)
      .slice(0, 5)
      .map(visibleText)
      .filter(Boolean);
    return `Could not detect a supported question during the immediate page scan. Found ${editorCount} visible code editor(s); page headings: ${headings.join(' | ') || 'none'}.`;
  }

  async function retryFailedQuestion() {
    if (state.busy) return;
    state.currentFingerprint = null;
    state.failedQuestion = null;
    await startCopilot();
  }

  async function skipFailedQuestion() {
    const fingerprint = state.failedQuestion && getFingerprint(state.failedQuestion);
    if (!fingerprint) {
      setState(MODULE_STATE.WAITING_FOR_USER, 'Could not identify this failed question; it was not skipped.');
      return;
    }
    state.completed.add(fingerprint);
    state.failedQuestion = null;
    state.currentFingerprint = null;
    state.active = true;
    await startCopilot();
  }

  function stopCopilot() {
    state.active = false;
    setState(MODULE_STATE.WAITING_FOR_USER, 'Stopped by user. No final assessment was submitted.');
  }

  function handleMessage(message, _sender, sendResponse) {
    if (message?.type === 'COPILOT_START') {
      void startCopilot();
      sendResponse({ ok: true });
      return true;
    }
    if (message?.type === 'COPILOT_STOP') {
      stopCopilot();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  }

  function install() {
    if (!/codechef\.com$/i.test(location.hostname)) return;
    chrome.runtime.onMessage.addListener(handleMessage);
    renderPanel();
    setState(MODULE_STATE.IDLE, 'CodeChef page ready. Use the extension popup or page panel to start.');
    const observer = new MutationObserver(() => {
      if (!state.active && state.panel?.isConnected === false) renderPanel();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    state.observers.push(observer);
  }

  install();
})();
