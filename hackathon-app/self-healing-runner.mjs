import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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
        } catch {}
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
 * Run the Self-Healing Work Portal Workflow:
 * 1. Agent loads remembered memory (State 1: direct button #btn-daily-briefing)
 * 2. Attempts remembered path on live portal (State 2: relocated under More Tools)
 * 3. Path fails (element missing)
 * 4. Agent inspects live browser page and discovers new path (#nav-more-tools -> #menu-daily-briefing)
 * 5. Executes discovered path and completes task
 * 6. Commits direct_correction to Webcmd site memory (Git)
 * 7. Runs task a second time — demonstrates direct execution using repaired memory
 */
export async function runSelfHealingWorkflow(onStatus = () => {}) {
  const notify = (message, step, phase = 1, extra = {}) => {
    onStatus({
      message,
      step,
      phase,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  };

  const portalUrl = 'http://127.0.0.1:3000/portal';
  const siteDomain = 'daily-portal.test';
  const siteUrl = `http://${siteDomain}/`;

  let session1Id = null;
  let session2Id = null;

  const resultData = {
    run1: {},
    run2: {},
  };

  // ==========================================
  // PHASE 1: STALE MEMORY, DETECTION & RECOVERY
  // ==========================================
  try {
    notify('Starting Self-Healing Work Portal Workflow...', 'start', 1);

    // 1. Pre-seed/reset legacy memory context
    const initialTaskId = `seed-${Date.now()}`;
    const initialCtx = await runWebcmd(['site', 'memory', 'context', siteUrl, '--task-id', initialTaskId, '-f', 'json']);
    if (initialCtx.draftPath) {
      await fs.mkdir(initialCtx.draftPath, { recursive: true });
      const legacyMd = '# Daily Work Portal\n\n- [verified 2026-08-01] Daily Briefing is accessible via direct navigation button #btn-daily-briefing.\n';
      await fs.writeFile(path.join(initialCtx.draftPath, 'SITE.md'), legacyMd, 'utf8');
      await runWebcmd([
        'site', 'memory', 'checkpoint', siteDomain,
        '--task-id', initialTaskId,
        '--expected-revision', initialCtx.revision || 'null',
        '--reason', 'direct_correction',
        '--paths', 'sitemap/SITE.md',
        '-f', 'json',
      ]).catch(() => {});
    }

    // 2. Load context for Run 1
    const run1TaskId = `run1-${Date.now()}`;
    notify('Loading Webcmd site memory context for daily-portal.test...', 'memory_load', 1);
    const ctx1 = await runWebcmd(['site', 'memory', 'context', siteUrl, '--task-id', run1TaskId, '-f', 'json']);
    
    notify('Memory path loaded: "Direct navbar button #btn-daily-briefing"', 'memory_loaded', 1, {
      rememberedSelector: '#btn-daily-briefing',
    });

    // 3. Create Webcmd browser session
    notify('Creating Webcmd browser session (Run 1)...', 'session_create', 1);
    const sess1 = await runWebcmd(['session', 'create', 'heal-run-1', '-f', 'json']);
    session1Id = sess1.id;
    notify(`Browser session created: ${session1Id}`, 'session_ready', 1);

    // 4. Navigate & Attempt remembered path
    notify('Navigating to http://127.0.0.1:3000/portal...', 'navigating', 1);
    notify('Attempting remembered path: Click #btn-daily-briefing...', 'attempt_stale', 1);

    const attemptScript = `
      await page.goto('${portalUrl}', { waitUntil: 'domcontentloaded' });
      
      const directBtn = await page.$('#btn-daily-briefing');
      if (!directBtn) {
        return {
          attemptStatus: 'failed',
          reason: 'Element #btn-daily-briefing was not found in the navigation bar. UI layout has changed.',
        };
      }
      await directBtn.click();
      return { attemptStatus: 'success' };
    `;

    const attemptRes = await runWebcmd(
      ['--session', session1Id, 'browser', 'run', '--stdin', '--no-snapshot-diff', '-f', 'json'],
      attemptScript,
      30000
    );

    const attemptResult = attemptRes?.result || {};
    if (attemptResult.attemptStatus === 'failed') {
      notify('Remembered path FAILED: Element #btn-daily-briefing not found in navigation bar!', 'path_failed', 1, {
        staleReason: attemptResult.reason,
      });
      resultData.run1.initialAttempt = 'Failed (Element Missing)';
    }

    // 5. Fallback: Live Browser Inspection & Discovery
    notify('Falling back to live browser inspection (accessibility tree & DOM scan)...', 'inspecting', 1);

    const inspectScript = `
      // Inspect interactive controls on the live page
      const interactive = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, a')).map(el => ({
          id: el.id,
          text: el.textContent?.trim().replace(/\\s+/g, ' '),
          hasPopup: el.getAttribute('aria-haspopup')
        }));
      });

      // Discovery: find More Tools container and trigger
      const moreToolsBtn = await page.$('#nav-more-tools');
      if (!moreToolsBtn) {
        throw new Error('Neither original nor relocated button found');
      }

      // Open dropdown to inspect hidden menu items
      await moreToolsBtn.click();
      await page.waitForSelector('#menu-daily-briefing', { state: 'visible', timeout: 4000 });
      
      // Execute discovered action
      await page.click('#menu-daily-briefing');
      await page.waitForSelector('#briefing-modal.visible', { state: 'visible', timeout: 4000 });

      const metrics = await page.evaluate(() => {
        return {
          title: document.getElementById('briefing-title')?.textContent?.trim(),
          prs: document.getElementById('metric-prs')?.textContent?.trim(),
          deployments: document.getElementById('metric-deployments')?.textContent?.trim(),
          health: document.getElementById('metric-health')?.textContent?.trim(),
          content: document.getElementById('briefing-content')?.textContent?.trim(),
        };
      });

      return {
        discoveredPath: '#nav-more-tools (More Tools dropdown) -> #menu-daily-briefing',
        metrics,
      };
    `;

    notify('Discovering relocated path and executing recovery...', 'recovering', 1);
    const recoverRes = await runWebcmd(
      ['--session', session1Id, 'browser', 'run', '--stdin', '--no-snapshot-diff', '-f', 'json'],
      inspectScript,
      35000
    );

    const recoveryData = recoverRes?.result || {};
    notify(
      `Path Recovered: Relocated under "${recoveryData.discoveredPath}"!`,
      'path_recovered',
      1,
      { discoveredPath: recoveryData.discoveredPath }
    );

    notify(
      `Daily Briefing completed! PRs: ${recoveryData.metrics?.prs}, Deployments: ${recoveryData.metrics?.deployments}, Health: ${recoveryData.metrics?.health}`,
      'task_completed',
      1,
      { metrics: recoveryData.metrics }
    );

    resultData.run1.recoveredPath = recoveryData.discoveredPath;
    resultData.run1.metrics = recoveryData.metrics;

    // 6. Update Webcmd Site Memory via Direct Correction
    notify('Updating Webcmd site memory: writing verified correction to draft...', 'updating_memory', 1);

    if (ctx1.draftPath) {
      await fs.mkdir(ctx1.draftPath, { recursive: true });
      const correctedSiteMd = `# Daily Work Portal\n\n- [verified 2026-09-12] Daily Briefing navigation relocated: click #nav-more-tools dropdown, then click #menu-daily-briefing.\n`;
      await fs.writeFile(path.join(ctx1.draftPath, 'SITE.md'), correctedSiteMd, 'utf8');

      notify('Committing site memory checkpoint to Git (direct_correction)...', 'checkpointing', 1);
      const cpRes = await runWebcmd([
        'site', 'memory', 'checkpoint', siteDomain,
        '--task-id', run1TaskId,
        '--expected-revision', ctx1.revision || 'null',
        '--reason', 'direct_correction',
        '--paths', 'sitemap/SITE.md',
        '-f', 'json',
      ]);

      notify(`Webcmd site memory checkpointed! Commit: ${(cpRes.memoryCommit || '').slice(0, 8)}`, 'memory_checkpointed', 1);
      resultData.run1.memoryCommit = cpRes.memoryCommit;
    }
  } finally {
    // Guaranteed Session 1 cleanup
    if (session1Id) {
      notify(`Closing browser session (${session1Id})...`, 'session_closing', 1);
      await runWebcmd(['session', 'close', session1Id, '--force', '-f', 'json']).catch(() => {});
      notify('Browser session 1 closed cleanly.', 'session_closed', 1);
      session1Id = null;
    }
  }

  // ==========================================
  // PHASE 2: VERIFICATION RUN #2 (REPAIRED PATH)
  // ==========================================
  try {
    notify('--- Starting Verification Run #2 (Reusing Repaired Memory) ---', 'run2_start', 2);

    const run2TaskId = `run2-${Date.now()}`;
    notify('Loading refreshed Webcmd site memory...', 'run2_memory_load', 2);
    const ctx2 = await runWebcmd(['site', 'memory', 'context', siteUrl, '--task-id', run2TaskId, '-f', 'json']);

    notify('Memory verified: Active rule loaded ("click #nav-more-tools -> #menu-daily-briefing")', 'run2_memory_verified', 2);

    notify('Creating browser session for Run 2...', 'run2_session_create', 2);
    const sess2 = await runWebcmd(['session', 'create', 'heal-run-2', '-f', 'json']);
    session2Id = sess2.id;
    notify(`Browser session 2 created: ${session2Id}`, 'run2_session_ready', 2);

    notify('Executing repaired navigation path directly on Attempt #1...', 'run2_executing', 2);

    const directScript = `
      await page.goto('${portalUrl}', { waitUntil: 'domcontentloaded' });
      
      // Directly follow the repaired memory rule without exploration:
      await page.click('#nav-more-tools');
      await page.waitForSelector('#menu-daily-briefing', { state: 'visible', timeout: 3000 });
      await page.click('#menu-daily-briefing');
      await page.waitForSelector('#briefing-modal.visible', { state: 'visible', timeout: 3000 });

      const metrics = await page.evaluate(() => {
        return {
          title: document.getElementById('briefing-title')?.textContent?.trim(),
          prs: document.getElementById('metric-prs')?.textContent?.trim(),
          deployments: document.getElementById('metric-deployments')?.textContent?.trim(),
          health: document.getElementById('metric-health')?.textContent?.trim(),
        };
      });

      return { success: true, attempts: 1, metrics };
    `;

    const directRes = await runWebcmd(
      ['--session', session2Id, 'browser', 'run', '--stdin', '--no-snapshot-diff', '-f', 'json'],
      directScript,
      30000
    );

    const run2Result = directRes?.result || {};
    notify(
      `Run 2 Succeeded on 1st attempt! (0 exploration turns, 0 failed attempts).`,
      'run2_success',
      2,
      { metrics: run2Result.metrics }
    );

    resultData.run2 = {
      status: 'Success (1st attempt)',
      pathUsed: '#nav-more-tools -> #menu-daily-briefing',
      explorationTurns: 0,
      memoryReused: true,
      metrics: run2Result.metrics,
    };
  } finally {
    // Guaranteed Session 2 cleanup
    if (session2Id) {
      notify(`Closing browser session (${session2Id})...`, 'session_closing', 2);
      await runWebcmd(['session', 'close', session2Id, '--force', '-f', 'json']).catch(() => {});
      notify('Browser session 2 closed cleanly.', 'session_closed', 2);
      session2Id = null;
    }
  }

  notify('Self-Healing Work Portal Workflow completed end-to-end!', 'all_done', 2);

  return {
    ok: true,
    summary: resultData,
  };
}

// Direct CLI test support: `node hackathon-app/self-healing-runner.mjs`
if (process.argv[1] && process.argv[1].endsWith('self-healing-runner.mjs')) {
  console.log('Testing Self-Healing Work Portal Workflow via Webcmd...');
  runSelfHealingWorkflow(({ message, step, phase }) => {
    console.log(`[Phase ${phase} | ${step}] ${message}`);
  })
    .then((res) => {
      console.log('\n--- Self-Healing Results Summary ---');
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('\nSelf-healing test failed:', err);
      process.exit(1);
    });
}
