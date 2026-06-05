const fs = require('fs');
const path = require('path');

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnvFile(path.join(__dirname, '.env'));
loadDotEnvFile(path.join(__dirname, '.env.local'));

const { QMainWindow, QWidget, QApplication, QIcon } = require("@nodegui/nodegui");
const {
  activateLicense,
  decodePayload,
  ensureLicense,
  readStoredLicense
} = require('./src/util/licenseManager');
const createLicenseDialog = require('./src/ui/licenseDialog');

function setupTimestampedLogging() {
  let lastTs = Date.now();
  const methods = ["log", "info", "warn", "error", "debug"];
  const original = {};

  const buildPrefix = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    const nowTs = Date.now();
    const delta = ((nowTs - lastTs) / 1000).toFixed(3);
    lastTs = nowTs;
    return `[${hh}:${mm}:${ss}.${ms} +${delta}s]`;
  };

  for (const m of methods) {
    original[m] = console[m].bind(console);
    console[m] = (...args) => {
      original[m](buildPrefix(), ...args);
    };
  }

  let appFn = null;
  Object.defineProperty(console, "app", {
    configurable: true,
    enumerable: true,
    get() {
      return appFn;
    },
    set(fn) {
      if (typeof fn !== "function") {
        appFn = fn;
        return;
      }
      appFn = (...args) => {
        original.log(buildPrefix(), ...args);
        try {
          return fn(...args);
        } catch (_) {
          return undefined;
        }
      };
    }
  });
}

setupTimestampedLogging();

// Global values
global.data = {};
global.data.parentAcc = []; // hoặc {}
global.data.settings = {
  debug: false,
  showBrowser: true,
  addAddress: false
};
global.data.browser = {};

async function bootstrap() {
  const app = QApplication.instance();
  app.setQuitOnLastWindowClosed(true);

  const storedLicense = await ensureLicense();
  let activeLicense = storedLicense || null;
  if (!storedLicense) {
    const licensePromise = createLicenseDialog();
    const activated = await licensePromise;
    if (!activated) {
      process.exit(1);
      return;
    }
    activeLicense = activated;
  }

  const win = new QMainWindow();
  win.setWindowTitle("AmzUS Application");
  win.resize(900, 700);

  const appIcon = new QIcon(path.join(__dirname, "src", "assets", "app-icon.png"));
  win.setWindowIcon(appIcon);

  const centralWidget = new QWidget();
  require(path.join(__dirname, "src", "index.js"))(centralWidget);

  win.setCentralWidget(centralWidget);
  win.show();

  let currentLicensePayload = activeLicense;
  let renewalInProgress = false;
  let licenseDialogOpen = false;
  const MAX_TIMER_DELAY_MS = 0x7fffffff;

  const scheduleLicenseTimers = (licensePayload) => {
    const expiresAt = Number(licensePayload?.expiresAt || 0);
    const codeId = String(licensePayload?.codeId || '').trim();
    if (!expiresAt || !codeId) return;

    if (global.__amzLicenseExpiryTimer) {
      clearTimeout(global.__amzLicenseExpiryTimer);
    }
    if (global.__amzLicenseHeartbeatTimer) {
      clearInterval(global.__amzLicenseHeartbeatTimer);
    }

    const armExpiryTimer = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        void promptLicenseRenewal();
        return;
      }

      const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);
      global.__amzLicenseExpiryTimer = setTimeout(() => {
        armExpiryTimer();
      }, delay);
    };

    const refreshFromServer = async () => {
      try {
        const refreshed = await activateLicense(codeId);
        if (refreshed?.expiresAt) {
          licensePayload.expiresAt = refreshed.expiresAt;
          currentLicensePayload = {
            ...currentLicensePayload,
            expiresAt: refreshed.expiresAt
          };
        }
        armExpiryTimer();
      } catch (error) {
        if (/License da het han/i.test(error.message || '')) {
          void promptLicenseRenewal();
          return;
        }
        console.error(`Không thể kiểm tra license định kỳ: ${error.message}`);
      }
    };

    armExpiryTimer();
    global.__amzLicenseHeartbeatTimer = setInterval(refreshFromServer, 60 * 1000);
    global.__amzLicenseRefreshNow = refreshFromServer;
  };

  const promptLicenseRenewal = async () => {
    if (renewalInProgress || licenseDialogOpen) return;

    renewalInProgress = true;
    licenseDialogOpen = true;
    try {
      if (win && typeof win.hide === 'function') {
        win.hide();
      }
      if (global.__amzLicenseExpiryTimer) {
        clearTimeout(global.__amzLicenseExpiryTimer);
        global.__amzLicenseExpiryTimer = null;
      }
      if (global.__amzLicenseHeartbeatTimer) {
        clearInterval(global.__amzLicenseHeartbeatTimer);
        global.__amzLicenseHeartbeatTimer = null;
      }

      const renewedLicense = await createLicenseDialog();
      if (!renewedLicense) {
        process.exit(1);
        return;
      }

      currentLicensePayload = renewedLicense;
      scheduleLicenseTimers(renewedLicense);
      if (win && typeof win.show === 'function') {
        win.show();
        if (typeof win.raise === 'function') {
          win.raise();
        }
        if (typeof win.activateWindow === 'function') {
          win.activateWindow();
        }
      }
    } finally {
      licenseDialogOpen = false;
      renewalInProgress = false;
    }
  };

  const activeBundle = readStoredLicense();
  const activePayload = decodePayload(activeBundle) || currentLicensePayload;
  if (activePayload) {
    scheduleLicenseTimers(activePayload);
  }

  global.win = win;
}

bootstrap().catch((error) => {
  console.error("Khởi động ứng dụng thất bại:", error);
  process.exit(1);
});
