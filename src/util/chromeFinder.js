/**
 * chromeFinder.js
 * Tự động tìm đường dẫn Chrome phù hợp khi chạy dưới dạng .exe hoặc dev mode.
 * Ưu tiên: bundled chrome → system chrome → puppeteer cache
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Trả về đường dẫn Chrome khả dụng đầu tiên tìm được.
 * Nếu không tìm thấy, trả về undefined (puppeteer tự xử lý).
 */
function findChrome() {
    const candidates = getCandidatePaths();
    for (const p of candidates) {
        if (p && isFile(p)) {
            console.log(`[chromeFinder] Dùng Chrome: ${p}`);
            return p;
        }
    }
    console.log('[chromeFinder] Không tìm thấy Chrome tùy chỉnh, dùng Puppeteer mặc định');
    return undefined;
}

function isFile(filePath) {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch (_) {
        return false;
    }
}

function getCandidatePaths() {
    const paths = [];

    // 1. Chrome bundled cạnh file exe (khi đóng gói bằng nodegui-builder/bootstrapper)
    const exeDir = getExeDir();
    if (exeDir) {
        paths.push(
            path.join(exeDir, 'chrome', 'chrome.exe'),
            path.join(exeDir, 'chrome', 'win64', 'chrome.exe'),
            path.join(exeDir, 'chrome-win64', 'chrome.exe'),
            path.join(exeDir, 'chromium', 'chrome.exe'),
        );
    }

    // 2. Puppeteer cache (thư mục home của USER hiện tại, không hardcode username)
    try {
        const puppeteer = require('puppeteer');
        const p = puppeteer.executablePath();
        if (p) paths.push(p);
    } catch (_) {}

    // 3. Scan thư mục puppeteer cache tổng quát theo USER hiện tại
    const homeDir = os.homedir();
    const puppeteerCacheBase = path.join(homeDir, '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(puppeteerCacheBase)) {
        try {
            const versions = fs.readdirSync(puppeteerCacheBase).sort().reverse();
            for (const ver of versions) {
                const candidate = path.join(puppeteerCacheBase, ver, 'chrome-win64', 'chrome.exe');
                paths.push(candidate);
                // Fallback tên thư mục khác
                const candidate2 = path.join(puppeteerCacheBase, ver, 'chrome.exe');
                paths.push(candidate2);
            }
        } catch (_) {}
    }

    // 4. Chrome cài đặt hệ thống (Windows)
    const programFiles = [
        process.env['PROGRAMFILES'],
        process.env['PROGRAMFILES(X86)'],
        process.env['LOCALAPPDATA'],
    ].filter(Boolean);

    for (const pf of programFiles) {
        paths.push(
            path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(pf, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
            path.join(pf, 'Chromium', 'Application', 'chrome.exe'),
            path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        );
    }

    return paths;
}

function getExeDir() {
    try {
        // Khi chạy như exe, process.execPath trỏ vào file exe
        const execPath = process.execPath;
        if (execPath && !execPath.includes('node_modules') && !execPath.endsWith('node.exe') && !execPath.endsWith('qode.exe')) {
            return path.dirname(execPath);
        }
        // Fallback: thư mục của bootstrapper nếu có biến môi trường
        if (process.env.AMZUS_APP_DIR) {
            return process.env.AMZUS_APP_DIR;
        }
    } catch (_) {}
    return null;
}

module.exports = { findChrome };
