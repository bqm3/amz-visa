const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_LOCAL_LICENSE_SERVER_URL = 'https://lisense-server.vercel.app';

let serverProcess = null;
let cleanupRegistered = false;

function getConfiguredServerUrl() {
  return String(
    process.env.AMZ_LICENSE_SERVER_URL ||
      process.env.LICENSE_SERVER_URL ||
      ''
  ).trim().replace(/\/+$/, '');
}

function candidateServerPaths() {
  return [
    path.join(__dirname, '..', '..', 'license-server', 'server.js'),
    path.join(__dirname, '..', '..', '..', 'license-server', 'server.js')
  ];
}

function findBundledServerScript() {
  for (const candidate of candidateServerPaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function probeUrl(urlString, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (_) {
      resolve(false);
      return;
    }

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      url,
      {
        method: 'GET',
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', () => resolve(false));
    req.end();
  });
}

async function waitForServer(urlString, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeUrl(`${urlString}/api/health`)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    if (serverProcess && !serverProcess.killed) {
      try {
        serverProcess.kill();
      } catch (_) {
        // ignore
      }
    }
  };

  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

async function ensureBundledLicenseServer() {
  const configuredUrl = getConfiguredServerUrl();
  if (configuredUrl) {
    return configuredUrl;
  }

  const serverScript = findBundledServerScript();
  if (!serverScript) {
    return '';
  }

  if (await probeUrl(`${DEFAULT_LOCAL_LICENSE_SERVER_URL}/api/health`)) {
    process.env.AMZ_LICENSE_SERVER_URL = DEFAULT_LOCAL_LICENSE_SERVER_URL;
    return DEFAULT_LOCAL_LICENSE_SERVER_URL;
  }

  registerCleanup();

  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: path.dirname(serverScript),
    env: {
      ...process.env,
      PORT: process.env.PORT || '8787'
    },
    stdio: 'ignore',
    windowsHide: true
  });

  const ready = await waitForServer(DEFAULT_LOCAL_LICENSE_SERVER_URL);
  if (!ready) {
    try {
      serverProcess.kill();
    } catch (_) {
      // ignore
    }
    serverProcess = null;
    return '';
  }

  process.env.AMZ_LICENSE_SERVER_URL = DEFAULT_LOCAL_LICENSE_SERVER_URL;
  return DEFAULT_LOCAL_LICENSE_SERVER_URL;
}

module.exports = {
  ensureBundledLicenseServer,
  findBundledServerScript,
  getConfiguredServerUrl
};
