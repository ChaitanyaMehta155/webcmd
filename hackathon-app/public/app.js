// Daily Work Navigator — Client Controller

let currentStories = [];
let timerInterval = null;
let startTime = null;

const runTaskBtn = document.getElementById('runTaskBtn');
const btnText = document.getElementById('btnText');
const btnSpinner = document.getElementById('btnSpinner');
const statusSummary = document.getElementById('statusSummary');

const terminalBody = document.getElementById('terminalBody');
const consoleIndicator = document.getElementById('consoleIndicator');
const consoleStatusText = document.getElementById('consoleStatusText');
const elapsedVal = document.getElementById('elapsedVal');
const sessionVal = document.getElementById('sessionVal');

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

function setRunningState(isRunning) {
  if (isRunning) {
    runTaskBtn.disabled = true;
    runTaskBtn.classList.add('running');
    btnText.textContent = 'Automating in Browser...';
    consoleIndicator.classList.add('active');
    consoleStatusText.textContent = 'RUNNING';
    statusSummary.textContent = 'Webcmd browser active...';
    startTimer();
  } else {
    runTaskBtn.disabled = false;
    runTaskBtn.classList.remove('running');
    btnText.textContent = 'Run Hacker News Briefing';
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

// Trigger automation via SSE stream
function runAutomation() {
  setRunningState(true);
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

  eventSource.addEventListener('done', (e) => {
    eventSource.close();
    const duration = stopTimer();
    setRunningState(false);
    consoleStatusText.textContent = 'COMPLETED';
    statusSummary.textContent = `Completed in ${duration}s`;
    appendLog(`Task finished cleanly in ${duration}s. Session closed.`, 'done');
  });

  eventSource.addEventListener('error', (e) => {
    eventSource.close();
    const duration = stopTimer();
    setRunningState(false);
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
