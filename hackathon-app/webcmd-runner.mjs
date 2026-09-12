import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEBCMD_BIN = path.join(ROOT, 'dist', 'src', 'main.js');

/**
 * Execute a Webcmd command and parse JSON output.
 */
async function runWebcmd(args, stdinInput = null, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WEBCMD_BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let timer = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Webcmd command timed out after ${timeoutMs}ms: webcmd ${args.join(' ')}`));
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (code !== 0) {
        let parsedErr = null;
        try {
          parsedErr = JSON.parse(stdout);
        } catch {
          // not json
        }
        const message = parsedErr?.error?.message || stderr || stdout || `Process exited with code ${code}`;
        const error = new Error(message);
        error.code = parsedErr?.error?.code || 'WEBCMD_EXIT_ERROR';
        error.stdout = stdout;
        error.stderr = stderr;
        error.exitCode = code;
        return reject(error);
      }

      try {
        const parsed = stdout ? JSON.parse(stdout) : {};
        resolve(parsed);
      } catch (err) {
        resolve({ raw: stdout });
      }
    });

    if (stdinInput !== null) {
      child.stdin.end(stdinInput);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Execute the top 5 Hacker News extraction workflow.
 * @param {Function} onStatus Callback for live status events: ({ message, step, timestamp }) => void
 */
export async function extractHackerNewsTop5(onStatus = () => {}) {
  const notify = (message, step) => {
    onStatus({ message, step, timestamp: new Date().toISOString() });
  };

  let sessionId = null;

  try {
    notify('Starting Webcmd browser engine...', 'start');
    
    // 1. Create a dedicated browser session
    notify('Creating browser session for daily briefing...', 'session_create');
    const sessionRes = await runWebcmd(['session', 'create', 'daily-hn', '-f', 'json']);
    sessionId = sessionRes.id;
    if (!sessionId) {
      throw new Error(`Failed to create browser session. Response: ${JSON.stringify(sessionRes)}`);
    }
    notify(`Browser session created: ${sessionId}`, 'session_ready');

    // 2. Open Hacker News & Extract top 5 stories in a single QuickJS program
    notify('Opening Hacker News (https://news.ycombinator.com)...', 'navigating');

    const extractScript = `
      await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded' });
      
      const stories = await page.evaluate(() => {
        const rows = document.querySelectorAll('tr.athing');
        const items = [];
        
        for (let i = 0; i < Math.min(5, rows.length); i++) {
          const row = rows[i];
          const titleAnchor = row.querySelector('.titleline > a');
          const subtext = row.nextElementSibling;
          
          let scoreText = '0 points';
          let author = 'anonymous';
          let comments = '0 comments';
          
          if (subtext) {
            const scoreEl = subtext.querySelector('.score');
            if (scoreEl) scoreText = scoreEl.textContent.trim();
            
            const authorEl = subtext.querySelector('.hnuser');
            if (authorEl) author = authorEl.textContent.trim();

            const links = subtext.querySelectorAll('a');
            for (let j = 0; j < links.length; j++) {
              const text = links[j].textContent || '';
              if (text.includes('comment') || text.includes('discuss')) {
                comments = text.trim();
                break;
              }
            }
          }
          
          if (titleAnchor) {
            const rawUrl = titleAnchor.getAttribute('href') || '';
            const fullUrl = rawUrl.startsWith('item?id=') 
              ? 'https://news.ycombinator.com/' + rawUrl 
              : rawUrl;
              
            let domain = '';
            try {
              domain = new URL(fullUrl).hostname.replace(/^www\\./, '');
            } catch {
              domain = 'news.ycombinator.com';
            }

            items.push({
              rank: i + 1,
              title: titleAnchor.textContent ? titleAnchor.textContent.trim() : '',
              url: fullUrl,
              domain: domain,
              score: scoreText,
              author: author,
              comments: comments
            });
          }
        }
        return items;
      });
      
      return { 
        url: page.url(),
        title: await page.title(),
        stories: stories 
      };
    `;

    notify('Extracting top 5 stories and metadata...', 'extracting');
    const runRes = await runWebcmd(
      ['--session', sessionId, 'browser', 'run', '--stdin', '--no-snapshot-diff', '-f', 'json'],
      extractScript,
      45000
    );

    const stories = runRes?.result?.stories || [];
    notify(`Successfully extracted ${stories.length} stories!`, 'extracted');

    return {
      success: true,
      stories,
      sessionId,
      extractedAt: new Date().toISOString()
    };
  } finally {
    // 3. Guaranteed cleanup: close session
    if (sessionId) {
      notify(`Closing browser session (${sessionId})...`, 'session_closing');
      try {
        await runWebcmd(['session', 'close', sessionId, '--force', '-f', 'json']);
        notify('Browser session closed cleanly.', 'session_closed');
      } catch (closeErr) {
        notify(`Note on session closure: ${closeErr.message}`, 'session_close_warn');
      }
    }
    notify('Daily work automation task finished.', 'done');
  }
}

// CLI direct execution support: `node hackathon-app/webcmd-runner.mjs`
if (process.argv[1] && process.argv[1].endsWith('webcmd-runner.mjs')) {
  console.log('Testing Hacker News extraction workflow via Webcmd...');
  extractHackerNewsTop5(({ message, step }) => {
    console.log(`[${step}] ${message}`);
  })
    .then((result) => {
      console.log('\\n--- Extraction Result ---');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('\\nExtraction failed:', err);
      process.exit(1);
    });
}
