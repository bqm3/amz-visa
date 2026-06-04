const { QDialog, QBoxLayout, QLabel, QLineEdit, QTextEdit, QPushButton } = require('@nodegui/nodegui');
const { activateLicense, getMachineFingerprint, getLicenseServerUrl } = require('../util/licenseManager');

function createLicenseDialog() {
  const dialog = new QDialog();
  dialog.setWindowTitle('Kich hoat phan mem');
  dialog.resize(560, 360);
  dialog.setModal(true);

  const layout = new QBoxLayout(2);
  layout.setContentsMargins(16, 16, 16, 16);
  layout.setSpacing(12);

  const title = new QLabel();
  title.setText('Nhap ma kich hoat');
  title.setStyleSheet('font-size: 18px; font-weight: bold; color: #cdd6f4;');

  const hint = new QLabel();
  hint.setText('Ma chi dung 1 lan va se duoc gan vao dung may nay.');
  hint.setStyleSheet('color: #94e2d5;');

  const machineLabel = new QLabel();
  machineLabel.setText(`Machine ID: ${getMachineFingerprint().slice(0, 16)}...`);
  machineLabel.setStyleSheet('color: #fab387; font-size: 11px;');

  const serverLabel = new QLabel();
  const serverUrl = getLicenseServerUrl();
  serverLabel.setText(serverUrl ? `License server: ${serverUrl}` : 'License server: chua cau hinh');
  serverLabel.setStyleSheet('color: #a6e3a1; font-size: 11px;');

  const codeInput = new QLineEdit();
  codeInput.setPlaceholderText('Vi du: 123Abc');
  codeInput.setText('');

  const status = new QTextEdit();
  status.setReadOnly(true);
  status.setMinimumHeight(120);
  status.setText('Nhap ma va bam Kich hoat.');

  const buttonRow = new QBoxLayout(0);
  buttonRow.setSpacing(10);

  const activateButton = new QPushButton();
  activateButton.setText('Kich hoat');
  activateButton.setStyleSheet('background-color: #a6e3a1; color: #1e1e2e; font-weight: bold;');

  const closeButton = new QPushButton();
  closeButton.setText('Thoat');
  closeButton.setStyleSheet('background-color: #585b70; color: #cdd6f4;');

  buttonRow.addStretch(1);
  buttonRow.addWidget(activateButton);
  buttonRow.addWidget(closeButton);

  layout.addWidget(title);
  layout.addWidget(hint);
  layout.addWidget(machineLabel);
  layout.addWidget(serverLabel);
  layout.addWidget(codeInput);
  layout.addWidget(status, 1);
  layout.addLayout(buttonRow);
  dialog.setLayout(layout);

  let done = false;

  const finish = (payload, error) => {
    if (done) return;
    done = true;
    dialog.hide();
    global.__amzLicenseDialog = null;
    if (error) {
      error.statusText = status.toPlainText();
    }
    dialog._licenseResolve(payload);
  };

  activateButton.addEventListener('clicked', async () => {
    const code = String(codeInput.text() || '').trim();
    if (!code) {
      status.setText('Hay nhap ma kich hoat.');
      return;
    }

    activateButton.setEnabled(false);
    closeButton.setEnabled(false);
    status.setText('Dang kiem tra va kich hoat...');

    try {
      const license = await activateLicense(code);
      status.setText(`Kich hoat thanh cong. Het han luc: ${new Date(license.expiresAt).toLocaleString()}`);
      finish(license, null);
    } catch (error) {
      status.setText(`Khong kich hoat duoc: ${error.message}`);
      activateButton.setEnabled(true);
      closeButton.setEnabled(true);
    }
  });

  closeButton.addEventListener('clicked', () => {
    finish(null, new Error('USER_CANCELLED'));
  });

  dialog.addEventListener('rejected', () => {
    finish(null, new Error('USER_CANCELLED'));
  });

  return new Promise((resolve) => {
    dialog._licenseResolve = resolve;
    global.__amzLicenseDialog = dialog;
    dialog.show();
  });
}

module.exports = createLicenseDialog;
