const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const APP_ID = 'amz-us-app';
const LICENSE_FILE_NAME = 'license.json';

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
  const networkInterfaces = os.networkInterfaces();
  const macs = [];

  for (const [name, entries] of Object.entries(networkInterfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || !entry.mac || entry.mac === '00:00:00:00:00:00') continue;
      macs.push(`${name}:${entry.mac}`);
    }
  }

  macs.sort();

  const raw = [
    `hostname=${os.hostname()}`,
    `platform=${os.platform()}`,
    `arch=${os.arch()}`,
    `release=${os.release()}`,
    `cpu=${(os.cpus()[0] && os.cpus()[0].model) || 'unknown'}`,
    `totalmem=${os.totalmem()}`,
    `macs=${macs.join(',')}`
  ].join('|');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getLicenseServerUrl() {
  return String(
    process.env.AMZ_LICENSE_SERVER_URL ||
      process.env.LICENSE_SERVER_URL ||
      ''
  ).trim().replace(/\/+$/, '');
}

function buildApiUrl(serverUrl, endpoint) {
  const base = String(serverUrl || '').trim().replace(/\/+$/, '');
  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  return `${base}/api/${cleanEndpoint}`;
}

function getPublicKeyPem() {
  return '';
}

async function fetchPublicKeyPem(serverUrl) {
  const baseUrl = String(serverUrl || getLicenseServerUrl()).trim().replace(/\/+$/, '');
  if (!baseUrl) return '';

  try {
    const response = await axios.get(buildApiUrl(baseUrl, 'public-key'), { timeout: 15000 });
    const body = response.data || {};
    const key = String(body.publicKey || body.key || '').trim();
    return key;
  } catch (error) {
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
    console.log(`Failed to read stored license: ${error.message}`);
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
    console.log(`Failed to clear stored license: ${error.message}`);
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
  const publicKeyPem = getPublicKeyPem();
  return validateStoredLicenseWithKey(bundle, publicKeyPem);
}

async function activateLicense(code) {
  const serverUrl = getLicenseServerUrl();
  if (!serverUrl) {
    throw new Error('Chua cau hinh AMZ_LICENSE_SERVER_URL.');
  }

  let publicKeyPem = getPublicKeyPem();
  if (!publicKeyPem) {
    publicKeyPem = await fetchPublicKeyPem(serverUrl);
  }
  if (!publicKeyPem) {
    throw new Error('Khong lay duoc public key license tu server.');
  }

  const machineId = getMachineFingerprint();
  const response = await axios.post(buildApiUrl(serverUrl, 'activate'), {
    appId: APP_ID,
    code,
    machineId,
    hostname: os.hostname(),
    platform: os.platform()
  }, {
    timeout: 15000
  });

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

    clearStoredLicense();
  }

  return null;
}

async function validateStoredLicenseAsync(bundle) {
  const publicKeyPem = getPublicKeyPem() || await fetchPublicKeyPem();
  if (!publicKeyPem) {
    return { valid: false, reason: 'PUBLIC_KEY_MISSING' };
  }
  return validateStoredLicenseWithKey(bundle, publicKeyPem);
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
  getPublicKeyPem,
  fetchPublicKeyPem,
  readStoredLicense,
  saveStoredLicense,
  validateStoredLicense,
  validateStoredLicenseWithKey,
  validateStoredLicenseAsync,
  verifyBundleSignature
};
