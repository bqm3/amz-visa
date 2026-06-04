const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const windowManager = require('./util/windowManager'); // âœ… ADD IMPORT

const today = new Date();
const localYear = today.getFullYear();
const localMonth = String(today.getMonth() + 1).padStart(2, '0');
const localDay = String(today.getDate()).padStart(2, '0');
const formattedDate = `${localYear}-${localMonth}-${localDay}`; // Local date: YYYY-MM-DD
const dirSave = path.join(__dirname, "..", "output", formattedDate);
global.data.dirSave = dirSave;

const { QWidget, QLabel, QLineEdit, QPushButton, QTextEdit, QCheckBox, QBoxLayout } = require("@nodegui/nodegui");

function createMainWindow(centralWidget) {
    ensureExists(path.join(__dirname, "..", "output"));
    ensureExists(dirSave);

    centralWidget.setObjectName("mainContainer");
    centralWidget.setStyleSheet(`
        #mainContainer {
            background-color: #1e1e2e;
        }
        QLabel {
            color: #cdd6f4;
            font-weight: bold;
        }
        QWidget[class="card"] {
            background-color: #313244;
            border-radius: 8px;
            padding: 10px;
        }
        QWidget[class="section"] {
            margin-top: 10px;
            margin-bottom: 10px;
        }
        QLabel[class="section-title"] {
            color: #94e2d5;
            font-size: 16px;
            font-weight: bold;
            padding-bottom: 5px;
            border-bottom: 1px solid #585b70;
            margin-bottom: 10px;
        }
        QLabel[class="subsection-title"] {
            font-size: 14px;
            padding: 2px 0;
        }
        QLineEdit, QTextEdit {
            background-color: #242436;
            color: #cdd6f4;
            border: 1px solid #585b70;
            border-radius: 4px;
            padding: 6px;
            selection-background-color: #89b4fa;
            selection-color: #1e1e2e;
        }
        QLineEdit:focus, QTextEdit:focus {
            border: 1px solid #89b4fa;
        }
        QPushButton {
            background-color: #89b4fa;
            color: #1e1e2e;
            border-radius: 4px;
            padding: 8px 16px;
            font-weight: bold;
            border: none;
        }
        QPushButton:hover {
            background-color: #74c7ec;
        }
        QPushButton:pressed {
            background-color: #89dceb;
        }
        QCheckBox {
            color: #cdd6f4;
            spacing: 8px;
        }
        QCheckBox::indicator {
            width: 16px;
            height: 16px;
            border-radius: 3px;
            border: 1px solid #585b70;
        }
        QCheckBox::indicator:checked {
            background-color: #89b4fa;
            border: 1px solid #89b4fa;
        }
        QTextEdit[class="terminal"] {
            background-color: #11111b;
            color: #a6e3a1;
            font-family: 'Courier New';
            font-size: 14px;
            border-radius: 4px;
        }
        QTextEdit[class="card-live"] {
            background-color: #11111b;
            color: #a6e3a1;
            font-family: 'Courier New';
            font-size: 14px;
            border-radius: 4px;
        }
        QTextEdit[class="card-die"] {
            background-color: #11111b;
            color: #f38ba8;
            font-family: 'Courier New';
            font-size: 14px;
            border-radius: 4px;
        }
    `);

    // Create a root horizontal layout (left to right)
    const rootLayout = new QBoxLayout(0); // 0 = LeftToRight
    rootLayout.setContentsMargins(16, 16, 16, 16);
    rootLayout.setSpacing(16);
    centralWidget.setLayout(rootLayout);

    // LEFT SIDE: Container for cardLog and settings
    const leftContainer = new QWidget();
    leftContainer.setProperty("class", "card");
    const leftLayout = new QBoxLayout(2); // 2 = TopToBottom
    leftLayout.setContentsMargins(10, 10, 10, 10);
    leftLayout.setSpacing(16);
    leftContainer.setLayout(leftLayout);

    // cardLog Section
    const cardLogSection = new QWidget();
    cardLogSection.setProperty("class", "section");
    const cardLogLayout = new QBoxLayout(2); // TopToBottom
    cardLogLayout.setContentsMargins(0, 0, 0, 0);
    cardLogLayout.setSpacing(10);
    cardLogSection.setLayout(cardLogLayout);

    const cardLogTitle = new QLabel();
    cardLogTitle.setText("Card Information");
    cardLogTitle.setProperty("class", "section-title");

    const cardInfoContainer = new QWidget();
    const cardInfoLayout = new QBoxLayout(2); // TopToBottom
    cardInfoLayout.setContentsMargins(0, 0, 0, 0);
    cardInfoLayout.setSpacing(12);
    cardInfoContainer.setLayout(cardInfoLayout);

    // Live cards section
    const cardLiveContainer = new QWidget();
    const cardLiveLayout = new QBoxLayout(2); // TopToBottom
    cardLiveLayout.setContentsMargins(0, 0, 0, 0);
    cardLiveLayout.setSpacing(6);
    cardLiveContainer.setLayout(cardLiveLayout);

    const cardLiveTitle = new QLabel();
    cardLiveTitle.setText("Card Live");
    cardLiveTitle.setProperty("class", "subsection-title");
    cardLiveTitle.setStyleSheet("color: #a6e3a1; font-weight: bold;");
    
    const cardLogLive = new QTextEdit();
    cardLogLive.setReadOnly(true);
    cardLogLive.setProperty("class", "card-live");
    cardLogLive.setMinimumHeight(120);

    cardLiveLayout.addWidget(cardLiveTitle);
    cardLiveLayout.addWidget(cardLogLive, 1);

    // Die cards section
    const cardDieContainer = new QWidget();
    const cardDieLayout = new QBoxLayout(2); // TopToBottom
    cardDieLayout.setContentsMargins(0, 0, 0, 0);
    cardDieLayout.setSpacing(6);
    cardDieContainer.setLayout(cardDieLayout);

    const cardDieTitle = new QLabel();
    cardDieTitle.setText("Card Die");
    cardDieTitle.setProperty("class", "subsection-title");
    cardDieTitle.setStyleSheet("color: #f38ba8; font-weight: bold;");
    
    const cardLogDie = new QTextEdit();
    cardLogDie.setReadOnly(true);
    cardLogDie.setProperty("class", "card-die");
    cardLogDie.setMinimumHeight(120);

    cardDieLayout.addWidget(cardDieTitle);
    cardDieLayout.addWidget(cardLogDie, 1);

    cardInfoLayout.addWidget(cardLiveContainer, 1);
    cardInfoLayout.addWidget(cardDieContainer, 1);

    // Stats Section - Move to card information section
    const statsSection = new QWidget();
    const statsLayout = new QBoxLayout(0); // Horizontal layout
    statsLayout.setContentsMargins(0, 0, 0, 0);
    statsLayout.setSpacing(10);
    statsSection.setLayout(statsLayout);

    // Live count
    const liveStatsContainer = new QWidget();
    const liveStatsLayout = new QBoxLayout(2); // Vertical
    liveStatsLayout.setContentsMargins(0, 0, 0, 0);
    liveStatsLayout.setSpacing(3);
    liveStatsContainer.setLayout(liveStatsLayout);
    
    const liveStatsLabel = new QLabel();
    liveStatsLabel.setText("Live Cards");
    liveStatsLabel.setStyleSheet("color: #a6e3a1; font-weight: bold;");
    
    const liveStatsCount = new QLabel();
    liveStatsCount.setText("0");
    liveStatsCount.setStyleSheet(`
        color: #a6e3a1; 
        font-size: 14px; 
        font-weight: bold;
        padding: 3px 5px;
        background-color: #1e2030;
        border-radius: 4px;
    `);
    liveStatsCount.setAlignment(2); // AlignCenter
    
    liveStatsLayout.addWidget(liveStatsLabel);
    liveStatsLayout.addWidget(liveStatsCount);
    
    // Die count
    const dieStatsContainer = new QWidget();
    const dieStatsLayout = new QBoxLayout(2); // Vertical
    dieStatsLayout.setContentsMargins(0, 0, 0, 0);
    dieStatsLayout.setSpacing(3);
    dieStatsContainer.setLayout(dieStatsLayout);
    
    const dieStatsLabel = new QLabel();
    dieStatsLabel.setText("Die Cards");
    dieStatsLabel.setStyleSheet("color: #f38ba8; font-weight: bold;");
    
    const dieStatsCount = new QLabel();
    dieStatsCount.setText("0");
    dieStatsCount.setStyleSheet(`
        color: #f38ba8; 
        font-size: 14px; 
        font-weight: bold;
        padding: 3px 5px;
        background-color: #1e2030;
        border-radius: 4px;
    `);
    dieStatsCount.setAlignment(2); // AlignCenter
    
    dieStatsLayout.addWidget(dieStatsLabel);
    dieStatsLayout.addWidget(dieStatsCount);
    
    // Remaining count
    const remainingStatsContainer = new QWidget();
    const remainingStatsLayout = new QBoxLayout(2); // Vertical
    remainingStatsLayout.setContentsMargins(0, 0, 0, 0);
    remainingStatsLayout.setSpacing(3);
    remainingStatsContainer.setLayout(remainingStatsLayout);
    
    const remainingStatsLabel = new QLabel();
    remainingStatsLabel.setText("Remaining");
    remainingStatsLabel.setStyleSheet("color: #89b4fa; font-weight: bold;");
    
    const remainingStatsCount = new QLabel();
    remainingStatsCount.setText("0");
    remainingStatsCount.setStyleSheet(`
        color: #89b4fa; 
        font-size: 14px; 
        font-weight: bold;
        padding: 3px 5px;
        background-color: #1e2030;
        border-radius: 4px;
    `);
    remainingStatsCount.setAlignment(2); // AlignCenter
    
    remainingStatsLayout.addWidget(remainingStatsLabel);
    remainingStatsLayout.addWidget(remainingStatsCount);

    // Total count
    const totalStatsContainer = new QWidget();
    const totalStatsLayout = new QBoxLayout(2); // Vertical
    totalStatsLayout.setContentsMargins(0, 0, 0, 0);
    totalStatsLayout.setSpacing(3);
    totalStatsContainer.setLayout(totalStatsLayout);
    
    const totalStatsLabel = new QLabel();
    totalStatsLabel.setText("Total Cards");
    totalStatsLabel.setStyleSheet("color: #cdd6f4; font-weight: bold;");
    
    const totalStatsCount = new QLabel();
    totalStatsCount.setText("0");
    totalStatsCount.setStyleSheet(`
        color: #cdd6f4; 
        font-size: 14px; 
        font-weight: bold;
        padding: 3px 5px;
        background-color: #1e2030;
        border-radius: 4px;
    `);
    totalStatsCount.setAlignment(2); // AlignCenter
    
    totalStatsLayout.addWidget(totalStatsLabel);
    totalStatsLayout.addWidget(totalStatsCount);
    
    // Add to stats layout
    statsLayout.addWidget(liveStatsContainer, 1);
    statsLayout.addWidget(dieStatsContainer, 1);
    statsLayout.addWidget(remainingStatsContainer, 1);
    
    statsLayout.addWidget(totalStatsContainer, 1);

    // --- Action Row (Scan Card, Login buttons) ---
    const actionContainer = new QWidget();
    const actionLayout = new QBoxLayout(0); // LeftToRight
    actionLayout.setContentsMargins(0, 0, 0, 0);
    actionLayout.setSpacing(10);
    actionContainer.setLayout(actionLayout);

    const scanButton = new QPushButton();
    scanButton.setText("Scan Card");
    scanButton.setStyleSheet("background-color: #a6e3a1;");

    const normalLoginButton = new QPushButton();
    normalLoginButton.setText("Normal Login");
    normalLoginButton.setStyleSheet("background-color: #f9e2af;");

    const businessLoginButton = new QPushButton();
    businessLoginButton.setText("Business Login");
    businessLoginButton.setStyleSheet("background-color: #f9e2af;");

    const fileCardButton = new QPushButton();
    fileCardButton.setText("Open Cards File");

    actionLayout.addWidget(scanButton);
    actionLayout.addWidget(businessLoginButton);
    actionLayout.addWidget(normalLoginButton);
    actionLayout.addStretch(1);
    actionLayout.addWidget(fileCardButton);

    cardLogLayout.addWidget(cardLogTitle);
    cardLogLayout.addWidget(cardInfoContainer, 1);
    cardLogLayout.addWidget(statsSection); // Add stats section to card log layout
    cardLogLayout.addWidget(actionContainer);

    // Actions Section
    const settingsSection = new QWidget();
    settingsSection.setProperty("class", "section");
    const settingsLayout = new QBoxLayout(2); // TopToBottom
    settingsLayout.setContentsMargins(0, 0, 0, 0);
    settingsLayout.setSpacing(10);
    settingsSection.setLayout(settingsLayout);

    const settingsTitle = new QLabel();
    settingsTitle.setText("Actions");
    settingsTitle.setProperty("class", "section-title");

    const settingsButtonsContainer = new QWidget();
    const settingsButtonsLayout = new QBoxLayout(0); // LeftToRight
    settingsButtonsLayout.setContentsMargins(0, 0, 0, 0);
    settingsButtonsLayout.setSpacing(10);
    settingsButtonsContainer.setLayout(settingsButtonsLayout);

    const openFolderButton = new QPushButton();
    openFolderButton.setText("Open Output Folder");
    openFolderButton.setStyleSheet("background-color: #fab387;");

    settingsButtonsLayout.addWidget(openFolderButton);
    settingsButtonsLayout.addStretch(1);

    settingsLayout.addWidget(settingsTitle);
    settingsLayout.addWidget(settingsButtonsContainer);
    settingsLayout.addStretch(1);

    // Add to left layout
    leftLayout.addWidget(cardLogSection, 1);
    leftLayout.addWidget(settingsSection);    // RIGHT SIDE: Container for data files and terminal
    const rightContainer = new QWidget();
    rightContainer.setProperty("class", "card");
    const rightLayout = new QBoxLayout(2); // TopToBottom
    rightLayout.setContentsMargins(10, 10, 10, 10);
    rightLayout.setSpacing(16);
    rightContainer.setLayout(rightLayout);

    // Data Files Section
    const dataFilesSection = new QWidget();
    dataFilesSection.setProperty("class", "section");
    const dataFilesLayout = new QBoxLayout(2); // TopToBottom
    dataFilesLayout.setContentsMargins(0, 0, 0, 0);
    dataFilesLayout.setSpacing(10);
    dataFilesSection.setLayout(dataFilesLayout);

    const dataFilesTitle = new QLabel();
    dataFilesTitle.setText("Configuration");
    dataFilesTitle.setProperty("class", "section-title");
    dataFilesLayout.addWidget(dataFilesTitle);

    // Chrome instances input (user manually sets number)
    const chromeInputContainer = new QWidget();
    const chromeInputLayout = new QBoxLayout(0); // LeftToRight
    chromeInputLayout.setContentsMargins(0, 0, 0, 0);
    chromeInputLayout.setSpacing(10);
    chromeInputContainer.setLayout(chromeInputLayout);

    const chromeLabel = new QLabel();
    chromeLabel.setText("Number of Chrome:");
    
    const chromeCountInput = new QLineEdit();
    chromeCountInput.setText("1"); // Default 1 Chrome
    chromeCountInput.setFixedWidth(80);
    chromeCountInput.setToolTip("Number of Chrome instances to run in parallel (all Chrome share one sequential card queue)");

    chromeInputLayout.addWidget(chromeLabel);
    chromeInputLayout.addWidget(chromeCountInput);
    chromeInputLayout.addStretch(1);
    dataFilesLayout.addWidget(chromeInputContainer);

    // Check after (sec) setting
    const checkAfterSettingContainer = new QWidget();
    const checkAfterSettingLayout = new QBoxLayout(0); // LeftToRight
    checkAfterSettingLayout.setContentsMargins(0, 0, 0, 0);
    checkAfterSettingLayout.setSpacing(10);
    checkAfterSettingContainer.setLayout(checkAfterSettingLayout);

    const checkAfterLabel = new QLabel();
    checkAfterLabel.setText("Check after (sec):");
    
    const checkAfterInput = new QLineEdit();
    checkAfterInput.setText("10"); // Default value 10 seconds
    checkAfterInput.setFixedWidth(80);
    checkAfterInput.setToolTip("Wait time in seconds before checking wallet (minimum: 1s, recommended: 60s)");

    checkAfterSettingLayout.addWidget(checkAfterLabel);
    checkAfterSettingLayout.addWidget(checkAfterInput);
    checkAfterSettingLayout.addStretch(1);
    dataFilesLayout.addWidget(checkAfterSettingContainer);

    // Show Browser checkbox
    const showBrowserCheckbox = new QCheckBox();
    showBrowserCheckbox.setText("Show Browser");
    showBrowserCheckbox.setChecked(true);
    dataFilesLayout.addWidget(showBrowserCheckbox);

    const addAddressCheckbox = new QCheckBox();
    addAddressCheckbox.setText("Add Address");
    addAddressCheckbox.setChecked(false);
    addAddressCheckbox.setToolTip("Checked: add address before card flow. Unchecked: skip address.");
    dataFilesLayout.addWidget(addAddressCheckbox);

    // File buttons row
    const fileButtonsContainer = new QWidget();
    const fileButtonsLayout = new QBoxLayout(0); // LeftToRight
    fileButtonsLayout.setContentsMargins(0, 0, 0, 0);
    fileButtonsLayout.setSpacing(10);
    fileButtonsContainer.setLayout(fileButtonsLayout);

    const accButton = new QPushButton();
    accButton.setText("Accounts");

    const cardButton = new QPushButton();
    cardButton.setText("Cards");

    const proxyButton = new QPushButton();
    proxyButton.setText("Proxies");

    fileButtonsLayout.addWidget(accButton);
    fileButtonsLayout.addWidget(cardButton);
    fileButtonsLayout.addWidget(proxyButton);
    fileButtonsLayout.addStretch(1);
    dataFilesLayout.addWidget(fileButtonsContainer);

    // Apply button
    const applyConfigButton = new QPushButton();
    applyConfigButton.setText("Apply Config");
    applyConfigButton.setStyleSheet("background-color: #a6e3a1; color: #1e1e2e;");
    dataFilesLayout.addWidget(applyConfigButton);

    const configInfoLabel = new QLabel();
    configInfoLabel.setText("Chrome: 1 instance | Files: acc.txt, card.txt");
    configInfoLabel.setStyleSheet("color: #6c7086; font-size: 11px;");
    dataFilesLayout.addWidget(configInfoLabel);

    // Terminal Section
    const terminalSection = new QWidget();
    terminalSection.setProperty("class", "section");
    const terminalLayout = new QBoxLayout(2); // TopToBottom
    terminalLayout.setContentsMargins(0, 0, 0, 0);
    terminalLayout.setSpacing(10);
    terminalSection.setLayout(terminalLayout);

    const terminalTitle = new QLabel();
    terminalTitle.setText("Terminal");
    terminalTitle.setProperty("class", "section-title");

    const terminal = new QTextEdit();
    terminal.setReadOnly(true);
    terminal.setProperty("class", "terminal");
    terminal.setMinimumHeight(150);
    terminal.setText("Terminal ready. Waiting for card information...");

    // Helper functions to add text and auto-scroll
    const appendToTerminal = (text) => {
        terminal.setText(text);
        try {
            // Move cursor to the end to ensure scrolling to latest content
            terminal.moveCursor(100); // QTextCursor.End = 100
        } catch (e) {
            // Fallback if moveCursor doesn't work
            try {
                terminal.verticalScrollBar().setValue(
                    terminal.verticalScrollBar().maximum()
                );
            } catch (err) {
                // Ignore scrolling errors
            }
        }
    };
    
    const appendToCardLogLive = (text) => {
        cardLogLive.setText(text);
        try {
            // Move cursor to the end to ensure scrolling to latest content
            cardLogLive.moveCursor(100); // QTextCursor.End = 100
        } catch (e) {
            // Fallback if moveCursor doesn't work
            try {
                cardLogLive.verticalScrollBar().setValue(
                    cardLogLive.verticalScrollBar().maximum()
                );
            } catch (err) {
                // Ignore scrolling errors
            }
        }
    };
    
    const appendToCardLogDie = (text) => {
        cardLogDie.setText(text);
        try {
            // Move cursor to the end to ensure scrolling to latest content
            cardLogDie.moveCursor(100); // QTextCursor.End = 100
        } catch (e) {
            // Fallback if moveCursor doesn't work
            try {
                cardLogDie.verticalScrollBar().setValue(
                    cardLogDie.verticalScrollBar().maximum()
                );
            } catch (err) {
                // Ignore scrolling errors
            }
        }
    };

    terminalLayout.addWidget(terminalTitle);
    terminalLayout.addWidget(terminal, 1);    // Add sections to right layout
    rightLayout.addWidget(dataFilesSection);
    rightLayout.addWidget(terminalSection, 1);

    // Add left and right containers to main layout with equal stretch
    rootLayout.addWidget(leftContainer, 1);
    rootLayout.addWidget(rightContainer, 1);

    // Event handlers - Add process tracking flag
    let isProcessRunning = false;
    
    const disableButtons = (disabled) => {
        scanButton.setEnabled(!disabled);
        businessLoginButton.setEnabled(!disabled);
        normalLoginButton.setEnabled(!disabled);
        applyConfigButton.setEnabled(!disabled);
        fileCardButton.setEnabled(!disabled);
        accButton.setEnabled(!disabled);
        cardButton.setEnabled(!disabled);
        proxyButton.setEnabled(!disabled);
        openFolderButton.setEnabled(!disabled);
    };

    cardLiveTitle.addEventListener('clicked', () => {
        const cardLiveTitle = path.join(__dirname, "data", 'live.txt');

        exec(`notepad "${cardLiveTitle}"`, (err) => {
            if (err) {
                appendToTerminal(terminal.toPlainText() + "\nError opening live.txt: " + err.message);
            }
        });
    });

    cardDieTitle.addEventListener('clicked', () => {
        const cardDieTitle = path.join(__dirname, "data", 'die.txt');

        exec(`notepad "${cardDieTitle}"`, (err) => {
            if (err) {
                appendToTerminal(terminal.toPlainText() + "\nError opening die.txt: " + err.message);
            }
        });
    });    
    scanButton.addEventListener('clicked', async () => {
        if (isProcessRunning) {
            appendToTerminal(terminal.toPlainText() + "\n" + "⚠️ Another process is already running. Please wait...");
            return;
        }
        
        const value = parseInt(checkAfterInput.text());
        if (isNaN(value) || value < 1) {
            checkAfterInput.setText("60");
        }
        global.data.settings.checkAfter = Math.max(value, 1) * 1000;
        global.data.settings.showBrowser = showBrowserCheckbox.isChecked();
        global.data.settings.addAddress = addAddressCheckbox.isChecked();
        
        isProcessRunning = true;
        disableButtons(true);
        global.data.settings.showBrowser = showBrowserCheckbox.isChecked();
        global.data.settings.addAddress = addAddressCheckbox.isChecked();
        
        // âœ… RESET WINDOW POSITIONS BEFORE STARTING
        windowManager.reset();
        
        appendToTerminal(terminal.toPlainText() + "\n" + `ðŸªŸ Window grid initialized for card scanning...`);
        appendToTerminal(terminal.toPlainText() + "\n" + `ðŸ"Š Scanning ${global.data.cardTotal || 0} cards with ${Math.max(value, 1)}s delay...`);
        
        try {
            await require(path.join(__dirname, "util", "checkCard.js"))();
            appendToTerminal(terminal.toPlainText() + "\n" + "✅ Card scan completed!");
        } catch (error) {
            console.error("Error during card scan:", error);
            appendToTerminal(terminal.toPlainText() + "\n" + "Error during card scan: " + error.message);
        } finally {
            isProcessRunning = false;
            disableButtons(false);
        }
    });

    normalLoginButton.addEventListener('clicked', async () => {
        if (isProcessRunning) {
            appendToTerminal(terminal.toPlainText() + "\n" + "⚠️ Another process is already running. Please wait...");
            return;
        }
        
        isProcessRunning = true;
        disableButtons(true);
        global.data.settings.showBrowser = showBrowserCheckbox.isChecked();
        global.data.settings.addAddress = addAddressCheckbox.isChecked();
        
        // âœ… RESET WINDOW POSITIONS BEFORE STARTING
        windowManager.reset();
        
        appendToTerminal(terminal.toPlainText() + "\n" + "ðŸªŸ Window grid initialized for normal login...");
        appendToTerminal(terminal.toPlainText() + "\n" + "ðŸš€ Starting Normal Login Process...");
        
        try {
            // â­ LOAD AND SHOW STATISTICS BEFORE PROCESSING
            const accPath = path.join(__dirname, "data", 'acc.txt');
            
            if (!fs.existsSync(accPath)) {
                appendToTerminal(terminal.toPlainText() + "\n" + "âŒ Account file not found: " + accPath);
                isProcessRunning = false;
                disableButtons(false);
                return;
            }

            await require(path.join(__dirname, "util", "updateNormal.js"))();
            appendToTerminal(terminal.toPlainText() + "\n" + "âœ… Normal login process completed!");
            
        } catch (error) {
            console.error("Error during normal login:", error);
            appendToTerminal(terminal.toPlainText() + "\n" + "âŒ Error during normal login: " + error.message);
        } finally {
            isProcessRunning = false;
            disableButtons(false);
        }
    });

    businessLoginButton.addEventListener('clicked', async () => {
        if (isProcessRunning) {
            appendToTerminal(terminal.toPlainText() + "\n" + "⚠️ Another process is already running. Please wait...");
            return;
        }
        
        isProcessRunning = true;
        disableButtons(true);
        
        // âœ… RESET WINDOW POSITIONS BEFORE STARTING
        windowManager.reset();
        
        appendToTerminal(terminal.toPlainText() + "\n" + "ðŸªŸ Window grid initialized for business login...");
        appendToTerminal(terminal.toPlainText() + "\n" + "ðŸš€ Starting Business Login Process...");
        
        try {
            // â­ LOAD AND SHOW STATISTICS BEFORE PROCESSING
            const accPath = path.join(__dirname, "data", 'acc.txt');
            
            if (!fs.existsSync(accPath)) {
                appendToTerminal(terminal.toPlainText() + "\n" + "âŒ Account file not found: " + accPath);
                isProcessRunning = false;
                disableButtons(false);
                return;
            }

            await require(path.join(__dirname, "util", "updateBusiness.js"))();
            appendToTerminal(terminal.toPlainText() + "\n" + "âœ… Business login process completed!");
            
        } catch (error) {
            console.error("Error during business login:", error);
            appendToTerminal(terminal.toPlainText() + "\n" + "âŒ Error during business login: " + error.message);
        } finally {
            isProcessRunning = false;
            disableButtons(false);
        }
    });

    fileCardButton.addEventListener('clicked', () => {
        const childFilePath = path.join(__dirname, "data", 'card.txt');

        exec(`notepad "${childFilePath}"`, (err) => {
            if (err) {
                appendToTerminal(terminal.toPlainText() + "\nError opening card.txt: " + err.message);
            }
        });
    });

    accButton.addEventListener('clicked', () => {
        const accFilePath = path.join(__dirname, "data", 'acc.txt');
        exec(`notepad "${accFilePath}"`, (err) => {
            if (err) {
                appendToTerminal(terminal.toPlainText() + "\n❌ Error opening acc.txt: " + err.message);
            }
        });
    });

    cardButton.addEventListener('clicked', () => {
        const cardFilePath = path.join(__dirname, "data", 'card.txt');
        exec(`notepad "${cardFilePath}"`, (err) => {
            if (err) {
                appendToTerminal(terminal.toPlainText() + "\n❌ Error opening card.txt: " + err.message);
            }
        });
    });

    applyConfigButton.addEventListener('clicked', () => {
        // Validate files exist
        const accPath = path.join(__dirname, "data", 'acc.txt');
        const cardPath = path.join(__dirname, "data", 'card.txt');

        if (!fs.existsSync(accPath)) {
            appendToTerminal(terminal.toPlainText() + "\n❌ acc.txt not found. Please create the file.");
            return;
        }
        if (!fs.existsSync(cardPath)) {
            appendToTerminal(terminal.toPlainText() + "\n❌ card.txt not found. Please create the file.");
            return;
        }

        // Read file counts for display
        try {
            const accounts = fs.readFileSync(accPath, 'utf8')
                .replaceAll('\r', '').split('\n')
                .map(l => l.trim()).filter(l => l.length > 0);
            const cards = fs.readFileSync(cardPath, 'utf8')
                .replaceAll('\r', '').split('\n')
                .map(l => l.trim()).filter(l => l.length > 0);

            // Get user-inputted Chrome count
            let numChrome = Math.max(1, parseInt(chromeCountInput.text()) || 1);

            if (numChrome > accounts.length) {
                appendToTerminal(terminal.toPlainText() + `\n⚠️ Warning: ${numChrome} Chrome nhưng chỉ có ${accounts.length} account!`);
                appendToTerminal(terminal.toPlainText() + `\n⚠️ Mỗi Chrome cần 1 account riêng để login. Tự động giảm xuống ${accounts.length} Chrome.`);
                numChrome = accounts.length;
                chromeCountInput.setText(String(numChrome));
            }

            // ✅ STORE ACTUAL ACCOUNTS AND CARDS IN global.uiConfig
            global.uiConfig = {
                numChrome: numChrome,
                accounts: accounts,
                cards: cards,
                source: 'file'
            };

            // ✅ SAVE SETTINGS: Check after, Show Browser, and Add Address
            const checkAfterValue = parseInt(checkAfterInput.text());
            const showBrowser = showBrowserCheckbox.isChecked();
            const addAddress = addAddressCheckbox.isChecked();
            
            global.data.settings.checkAfter = Math.max(checkAfterValue, 1) * 1000;
            global.data.settings.showBrowser = showBrowser;
            global.data.settings.addAddress = addAddress;

            // Update card total in UI
            global.data.cardTotal = cards.length;
            if (console.card && typeof console.card.setTotal === 'function') {
                console.card.setTotal(cards.length);
            }

            configInfoLabel.setText(`✅ ${accounts.length} acc(s), ${cards.length} card(s), ${numChrome} Chrome`);
            configInfoLabel.setStyleSheet("color: #a6e3a1; font-size: 11px;");
            appendToTerminal(terminal.toPlainText() + `\n✅ Config applied: ${accounts.length} account(s), ${cards.length} card(s), ${numChrome} Chrome instance(s)`);
            appendToTerminal(terminal.toPlainText() + `\n⚙️ Settings: Check after ${checkAfterValue}s, Show browser: ${showBrowser ? 'Yes' : 'No'}, Add address: ${addAddress ? 'Yes' : 'No'}`);

            appendToTerminal(terminal.toPlainText() + `\n📊 Card queue: shared sequential queue, one claimed card per account turn`);
            appendToTerminal(terminal.toPlainText() + `\n🔄 Account rotation: ${accounts.length} account(s) in queue, auto-switch on lock`);
        } catch (err) {
            appendToTerminal(terminal.toPlainText() + `\n❌ Error reading files: ${err.message}`);
        }
    });

    proxyButton.addEventListener('clicked', () => {
        const childFilePath = path.join(__dirname, "data", 'proxies.txt');

        exec(`notepad "${childFilePath}"`, (err) => {
            if (err) {
                appendToTerminal(terminal.toPlainText() + "\nError opening proxies.txt: " + err.message);
            }
        });
    });

    openFolderButton.addEventListener('clicked', () => {
        exec(`start "" "${dirSave}"`, (err) => {
            if (err) {
                appendToTerminal(terminal.toPlainText() + "\nError opening folder: " + err.message);
            }
        });
    });

    console.app = (...msg) => {
        appendToTerminal(terminal.toPlainText() + "\n" + msg.join(" "));
    }
    console.card = {
        live: (msg) => {
            ensureExists(dirSave);
            
            msg = `[${formattedDate}] ${msg}`;
            appendToCardLogLive(cardLogLive.toPlainText() + "\n" + msg);
            const liveFilePath = path.join(dirSave, "live.txt");
            fs.appendFile(liveFilePath, msg + "\n", (err) => {
                if (err) {
                    console.error("Error writing to live.txt:", err);
                }
            });
            
            // Update counters
            const currentLive = parseInt(liveStatsCount.text()) + 1;
            liveStatsCount.setText(currentLive.toString());
            updateRemainingCount();
        },
        die: (msg) => {
            ensureExists(dirSave);
            
            appendToCardLogDie(cardLogDie.toPlainText() + "\n" + msg);
            const dieFilePath = path.join(dirSave, "die.txt");
            fs.appendFile(dieFilePath, msg + "\n", (err) => {
                if (err) {
                    console.error("Error writing to die.txt:", err);
                }
            });
            
            // Update counters
            const currentDie = parseInt(dieStatsCount.text()) + 1;
            dieStatsCount.setText(currentDie.toString());
            updateRemainingCount();
        },
        setTotal: (count) => {
            totalStatsCount.setText(count.toString());
            remainingStatsCount.setText(count.toString());
            global.data.cardTotal = count;
            updateRemainingCount();
        },
        setRemaining: (count) => {
            remainingStatsCount.setText(count.toString());
        }
    }
    
    // Helper function to update the remaining count
    function updateRemainingCount() {
        // If we have a known total, we can calculate remaining
        if (global.data.cardTotal) {
            const totalLive = parseInt(liveStatsCount.text()) || 0;
            const totalDie = parseInt(dieStatsCount.text()) || 0;
            const totalRemaining = Math.max(0, global.data.cardTotal - (totalLive + totalDie));
            remainingStatsCount.setText(totalRemaining.toString());
        }
    }
    
    // Set initial values if available
    if (global.data.cardTotal) {
        totalStatsCount.setText(global.data.cardTotal.toString());
        updateRemainingCount();
    }
}

function ensureExists(path, mask) {
    if (typeof mask != 'number') {
        mask = 0o777;
    }
    try {
        fs.mkdirSync(path, {
            mode: mask,
            recursive: true
        });
        return;
    } catch (ex) {
        return {
            err: ex
        };
    }
}

module.exports = createMainWindow;
