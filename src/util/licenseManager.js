const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const axios = require('axios');

const APP_ID = 'amz-us-app';
const LICENSE_FILE_NAME = 'license.json';
const MACHINE_ID_FILE_NAME = 'machine-id.txt';

function getLicenseDir() {
  const baseDir =
    process.env.APPDATA ||
    (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming') : os.homedir());

  return path.join(baseDir, 'AmzUS');
}

function getLicensePath() {
  return path.join(getLicenseDir(), LICENSE_FILE_NAME);
}

function getMachineFingerprint() {
  const machineIdPath = path.join(getLicenseDir(), MACHINE_ID_FILE_NAME);

  // Đọc file cache trước
  try {
    if (fs.existsSync(machineIdPath)) {
      const existing = String(fs.readFileSync(machineIdPath, 'utf8')).trim();
      if (existing) return existing;
    }
  } catch (e) {}

  let generated = '';

  if (process.platform === 'win32') {
    // 1. Windows: MachineGuid từ Registry (ổn định nhất)
    try {
      const output = execSync(
        'reg query HKLM\\Software\\Microsoft\\Cryptography /v MachineGuid',
        { encoding: 'utf8', timeout: 3000 }
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/);
      if (match?.[1]) generated = match[1].trim();
    } catch (e) {}

    // 2. Fallback: Motherboard serial
    if (!generated) {
      try {
        const out = execSync('wmic baseboard get serialnumber', { encoding: 'utf8', timeout: 3000 });
        const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines[1]) generated = lines[1];
      } catch (e) {}
    }

  } else if (process.platform === 'linux') {
    // Linux: /etc/machine-id (ổn định, không đổi khi xóa app)
    try {
      generated = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    } catch (e) {}

    // Fallback: DMI product UUID
    if (!generated) {
      try {
        generated = execSync('cat /sys/class/dmi/id/product_uuid', { encoding: 'utf8', timeout: 3000 }).trim();
      } catch (e) {}
    }

  } else if (process.platform === 'darwin') {
    // macOS: Hardware UUID
    try {
      const out = execSync(
        "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/{print $NF}'",
        { encoding: 'utf8', timeout: 3000 }
      );
      generated = out.trim().replace(/"/g, '');
    } catch (e) {}
  }

  // Cuối cùng mới random (tránh dùng nếu có thể)
  if (!generated) {
    console.warn('Không lấy được hardware ID, dùng random UUID (không ổn định)');
    generated = crypto.randomUUID();
  }

  // Hash lại để chuẩn hóa độ dài và ẩn thông tin gốc
  generated = crypto.createHash('sha256').update(generated).digest('hex');

  try {
    ensureLicenseDir();
    fs.writeFileSync(machineIdPath, generated, 'utf8');
  } catch (e) {}

  return generated;
}

function getLicenseServerUrl() {
  return String(
    process.env.AMZ_LICENSE_SERVER_URL ||
      process.env.LICENSE_SERVER_URL ||
      ''
  ).trim().replace(/\/+$/, '');
}

function normalizeServerBaseUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  return raw.replace(/\/api$/, '');
}

function buildApiUrl(serverUrl, endpoint) {
  const base = normalizeServerBaseUrl(serverUrl);
  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  return `${base}/api/${cleanEndpoint}`;
}

async function fetchPublicKeyPem(serverUrl) {
  const baseUrl = normalizeServerBaseUrl(serverUrl || getLicenseServerUrl());
  if (!baseUrl) return '';

  try {
    const url = buildApiUrl(baseUrl, 'public-key');
    const response = await axios.get(url, { timeout: 15000 });
    const body = response.data || {};
    const key = String(body.publicKey || body.key || '').trim();
    return key;
  } catch (error) {
    console.error('fetchPublicKeyPem failed:', {
      url: buildApiUrl(baseUrl, 'public-key'),
      message: error?.message || String(error),
      status: error?.response?.status,
      data: error?.response?.data
    });
    return '';
  }
}

function ensureLicenseDir() {
  fs.mkdirSync(getLicenseDir(), { recursive: true });
}

function readStoredLicense() {
  try {
    const licensePath = getLicensePath();
    if (!fs.existsSync(licensePath)) return null;
    return JSON.parse(fs.readFileSync(licensePath, 'utf8'));
  } catch (error) {
    console.log(`Không thể đọc license đã lưu: ${error.message}`);
    return null;
  }
}

function saveStoredLicense(bundle) {
  ensureLicenseDir();
  fs.writeFileSync(getLicensePath(), JSON.stringify(bundle, null, 2), 'utf8');
}

function clearStoredLicense() {
  try {
    const licensePath = getLicensePath();
    if (fs.existsSync(licensePath)) fs.unlinkSync(licensePath);
  } catch (error) {
    console.log(`Không thể xóa license đã lưu: ${error.message}`);
  }
}

function decodePayload(bundle) {
  if (!bundle || !bundle.payloadB64) return null;
  try {
    const payloadJson = Buffer.from(bundle.payloadB64, 'base64').toString('utf8');
    return JSON.parse(payloadJson);
  } catch (error) {
    return null;
  }
}

function verifyBundleSignature(bundle, publicKeyPem) {
  if (!bundle || !bundle.payloadB64 || !bundle.signatureB64 || !publicKeyPem) {
    return false;
  }

  try {
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(bundle.payloadB64, 'utf8');
    verify.end();
    return verify.verify(publicKeyPem, Buffer.from(bundle.signatureB64, 'base64'));
  } catch (error) {
    return false;
  }
}

function validateStoredLicenseWithKey(bundle, publicKeyPem) {
  const payload = decodePayload(bundle);
  const now = Date.now();

  if (!bundle || !payload) {
    return { valid: false, reason: 'LICENSE_DATA_INVALID' };
  }

  if (!publicKeyPem) {
    return { valid: false, reason: 'PUBLIC_KEY_MISSING' };
  }

  if (!verifyBundleSignature(bundle, publicKeyPem)) {
    return { valid: false, reason: 'LICENSE_SIGNATURE_INVALID' };
  }

  if (payload.appId !== APP_ID) {
    return { valid: false, reason: 'LICENSE_APP_MISMATCH' };
  }

  if (payload.machineId !== getMachineFingerprint()) {
    return { valid: false, reason: 'LICENSE_MACHINE_MISMATCH' };
  }

  if (!payload.expiresAt || Number(payload.expiresAt) <= now) {
    return { valid: false, reason: 'LICENSE_EXPIRED' };
  }

  if (payload.issuedAt && Number(payload.issuedAt) - now > 10 * 60 * 1000) {
    return { valid: false, reason: 'LICENSE_CLOCK_SKEW' };
  }

  return { valid: true, payload };
}

function validateStoredLicense(bundle) {
  return { valid: false, reason: 'USE_API_PUBLIC_KEY' };
}

async function activateLicense(code) {
  const serverUrl = getLicenseServerUrl();
  if (!serverUrl) {
    throw new Error('Chua cau hinh AMZ_LICENSE_SERVER_URL.');
  }

  const publicKeyPem = await fetchPublicKeyPem(serverUrl);
  if (!publicKeyPem) {
    throw new Error(`Khong lay duoc public key license tu server: ${buildApiUrl(serverUrl, 'public-key')}`);
  }

  const machineId = getMachineFingerprint();
  let response;
  try {
    response = await axios.post(buildApiUrl(serverUrl, 'activate'), {
      appId: APP_ID,
      code,
      machineId,
      hostname: os.hostname(),
      platform: os.platform()
    }, {
      timeout: 15000
    });
  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const serverMessage = data?.message || data?.error || error?.message || 'Unknown error';

    if (status === 409 && data?.error === 'CODE_ALREADY_USED') {
      throw new Error(`Ma nay da duoc su dung roi`);
    }

    if (status === 400 && data?.error === 'CODE_MACHINE_MISMATCH') {
      const boundMachineId = data?.boundMachineId ? `; boundMachineId=${data.boundMachineId}` : '';
      throw new Error(`Ma nay chi dung cho may khac${boundMachineId}`);
    }

    if (status === 410 && data?.error === 'LICENSE_EXPIRED') {
      throw new Error('License da het han.');
    }

    if (status === 500 && data?.message === 'LICENSE_PRIVATE_KEY_PEM_INVALID_FORMAT') {
      throw new Error('Khong dung dinh dang LICENSE_PRIVATE_KEY_PEM. Hay dán private key PEM that, khong phai public key hay chuoi da escape.');
    }

    if (status === 409 && data?.error === 'ACTIVATION_CONFLICT') {
      throw new Error('Kich hoat dang xay ra xung dot, vui long thu lai.');
    }

    throw new Error(`Activate failed${status ? ` (${status})` : ''}: ${serverMessage}`);
  }

  const bundle = response.data && (response.data.license || response.data.bundle || response.data);
  const validation = validateStoredLicenseWithKey(bundle, publicKeyPem);

  if (!validation.valid) {
    throw new Error(`License server tra ve du lieu khong hop le: ${validation.reason}`);
  }

  saveStoredLicense(bundle);
  return validation.payload;
}

async function ensureLicense() {
  const stored = readStoredLicense();
  if (stored) {
    const validation = await validateStoredLicenseAsync(stored);
    if (validation.valid) {
      return validation.payload;
    }

    try {
      const payload = decodePayload(stored);
      if (payload?.codeId) {
        return await activateLicense(payload.codeId);
      }
    } catch (error) {
      console.log(`Không thể làm mới license: ${error.message}`);
    }

    clearStoredLicense();
  }

  return null;
}

async function validateStoredLicenseAsync(bundle) {
  const serverUrl = getLicenseServerUrl();
  if (!serverUrl) {
    return { valid: false, reason: 'SERVER_URL_MISSING' };
  }

  const publicKeyPem = await fetchPublicKeyPem(serverUrl);
  if (!publicKeyPem) {
    return { valid: false, reason: 'PUBLIC_KEY_MISSING' };
  }
  return validateStoredLicenseWithKey(bundle, publicKeyPem);
}

async function refreshStoredLicenseFromServer() {
  const stored = readStoredLicense();
  if (!stored) return null;

  const payload = decodePayload(stored);
  if (!payload?.codeId) return null;

  try {
    return await activateLicense(payload.codeId);
  } catch (error) {
    return null;
  }
}

module.exports = {
  APP_ID,
  activateLicense,
  clearStoredLicense,
  decodePayload,
  ensureLicense,
  getLicenseDir,
  getLicensePath,
  getMachineFingerprint,
  getLicenseServerUrl,
  fetchPublicKeyPem,
  readStoredLicense,
  refreshStoredLicenseFromServer,
  saveStoredLicense,
  validateStoredLicense,
  validateStoredLicenseWithKey,
  validateStoredLicenseAsync,
  verifyBundleSignature
};
