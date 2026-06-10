import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
  delete process.env[key];
}
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost']
  .filter(Boolean)
  .join(',');

const cdpBase = process.env.CDP_BASE || 'http://127.0.0.1:9222';
const userDataDir = process.env.DOUYIN_CDP_USER_DATA_DIR ||
  path.join(os.homedir(), '.codex', 'chrome-profiles', 'douyin-cdp');

async function cdpReady() {
  try {
    const response = await fetch(`${cdpBase}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (await cdpReady()) {
    console.log(`Chrome CDP already running at ${cdpBase}`);
    return;
  }

  await fs.mkdir(userDataDir, { recursive: true });
  const args = [
    '-na',
    'Google Chrome',
    '--args',
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    'about:blank',
  ];
  const child = spawn('open', args, { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await cdpReady()) {
      console.log(`Started Chrome CDP at ${cdpBase}`);
      console.log(`Persistent profile: ${userDataDir}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Started Chrome but CDP did not become ready at ${cdpBase}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
