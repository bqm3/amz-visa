const { QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit, QTextEdit, QPushButton, QSpinBox, QCheckBox } = require("@nodegui/nodegui");

function createConfigDialog() {
    const dialog = new QDialog();
    dialog.setWindowTitle("Multi-Chrome Configuration");
    dialog.resize(700, 600);

    const mainLayout = new QVBoxLayout();
    mainLayout.setSpacing(15);
    mainLayout.setContentsMargins(15, 15, 15, 15);

    // Chrome Configuration Section
    const chromeLabel = new QLabel();
    chromeLabel.setText("Chrome Configuration");
    chromeLabel.setStyleSheet("color: #94e2d5; font-size: 14px; font-weight: bold;");

    const chromeContainer = new QVBoxLayout();
    chromeContainer.setSpacing(10);

    // Number of Chrome instances
    const numChromeLayout = new QHBoxLayout();
    const numChromeLabel = new QLabel();
    numChromeLabel.setText("Number of Chrome Instances:");
    const numChromeInput = new QSpinBox();
    numChromeInput.setMinimum(1);
    numChromeInput.setMaximum(50);
    numChromeInput.setValue(10);
    numChromeLayout.addWidget(numChromeLabel);
    numChromeLayout.addWidget(numChromeInput);
    numChromeLayout.addStretch();

    chromeContainer.addLayout(numChromeLayout);
    mainLayout.addWidget(chromeLabel);
    mainLayout.addLayout(chromeContainer);

    // Accounts Section
    const accLabel = new QLabel();
    accLabel.setText("Accounts (email|password|2FA_secret|2FA_code)");
    accLabel.setStyleSheet("color: #94e2d5; font-size: 14px; font-weight: bold;");
    mainLayout.addWidget(accLabel);

    const accTextEdit = new QTextEdit();
    accTextEdit.setPlaceholderText("Enter one account per line:\nemail@example.com|password|secret|code");
    accTextEdit.setMinimumHeight(120);
    accTextEdit.setStyleSheet(`
        QTextEdit {
            background-color: #242436;
            color: #cdd6f4;
            border: 1px solid #585b70;
            border-radius: 4px;
            padding: 6px;
            font-family: 'Courier New';
        }
    `);
    mainLayout.addWidget(accTextEdit);

    // Cards Section
    const cardLabel = new QLabel();
    cardLabel.setText("Cards (number|month|year|cvv|cardholder_name)");
    cardLabel.setStyleSheet("color: #94e2d5; font-size: 14px; font-weight: bold;");
    mainLayout.addWidget(cardLabel);

    const cardTextEdit = new QTextEdit();
    cardTextEdit.setPlaceholderText("Enter one card per line:\n4482330146024500|02|27|104|Jafet J Macias");
    cardTextEdit.setMinimumHeight(120);
    cardTextEdit.setStyleSheet(`
        QTextEdit {
            background-color: #242436;
            color: #cdd6f4;
            border: 1px solid #585b70;
            border-radius: 4px;
            padding: 6px;
            font-family: 'Courier New';
        }
    `);
    mainLayout.addWidget(cardTextEdit);

    // Buttons
    const buttonLayout = new QHBoxLayout();
    buttonLayout.setSpacing(10);

    const okButton = new QPushButton();
    okButton.setText("OK");
    okButton.setStyleSheet("background-color: #89b4fa;");

    const cancelButton = new QPushButton();
    cancelButton.setText("Cancel");
    cancelButton.setStyleSheet("background-color: #585b70;");

    buttonLayout.addStretch();
    buttonLayout.addWidget(okButton);
    buttonLayout.addWidget(cancelButton);

    mainLayout.addLayout(buttonLayout);
    dialog.setLayout(mainLayout);

    return {
        dialog,
        getConfig: () => ({
            numChrome: numChromeInput.value(),
            accounts: accTextEdit.toPlainText().trim().split('\n').filter(line => line.trim()),
            cards: cardTextEdit.toPlainText().trim().split('\n').filter(line => line.trim())
        }),
        setConfig: (config) => {
            if (config.numChrome) numChromeInput.setValue(config.numChrome);
            if (config.accounts) accTextEdit.setText(config.accounts.join('\n'));
            if (config.cards) cardTextEdit.setText(config.cards.join('\n'));
        },
        okButton,
        cancelButton
    };
}

module.exports = createConfigDialog;