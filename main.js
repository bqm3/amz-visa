const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const { QMainWindow, QWidget, QLabel, QLineEdit, QPushButton, QTextEdit, 
        QCheckBox, QBoxLayout, QApplication, QIcon } = require("@nodegui/nodegui");

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
  showBrowser: true
};
global.data.browser = {};

// Initialize application
const app = QApplication.instance();
app.setQuitOnLastWindowClosed(true);
const win = new QMainWindow();
win.setWindowTitle("AmzUS Application");
win.resize(900, 700);

// Set application icon
const appIcon = new QIcon(path.join(__dirname, "src", "assets", "app-icon.png"));
win.setWindowIcon(appIcon);

// Create main widget with black background
const centralWidget = new QWidget();

require(path.join(__dirname, "src", "index.js"))(centralWidget);

// Set the central widget and show
win.setCentralWidget(centralWidget);
win.show();

// Start the event loop
global.win = win;
// app.exec();
