const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const { QMainWindow, QWidget, QLabel, QLineEdit, QPushButton, QTextEdit, 
        QCheckBox, QBoxLayout, QApplication, QIcon } = require("@nodegui/nodegui");

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