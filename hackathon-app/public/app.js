// Daily Work Navigator — Client Controller

let currentStories = [];
let timerInterval = null;
let startTime = null;

// DOM Elements: Hacker News Workflow
const runTaskBtn = document.getElementById('runTaskBtn');
const btnText = document.getElementById('btnText');
const btnSpinner = document.getElementById('btnSpinner');
const statusSummary = document.getElementById('statusSummary');

// DOM Elements: Self-Healing Workflow
const runHealingBtn = document.getElementById('runHealingBtn');
const healingBtnText = document.getElementById('healingBtnText');
const healingSpinner = document.getElementById('healingSpinner');
const healingStatusSummary = document.getElementById('healingStatusSummary');
const healingTracker = document.getElementById('healingTracker');
const comparisonPanel = document.getElementById('comparisonPanel');
const run1Metrics = document.getElementById('run1Metrics');
const run2Metrics = document.getElementById('run2Metrics');

// DOM Elements: Terminal Console
const terminalBody = document.getElementById('terminalBody');
const consoleIndicator = document.getElementById('consoleIndicator');
const consoleStatusText = document.getElementById('consoleStatusText');
const elapsedVal = document.getElementById('elapsedVal');
const sessionVal = document.getElementById('sessionVal');

// DOM Elements: Results
const storiesList = document.getElementById('storiesList');
const resultsCount = document.getElementById('resultsCount');
const copyMdBtn = document.getElementById('copyMdBtn');

function formatTime(date) {
  return date.toTimeString().split(' ')[0];
}

function appendLog(message, step = 'system', isError = false) {
  const entry = document.createElement('div');
  entry.className = `log-entry log-step-${step} ${isError ? 'log-error' : ''}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${formatTime(new Date())}]`;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = message;

  entry.appendChild(timeSpan);
  entry.appendChild(msgSpan);
  terminalBody.appendChild(entry);

  // Auto-scroll to bottom
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

function startTimer() {
  startTime = Date.now();
  elapsedVal.textContent = '0.0s';
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    elapsedVal.textContent = `${elapsed}s`;
  }, 100);
}

function stopTimer() {
  clearInterval(timerInterval);
  if (startTime) {
    const total = ((Date.now() - startTime) / 1000).toFixed(1);
    elapsedVal.textContent = `${total}s`;
    return total;
  }
  return '0.0';
}

function setHnRunningState(isRunning) {
  if (isRunning) {
    runTaskBtn.disabled = true;
    runHealingBtn.disabled = true;
    runTaskBtn.classList.add('running');
    btnText.textContent = 'Automating in Browser...';
    consoleIndicator.classList.add('active');
    consoleStatusText.textContent = 'RUNNING (HN)';
    statusSummary.textContent = 'Webcmd browser active...';
    startTimer();
  } else {
    runTaskBtn.disabled = false;
    runHealingBtn.disabled = false;
    runTaskBtn.classList.remove('running');
    btnText.textContent = 'Run Hacker News Briefing';
    consoleIndicator.classList.remove('active');
  }
}

function setHealingRunningState(isRunning) {
  if (isRunning) {
    runHealingBtn.disabled = true;
    runTaskBtn.disabled = true;
    healingSpinner.style.display = 'inline-block';
    healingBtnText.textContent = 'Recovering Navigation...';
    consoleIndicator.classList.add('active');
    consoleStatusText.textContent = 'HEALING DEMO';
    healingStatusSummary.textContent = 'Self-healing workflow active...';
    startTimer();
  } else {
    runHealingBtn.disabled = false;
    runTaskBtn.disabled = false;
    healingSpinner.style.display = 'none';
    healingBtnText.textContent = 'Run Self-Healing Demo';
    consoleIndicator.classList.remove('active');
  }
}

function renderStories(stories) {
  currentStories = stories;
  resultsCount.textContent = `${stories.length} stories`;

  if (!stories || stories.length === 0) {
    storiesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p class="empty-title">No stories returned</p>
        <p class="empty-subtitle">Check terminal logs for extraction details.</p>
      </div>
    `;
    return;
  }

  storiesList.innerHTML = stories
    .map(
      (story) => `
      <div class="story-item">
        <div class="story-rank">#${story.rank}</div>
        <div class="story-content">
          <a class="story-title-link" href="${story.url}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(story.title)}
          </a>
          <div class="story-meta">
            <span class="story-domain">${escapeHtml(story.domain)}</span>
            <span class="story-score">▲ ${escapeHtml(story.score)}</span>
            <span class="story-author">by ${escapeHtml(story.author)}</span>
            <span class="story-comments">${escapeHtml(story.comments)}</span>
          </div>
        </div>
      </div>
    `
    )
    .join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------
// WORKFLOW #1: Hacker News Briefing
// -------------------------------------------------------------
function runAutomation() {
  setHnRunningState(true);
  appendLog('--- Starting Daily Hacker News Briefing Workflow ---', 'start');

  const eventSource = new EventSource('/api/run-hn-stream');

  eventSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data);
      appendLog(data.message, data.step);
      statusSummary.textContent = data.message;

      if (data.step === 'session_ready' && data.message.includes(':')) {
        const id = data.message.split(':').pop().trim();
        sessionVal.textContent = id;
      }
    } catch (err) {
      appendLog(e.data, 'raw');
    }
  });

  eventSource.addEventListener('result', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.stories) {
        renderStories(data.stories);
        appendLog(`Successfully received ${data.stories.length} structured stories.`, 'extracted');
      }
    } catch (err) {
      console.error('Failed to parse result payload:', err);
    }
  });

  eventSource.addEventListener('done', () => {
    eventSource.close();
    const duration = stopTimer();
    setHnRunningState(false);
    consoleStatusText.textContent = 'COMPLETED';
    statusSummary.textContent = `Completed in ${duration}s`;
    appendLog(`Task finished cleanly in ${duration}s. Session closed.`, 'done');
  });

  eventSource.addEventListener('error', (e) => {
    eventSource.close();
    const duration = stopTimer();
    setHnRunningState(false);
    consoleStatusText.textContent = 'FAILED';
    let msg = 'Automation encountered an error.';
    try {
      if (e.data) {
        const parsed = JSON.parse(e.data);
        msg = parsed.message || msg;
      }
    } catch {}
    statusSummary.textContent = 'Failed: ' + msg;
    appendLog(msg, 'error', true);
  });
}

// -------------------------------------------------------------
// WORKFLOW #2: Self-Healing Work Portal Demo
// -------------------------------------------------------------
const stepIds = [
  'step-memory',
  'step-attempt',
  'step-failed',
  'step-inspect',
  'step-recovered',
  'step-checkpoint',
  'step-run2',
];

function resetStepBadges() {
  stepIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.className = 'step-badge';
    }
  });
}

function updateStep(id, state) {
  const el = document.getElementById(id);
  if (el) {
    el.className = `step-badge ${state}`;
  }
}

function runSelfHealingDemo() {
  setHealingRunningState(true);
  healingTracker.style.display = 'flex';
  comparisonPanel.style.display = 'none';
  resetStepBadges();

  appendLog('--- Starting Self-Healing Work Portal Workflow ---', 'start');

  const eventSource = new EventSource('/api/run-self-healing-stream');

  eventSource.addEventListener('status', (e) => {
    try {
      const data = JSON.parse(e.data);
      appendLog(`[Phase ${data.phase || 1}] ${data.message}`, data.step);
      healingStatusSummary.textContent = data.message;

      if (data.step === 'session_ready' || data.step === 'run2_session_ready') {
        const id = data.message.split(':').pop().trim();
        sessionVal.textContent = id;
      }

      // Progression badges state machine
      switch (data.step) {
        case 'memory_load':
          updateStep('step-memory', 'active');
          break;
        case 'memory_loaded':
          updateStep('step-memory', 'done');
          updateStep('step-attempt', 'active');
          break;
        case 'attempt_stale':
          updateStep('step-attempt', 'active');
          break;
        case 'path_failed':
          updateStep('step-attempt', 'failed');
          updateStep('step-failed', 'done');
          updateStep('step-inspect', 'active');
          break;
        case 'recovering':
          updateStep('step-inspect', 'active');
          break;
        case 'path_recovered':
          updateStep('step-inspect', 'done');
          updateStep('step-recovered', 'done');
          updateStep('step-checkpoint', 'active');
          break;
        case 'memory_checkpointed':
          updateStep('step-checkpoint', 'done');
          break;
        case 'run2_start':
          updateStep('step-run2', 'active');
          break;
        case 'run2_success':
          updateStep('step-run2', 'done');
          break;
      }
    } catch (err) {
      appendLog(e.data, 'raw');
    }
  });

  eventSource.addEventListener('result', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.summary) {
        comparisonPanel.style.display = 'block';
        const r1 = data.summary.run1;
        const r2 = data.summary.run2;

        if (r1?.metrics) {
          run1Metrics.innerHTML = `<span>Briefing: ${r1.metrics.prs} PRs • ${r1.metrics.deployments} Deployments • ${r1.metrics.health} Health</span>`;
        }
        if (r2?.metrics) {
          run2Metrics.innerHTML = `<span>Briefing: ${r2.metrics.prs} PRs • ${r2.metrics.deployments} Deployments • ${r2.metrics.health} Health</span>`;
        }
        appendLog('Self-healing comparison summary rendered.', 'extracted');
      }
    } catch (err) {
      console.error('Failed to parse result payload:', err);
    }
  });

  eventSource.addEventListener('done', () => {
    eventSource.close();
    const duration = stopTimer();
    setHealingRunningState(false);
    consoleStatusText.textContent = 'HEALED';
    healingStatusSummary.textContent = `Completed & Repaired in ${duration}s`;
    appendLog(`Self-healing cycle completed successfully in ${duration}s!`, 'done');
  });

  eventSource.addEventListener('error', (e) => {
    eventSource.close();
    const duration = stopTimer();
    setHealingRunningState(false);
    consoleStatusText.textContent = 'FAILED';
    let msg = 'Self-healing demo encountered an error.';
    try {
      if (e.data) {
        const parsed = JSON.parse(e.data);
        msg = parsed.message || msg;
      }
    } catch {}
    healingStatusSummary.textContent = 'Failed: ' + msg;
    appendLog(msg, 'error', true);
  });
}

// Copy results as formatted Markdown
copyMdBtn.addEventListener('click', async () => {
  if (!currentStories || currentStories.length === 0) {
    alert('No stories to copy yet! Run the briefing first.');
    return;
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const md = [
    `# Hacker News Morning Briefing (${dateStr})`,
    `Extracted via Webcmd Browser Automation\n`,
    ...currentStories.map(
      (s) => `${s.rank}. [${s.title}](${s.url}) — *${s.score} by ${s.author}* (${s.domain})`
    ),
  ].join('\n');

  try {
    await navigator.clipboard.writeText(md);
    const prevText = copyMdBtn.innerHTML;
    copyMdBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      copyMdBtn.innerHTML = prevText;
    }, 2000);
  } catch (err) {
    alert('Failed to copy to clipboard.');
  }
});

runTaskBtn.addEventListener('click', runAutomation);
runHealingBtn.addEventListener('click', runSelfHealingDemo);
