const path = require('path');
const { QMainWindow, QWidget, QApplication, QIcon } = require("@nodegui/nodegui");
const { ensureLicense } = require('./src/util/licenseManager');
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
  if (!storedLicense) {
    const licensePromise = createLicenseDialog();
    const activated = await licensePromise;
    if (!activated) {
      process.exit(1);
      return;
    }
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

  global.win = win;
}

bootstrap().catch((error) => {
  console.error("Application bootstrap failed:", error);
  process.exit(1);
});
