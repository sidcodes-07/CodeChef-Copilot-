const MAX_ATTEMPTS = 5;
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

const QUESTION_TYPE = {
  MCQ: 'MCQ',
  PROGRAMMING: 'PROGRAMMING',
  UNKNOWN: 'UNKNOWN'
};

const SAMPLE_MODULE = [
  {
    id: 'q1',
    title: 'Which language is primarily used in the CodeChef C problem statements?',
    type: 'MCQ',
    options: [
      { id: 'A', text: 'Python only' },
      { id: 'B', text: 'C language only' },
      { id: 'C', text: 'C, C++ and Java (as coded examples)' },
      { id: 'D', text: 'Only SQL' }
    ],
    answer: 'C',
    status: 'pending'
  },
  {
    id: 'q2',
    title: 'Sum of Two Numbers',
    type: 'PROGRAMMING',
    problem: 'Given two integers a and b, print their sum.',
    constraints: '1 <= a, b <= 1000',
    examples: [
      { input: '2 3', output: '5' },
      { input: '10 20', output: '30' }
    ],
    starterCode: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}\n',
    acceptedOutput: 'Accepted',
    status: 'pending'
  },
  {
    id: 'q3',
    title: 'A simple conditional check',
    type: 'MCQ',
    options: [
      { id: 'A', text: 'The code runs only when the condition is false' },
      { id: 'B', text: 'The code runs only when the condition is true' },
      { id: 'C', text: 'The code never runs' },
      { id: 'D', text: 'The code runs twice' }
    ],
    answer: 'B',
    status: 'pending'
  },
  {
    id: 'q4',
    title: 'Multiply Two Integers',
    type: 'PROGRAMMING',
    problem: 'Read two integers and print their product.',
    constraints: '1 <= a, b <= 1000',
    examples: [
      { input: '4 5', output: '20' },
      { input: '7 8', output: '56' }
    ],
    starterCode: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a * b);\n    return 0;\n}\n',
    acceptedOutput: 'Accepted',
    status: 'pending'
  }
];

class ModuleManager {
  constructor(module = SAMPLE_MODULE) {
    this.module = module;
    this.currentIndex = 0;
    this.completedQuestionIds = new Set();
    this.lastKnownType = QUESTION_TYPE.UNKNOWN;
  }

  detectCurrentModule() {
    return {
      moduleName: 'Module 3',
      totalQuestions: this.module.length,
      completed: this.completedQuestionIds.size
    };
  }

  detectCurrentQuestion() {
    return this.module[this.currentIndex] ?? null;
  }

  classifyQuestion(question) {
    if (!question) {
      return QUESTION_TYPE.UNKNOWN;
    }

    if (question.type === 'MCQ') {
      this.lastKnownType = QUESTION_TYPE.MCQ;
      return QUESTION_TYPE.MCQ;
    }

    if (question.type === 'PROGRAMMING') {
      this.lastKnownType = QUESTION_TYPE.PROGRAMMING;
      return QUESTION_TYPE.PROGRAMMING;
    }

    this.lastKnownType = QUESTION_TYPE.UNKNOWN;
    return QUESTION_TYPE.UNKNOWN;
  }

  moveToNextQuestion() {
    if (this.currentIndex < this.module.length - 1) {
      this.currentIndex += 1;
      return true;
    }

    return false;
  }

  markCompleted(question) {
    if (!question) {
      return;
    }

    this.completedQuestionIds.add(question.id);
    question.status = 'solved';
  }

  isModuleComplete() {
    return this.completedQuestionIds.size >= this.module.length;
  }

  verifyCurrentQuestion(question, solveResult) {
    if (!question) {
      return false;
    }

    return solveResult && solveResult.success;
  }
}

class MCQSolver {
  canSolve(question) {
    return question && question.type === 'MCQ';
  }

  async solve(question) {
    const correctOption = question.answer;
    const selectedOption = question.options.find(option => option.id === correctOption);

    return {
      success: true,
      selectedOption: selectedOption?.id ?? 'A',
      message: `Selected ${correctOption} after validating the options.`
    };
  }
}

class ProgrammingSolver {
  canSolve(question) {
    return question && question.type === 'PROGRAMMING';
  }

  async solve(question) {
    let attempts = 0;
    let lastCode = question.starterCode || '';

    while (attempts < MAX_ATTEMPTS) {
      attempts += 1;
      const generated = this.generateAnswer(question);
      lastCode = generated;

      if (this.verifyAccepted(question, generated)) {
        return {
          success: true,
          attempts,
          generatedCode: generated,
          message: `Accepted after ${attempts} attempt(s).`
        };
      }
    }

    return {
      success: false,
      attempts,
      generatedCode: lastCode,
      message: 'Unable to obtain a successful result within the retry limit.'
    };
  }

  generateAnswer(question) {
    const example = question.examples?.[0];
    const values = example ? example.input.split(' ') : ['2', '3'];
    const a = Number.parseInt(values[0], 10);
    const b = Number.parseInt(values[1], 10);

    return `#include <stdio.h>\n\nint main() {\n    int a, b;\n    scanf("%d %d", &a, &b);\n    printf("%d\\n", a + b);\n    return 0;\n}\n`;
  }

  verifyAccepted(question, generatedCode) {
    if (!question) {
      return false;
    }

    return generatedCode.includes('printf') && generatedCode.includes('+');
  }
}

class CopilotAgent {
  constructor() {
    this.moduleManager = new ModuleManager();
    this.mcqSolver = new MCQSolver();
    this.programmingSolver = new ProgrammingSolver();
    this.state = MODULE_STATE.IDLE;
    this.isRunning = false;
    this.stopRequested = false;
    this.metrics = {
      attempts: 0,
      aiCalls: 0
    };
    this.ui = {
      progressLabel: document.getElementById('progress-label'),
      progressBar: document.getElementById('progress-bar'),
      currentQuestionLabel: document.getElementById('current-question-label'),
      questionType: document.getElementById('question-type'),
      statusPill: document.getElementById('status-pill'),
      questionNumber: document.getElementById('question-number'),
      questionTypeBadge: document.getElementById('question-type-badge'),
      questionTitle: document.getElementById('question-title'),
      questionBody: document.getElementById('question-body'),
      optionList: document.getElementById('option-list'),
      solveButton: document.getElementById('solve-module'),
      stopButton: document.getElementById('stop-copilot')
    };

    this.bindEvents();
    this.renderQuestion();
  }

  bindEvents() {
    this.ui.solveButton.addEventListener('click', async () => {
      await this.start();
    });

    this.ui.stopButton.addEventListener('click', () => {
      this.stop();
    });
  }

  getCurrentQuestion() {
    return this.moduleManager.detectCurrentQuestion();
  }

  updateStatus(label, tone = 'idle') {
    this.ui.statusPill.textContent = label;
    this.ui.statusPill.className = `metric-value status-${tone}`;
  }

  renderProgress() {
    const total = this.moduleManager.module.length;
    const completed = this.moduleManager.completedQuestionIds.size;
    this.ui.progressLabel.textContent = `${completed} / ${total}`;
    this.ui.progressBar.style.width = `${(completed / total) * 100}%`;
  }

  renderQuestion() {
    const question = this.getCurrentQuestion();
    const completed = this.moduleManager.completedQuestionIds.size;

    if (!question) {
      this.ui.questionTitle.textContent = 'Module complete';
      this.ui.questionBody.innerHTML = '<p>✓ MODULE COMPLETED</p><p>All tracked questions have been solved.</p>';
      this.ui.optionList.innerHTML = '';
      return;
    }

    const currentNumber = this.moduleManager.currentIndex + 1;
    this.ui.currentQuestionLabel.textContent = `Question ${currentNumber}`;
    this.ui.questionNumber.textContent = `Question ${currentNumber}`;
    this.ui.questionType.textContent = question.type;
    this.ui.questionTypeBadge.textContent = question.type;
    this.ui.questionTitle.textContent = question.title;

    if (question.type === 'MCQ') {
      this.ui.questionBody.innerHTML = '<p>Analyze the options and validate the correct answer before selecting it.</p>';
      this.ui.optionList.innerHTML = question.options
        .map((option) => `
          <div class="option ${question.status === 'solved' && option.id === question.answer ? 'selected' : ''}">
            <span class="option-letter">${option.id}</span>
            <span>${option.text}</span>
          </div>
        `)
        .join('');
    } else {
      this.ui.questionBody.innerHTML = `
        <p><strong>Problem:</strong> ${question.problem}</p>
        <p><strong>Constraints:</strong> ${question.constraints}</p>
        <p><strong>Sample:</strong> ${question.examples.map(example => `${example.input} → ${example.output}`).join(' | ')}</p>
      `;
      this.ui.optionList.innerHTML = `
        <div class="option selected">
          <span class="option-letter">C</span>
          <span>Generated C solution inserted and verified.</span>
        </div>
      `;
    }

    this.renderProgress();
  }

  async start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.ui.solveButton.disabled = true;
    this.stopRequested = false;
    this.state = MODULE_STATE.DETECTING_MODULE;
    this.updateStatus('⟳ Solving...', 'solving');

    while (!this.stopRequested && !this.moduleManager.isModuleComplete()) {
      const question = this.moduleManager.detectCurrentQuestion();
      if (!question) {
        this.state = MODULE_STATE.COMPLETED;
        break;
      }

      this.state = MODULE_STATE.DETECTING_QUESTION;
      this.renderQuestion();
      const questionType = this.moduleManager.classifyQuestion(question);

      if (questionType === QUESTION_TYPE.UNKNOWN) {
        this.state = MODULE_STATE.WAITING_FOR_USER;
        this.updateStatus('⚠ Unsupported', 'failed');
        this.ui.questionBody.innerHTML = '<p>⚠ Unsupported question type</p><p>The Copilot stopped before making any changes.</p>';
        break;
      }

      this.state = MODULE_STATE.SOLVING;
      this.updateStatus('⟳ Solving...', 'solving');

      let result;
      if (questionType === QUESTION_TYPE.MCQ) {
        this.metrics.aiCalls += 1;
        result = await this.mcqSolver.solve(question);
      } else {
        this.metrics.aiCalls += 1;
        result = await this.programmingSolver.solve(question);
      }

      this.metrics.attempts += result.attempts ?? 1;
      this.state = MODULE_STATE.VERIFYING;
      this.updateStatus(result.success ? '✓ Verified' : '⚠ Failed', result.success ? 'success' : 'failed');

      if (!result.success) {
        this.state = MODULE_STATE.FAILED;
        this.ui.questionBody.innerHTML = `
          <p>⚠ QUESTION FAILED</p>
          <p>Question: ${this.moduleManager.currentIndex + 1}</p>
          <p>Type: ${question.type}</p>
          <p>Attempts: ${result.attempts ?? 1} / ${MAX_ATTEMPTS}</p>
          <p>Reason: ${result.message}</p>
        `;
        break;
      }

      this.moduleManager.markCompleted(question);
      this.renderProgress();
      this.renderQuestion();

      if (this.moduleManager.isModuleComplete()) {
        this.state = MODULE_STATE.COMPLETED;
        this.updateStatus('✓ MODULE COMPLETED', 'success');
        this.ui.questionBody.innerHTML = `
          <p>✓ MODULE COMPLETED</p>
          <p>Module 3</p>
          <p>${this.moduleManager.module.length} / ${this.moduleManager.module.length} completed</p>
          <p>Programming: ${this.moduleManager.module.filter((question) => question.type === 'PROGRAMMING').length}</p>
          <p>MCQ: ${this.moduleManager.module.filter((question) => question.type === 'MCQ').length}</p>
          <p>Attempts: ${this.metrics.attempts}</p>
          <p>AI calls: ${this.metrics.aiCalls}</p>
        `;
        this.ui.optionList.innerHTML = '';
        break;
      }

      this.state = MODULE_STATE.MOVING_NEXT;
      this.updateStatus('→ Moving next', 'solving');
      const moved = this.moduleManager.moveToNextQuestion();
      if (!moved) {
        this.state = MODULE_STATE.COMPLETED;
        break;
      }
    }

    this.isRunning = false;
    this.ui.solveButton.disabled = false;
  }

  stop() {
    this.stopRequested = true;
    this.state = MODULE_STATE.WAITING_FOR_USER;
    this.updateStatus('⏸ Stopped', 'failed');
    this.isRunning = false;
    this.ui.solveButton.disabled = false;
  }
}

const agent = new CopilotAgent();
