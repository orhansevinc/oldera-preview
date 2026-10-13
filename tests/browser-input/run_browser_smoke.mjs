import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd());
const strictBrowser = process.env.GITHUB_ACTIONS === 'true' || process.env.WS41_REQUIRE_BROWSER === '1';

const candidates = [
  process.env.CHROME_BIN,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

let browser = null;
for (const candidate of candidates) {
  try {
    await access(candidate, fsConstants.X_OK);
    browser = candidate;
    break;
  } catch {}
}

if (!browser) {
  const message = 'WS41 browser smoke: no Chromium/Chrome binary found';
  if (strictBrowser) throw new Error(message);
  console.log(`${message}; SKIP outside CI`);
  process.exit(0);
}

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8']
]);

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const candidate = normalize(join(root, urlPath));
    if (!candidate.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const data = await readFile(candidate);
    res.writeHead(200, { 'content-type': mime.get(extname(candidate)) || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    res.writeHead(404).end(String(error));
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/tests/browser-input/harness.html`;

try {
  const run = await new Promise((resolveRun, rejectRun) => {
    const child = spawn(browser, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--dump-dom',
      url
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectRun(new Error('browser smoke timed out after 30s'));
    }, 30000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
  });

  if (run.status !== 0) {
    throw new Error(`browser exited ${run.status}: ${run.stderr}`);
  }
  if (!run.stdout.includes('data-status="PASS"')) {
    throw new Error(`browser harness did not pass. DOM:\n${run.stdout}\nSTDERR:\n${run.stderr}`);
  }
  console.log(`WS41 browser smoke: PASS (${browser})`);
} catch (error) {
  if (!strictBrowser) {
    console.log(`WS41 browser smoke: SKIP outside CI (${error.message})`);
  } else {
    throw error;
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
