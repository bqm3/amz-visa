const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { findChrome } = require('./chromeFinder');
const windowManager = require('./windowManager');
const sharedCardQueue = require('./sharedCardQueue');

const accounts = fs.readFileSync(path.join(__dirname, '..', 'data', 'acc.txt'), 'utf8')
    .replaceAll('\r', '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

const proxies = fs.readFileSync(path.join(__dirname, '..', 'data', 'proxies.txt'), 'utf8')
    .replaceAll('\r', '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

let currentProxyIndex = 0;
let maxConcurrentWindows = 1; // Will be set at runtime in updateNormal()

function parseProxyLine(line) {
    const value = String(line || '').trim();
    if (!value) return null;

    if (value.includes('|')) {
        const [hostPort, username, password] = value.split('|').map(part => part.trim());
        const [host, port] = hostPort.split(':').map(part => part.trim());
        return host && port ? { host, port, username, password } : null;
    }

    const [host, port, username, password] = value.split(':').map(part => part.trim());
    return host && port ? { host, port, username, password } : null;
}

function normalizeCardLine(cardLine) {
    const [number, monthRaw, yearRaw, cvc, ...nameParts] = String(cardLine || '').split('|');
    if (!number || !monthRaw || !yearRaw || !cvc) return null;

    const month = monthRaw.length === 1 ? `0${monthRaw}` : monthRaw;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    const name = nameParts.join('|').trim() || 'Saint David';

    return {
        number: number.trim(),
        month: month.trim(),
        year: year.trim(),
        cvc: cvc.trim(),
        name,
        raw: cardLine
    };
}

function appendCardResult(kind, card, email, reason = '') {
    const status = kind === 'live' ? 'LIVE' : 'DIE';
    const base = `${status}|${card.number}|${card.month}|${card.year}|${card.cvc}`;
    const namePart = card.name ? `|${card.name}` : '';
    const accountPart = email ? `|Account:${email}` : '';
    const reasonPart = reason ? `|Reason:${reason}` : '';
    const line = `${base}${namePart}${accountPart}${reasonPart}`;

    if (console.card && typeof console.card[kind] === 'function') {
        console.card[kind](line);
        return;
    }

    const today = new Date();
    const formattedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dirSave = global.data.dirSave || path.join(__dirname, '..', '..', 'output', formattedDate);
    fs.mkdirSync(dirSave, { recursive: true });
    fs.appendFileSync(path.join(dirSave, `${kind}.txt`), line + '\n', 'utf8');
}

async function isAccountLockedPage(page) {
    try {
        if (!page || page.isClosed()) return false;
        const url = page.url();
        if (url.includes('account-status.amazon.com')) return true;

        return await page.evaluate(() => {
            const text = (document.body && document.body.innerText || '').toLowerCase();
            return text.includes('account locked temporarily') ||
                text.includes('your account has been locked') ||
                text.includes('account has been locked') ||
                text.includes('account on hold') ||
                text.includes('your account is currently under review') ||
                text.includes('billing verification required') ||
                text.includes('your orders are on hold') ||
                text.includes('verify your billing information');
        });
    } catch (_) {
        return false;
    }
}

function markLockedAccount(email, reason = 'ACCOUNT_LOCKED') {
    const dataPath = path.join(__dirname, '..', 'data', 'data.json');
    const lockedPath = path.join(__dirname, '..', 'data', 'locked_accounts.txt');

    try {
        let data = {};
        if (fs.existsSync(dataPath)) {
            data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        if (!data.lockedAccounts) data.lockedAccounts = {};
        data.lockedAccounts[email] = { lockedAt: Date.now(), reason };
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.app(`Không thể lưu account bị khóa vào data.json: ${error.message}`);
    }

    try {
        const existing = fs.existsSync(lockedPath) ? fs.readFileSync(lockedPath, 'utf8') : '';
        if (!existing.includes(email)) {
            fs.appendFileSync(lockedPath, `${new Date().toISOString()}: ${email} - ${reason} - AUTO_DETECTED\n`, 'utf8');
        }
    } catch (error) {
        console.app(`Không thể ghi account bị khóa: ${error.message}`);
    }
}

function loadLockedAccountEmails() {
    const locked = new Set();
    const dataPath = path.join(__dirname, '..', 'data', 'data.json');
    const lockedPath = path.join(__dirname, '..', 'data', 'locked_accounts.txt');

    try {
        if (fs.existsSync(dataPath)) {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            if (data.lockedAccounts) {
                Object.keys(data.lockedAccounts).forEach(email => locked.add(email));
            }
        }
    } catch (_) {}

    try {
        if (fs.existsSync(lockedPath)) {
            fs.readFileSync(lockedPath, 'utf8').replace(/\r/g, '').split('\n').forEach(line => {
                const match = line.match(/:\s*([^\s]+@[^\s]+)\s*-/) || line.match(/^([^\s|:]+@[^\s|:]+)/);
                if (match) locked.add(match[1].trim());
            });
        }
    } catch (_) {}

    return locked;
}

async function returnToWallet(page) {
    try {
        await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });
        await new Promise(resolve => setTimeout(resolve, 2500));
    } catch (error) {
        console.log(`Cảnh báo: không thể quay lại ví thanh toán: ${error.message}`);
    }
}

async function updateNormal() {
    // ✅ RESET STATE FOR NEW RUN
    currentProxyIndex = 0;
    
    // ✅ Use numChrome from UI config, fallback to proxy count, minimum 1
    maxConcurrentWindows = (global.uiConfig && global.uiConfig.numChrome) 
        ? global.uiConfig.numChrome 
        : Math.max(proxies.length, 1);
    
    windowManager.reset();
    console.log(`Số Chrome chạy song song tối đa: ${maxConcurrentWindows}`);
    console.app(`Số Chrome chạy song song tối đa: ${maxConcurrentWindows}`);
    console.log('Bắt đầu quy trình login normal...');
    console.app('Bắt đầu quy trình login normal...');

    const cardPath = path.join(__dirname, '..', 'data', 'card.txt');
    const cardLines = fs.existsSync(cardPath)
        ? fs.readFileSync(cardPath, 'utf8').replace(/\r/g, '').split('\n').map(v => v.trim()).filter(Boolean)
        : [];
    sharedCardQueue.initialize(cardLines, true);
    if (console.card && typeof console.card.setTotal === 'function') {
        console.card.setTotal(cardLines.length);
    }
    if (sharedCardQueue.remainingCount() === 0) {
        console.app('Không còn thẻ chưa claim. Xóa src/data/checkcard.txt nếu muốn chạy lại các thẻ này.');
        return;
    }

    if (accounts.length === 0) {
        console.log('Không tìm thấy account trong acc.txt');
        console.app('Không tìm thấy account trong acc.txt');
        return;
    }

    const lockedAccounts = loadLockedAccountEmails();
    const availableAccounts = accounts.filter(accountLine => {
        const email = accountLine.split('|')[0].trim();
        if (lockedAccounts.has(email)) {
            console.app(`Bỏ qua account bị khóa: ${email}`);
            return false;
        }
        return true;
    });

    if (availableAccounts.length === 0) {
        console.app('Không còn account khả dụng sau khi lọc account bị khóa');
        return;
    }

    let currentAccountIndex = 0;
    while (currentAccountIndex < availableAccounts.length) {
        if (sharedCardQueue.remainingCount() === 0) {
            console.log('Hết thẻ dùng chung khả dụng, dừng tiến trình login normal sớm.');
            console.app('Hết thẻ dùng chung khả dụng, dừng tiến trình login normal sớm.');
            break;
        }
        if (global.data.settings.stopRequested) {
            console.log('Nhận yêu cầu dừng, dừng tiến trình login normal sớm.');
            console.app('Nhận yêu cầu dừng, dừng tiến trình login normal sớm.');
            break;
        }

        const batch = [];
        for (let i = 0; i < maxConcurrentWindows && currentAccountIndex < availableAccounts.length; i++) {
            batch.push({ accountLine: availableAccounts[currentAccountIndex], index: currentAccountIndex });
            currentAccountIndex++;
        }

        await Promise.allSettled(batch.map(item => processAccount(item.accountLine, item.index)));
    }

    console.log('Đã hoàn tất toàn bộ login normal!');
    console.app('Đã hoàn tất toàn bộ login normal!');
}

async function processAccount(accountLine, index) {
    const [email, pass, secret] = accountLine.split('|');
    if (!email || !pass || !secret) {
        console.log(`Dữ liệu account không hợp lệ: ${accountLine}`);
        console.app(`Dữ liệu account không hợp lệ: ${accountLine}`);
        return;
    }

    if (sharedCardQueue.remainingCount() === 0) {
        console.log(`Bỏ qua account ${email} vì đã hết thẻ dùng chung.`);
        console.app(`Bỏ qua account ${email} vì đã hết thẻ dùng chung.`);
        return;
    }

    if (global.data.settings.stopRequested) {
        console.log(`Bỏ qua account ${email} vì tiến trình bị dừng.`);
        console.app(`Bỏ qua account ${email} vì tiến trình bị dừng.`);
        return;
    }

    let proxy = null;
    if (proxies.length > 0) {
        proxy = parseProxyLine(proxies[currentProxyIndex % proxies.length]);
        currentProxyIndex++;
    }

    let browser;
    try {
        const windowPosition = windowManager.getNextPosition();
        const userDataDir = path.join(__dirname, '..', 'data', 'chrome-profiles', `normal-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`);
        const defaultProfileDir = path.join(userDataDir, 'Default');
        fs.mkdirSync(defaultProfileDir, { recursive: true });
        fs.writeFileSync(path.join(defaultProfileDir, 'Preferences'), JSON.stringify({
            credentials_enable_service: false,
            profile: {
                password_manager_enabled: false,
                password_manager_leak_detection: false
            },
            autofill: {
                profile_enabled: false,
                credit_card_enabled: false,
                credit_card_fido_auth_enabled: false
            },
            payments: {
                can_make_payment_enabled: false
            }
        }, null, 2), 'utf8');

        const chromePath = findChrome();
        const launchOptions = {
            headless: !global.data.settings.showBrowser,
            userDataDir,
            ...(chromePath ? { executablePath: chromePath } : {}),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--ignore-certificate-errors',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                `--window-position=${windowPosition.x},${windowPosition.y}`,
                `--window-size=${windowPosition.width},${windowPosition.height}`,
                '--disable-extensions',
                '--disable-gpu',
                '--disable-save-password-bubble',
                '--disable-autofill-keyboard-accessory-view',
                '--disable-autofill-keyboard-accessory',
                '--disable-autofill-type-predictions',
                '--disable-features=AutofillServerCommunication,AutofillEnableAccountWalletStorage,PasswordManagerOnboarding,PasswordManagerSettingsMigration',
                '--disable-password-generation',
                '--disable-password-manager-reauthentication',
                '--password-store=basic',
                '--use-mock-keychain',
                '--disable-translate'
            ],
            defaultViewport: null
        };

        if (proxy && proxy.host && proxy.port) {
            launchOptions.args.push(`--proxy-server=${proxy.host}:${proxy.port}`);
        }

        browser = await puppeteer.launch(launchOptions);
        if (!global.activeBrowsers) global.activeBrowsers = [];
        global.activeBrowsers.push(browser);

        const page = await browser.newPage();

        if (proxy && proxy.username && proxy.password) {
            await page.authenticate({
                username: proxy.username,
                password: proxy.password
            });
        }

        console.log(`Đang login normal cho: ${email}`);
        console.app(`Đang login normal cho: ${email}`);

        await require(path.join(__dirname, '..', 'api', 'login.js'))(page, {
            email,
            pass,
            code: secret,
            proxy
        });

        await new Promise(resolve => setTimeout(resolve, 1500));
        if (await isAccountLockedPage(page)) {
            markLockedAccount(email, 'ACCOUNT_LOCKED');
            console.app(`Phát hiện account bị khóa sau khi login: ${email}`);
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Follow-up action similar to business flow: resolve account switcher if it appears.
        try {
            const switcherHeaderExists = await page.evaluate(() => !!document.querySelector('#cvf-filtered-account-switcher-header-text'));
            if (switcherHeaderExists) {
                console.log(`Phát hiện màn chọn account cho ${email}, đang chọn account cá nhân...`);
                console.app(`Phát hiện màn chọn account cho ${email}, đang chọn account cá nhân...`);

                const clicked = await page.evaluate(() => {
                    const customerName = document.querySelector('[data-test-id="customerName"]');
                    if (customerName) {
                        customerName.click();
                        return true;
                    }
                    const accountTypes = Array.from(document.querySelectorAll('[data-test-id="accountType"]'));
                    const personal = accountTypes.find(el => (el.textContent || '').toLowerCase().includes('personal account'));
                    if (personal) {
                        personal.click();
                        return true;
                    }
                    return false;
                });

                if (clicked) {
                    try {
                        await Promise.race([
                            page.waitForNavigation({ timeout: 15000 }),
                            new Promise(resolve => setTimeout(resolve, 4000))
                        ]);
                    } catch (_) {}
                }
            }
        } catch (_) {}

        if (global.data.settings.addAddress) {
            // Post-login action: open Addresses page and click "Add Address" tile.
            try {
                await page.goto('https://www.amazon.com/a/addresses?ref_=ya_d_c_addr', {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000
                });
                await new Promise(resolve => setTimeout(resolve, 2500));

                const clickedAddAddress = await page.evaluate(() => {
                    const selectors = [
                        '.first-desktop-address-tile',
                        '#ya-myab-plus-address-icon',
                        '.add-address-text',
                        '[data-a-modal-trigger*="add"]'
                    ];

                    for (const selector of selectors) {
                        const el = document.querySelector(selector);
                        if (!el) continue;
                        const clickable = el.closest('.first-desktop-address-tile') || el;
                        try { clickable.scrollIntoView({ block: 'center' }); } catch (_) {}
                        try {
                            clickable.click();
                            return { success: true, selector };
                        } catch (_) {
                            try {
                                clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                                return { success: true, selector: `${selector}:dispatch` };
                            } catch (_) {}
                        }
                    }
                    return { success: false };
                });

                if (clickedAddAddress.success) {
                    console.log(`Đã bấm ô Add Address bằng selector: ${clickedAddAddress.selector}`);
                    console.app(`Đã bấm ô Add Address bằng selector: ${clickedAddAddress.selector}`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    console.log(`Không tìm thấy ô Add Address cho ${email}, thử mở URL thêm địa chỉ trực tiếp...`);
                    console.app(`Không tìm thấy ô Add Address cho ${email}, thử mở URL thêm địa chỉ trực tiếp...`);
                }

                const hasAddressForm = await page.$('#address-ui-widgets-enterAddressPhoneNumber');
                if (!hasAddressForm) {
                    const directAddUrls = [
                        'https://www.amazon.com/a/addresses/add?ref_=ya_d_c_addr',
                        'https://www.amazon.com/a/addresses/add'
                    ];
                    for (const url of directAddUrls) {
                        try {
                            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            const found = await page.$('#address-ui-widgets-enterAddressPhoneNumber');
                            if (found) break;
                        } catch (_) {}
                    }
                }

                try {
                    const addressApi = require(path.join(__dirname, '..', 'api', 'addAddress.js'));
                    await addressApi.addAddress(page, { apiRetries: 1 });
                    console.log(`Đã hoàn tất thêm địa chỉ cho ${email}`);
                    console.app(`Đã hoàn tất thêm địa chỉ cho ${email}`);
                } catch (addAddressError) {
                    console.log(`Lỗi khi điền form địa chỉ cho ${email}: ${addAddressError.message}`);
                    console.app(`Lỗi khi điền form địa chỉ cho ${email}: ${addAddressError.message}`);
                }
            } catch (addressPageError) {
                console.app(`Lỗi khi mở trang địa chỉ cho ${email}: ${addressPageError.message}`);
            }
        } else {
            console.app(`Bỏ qua bước thêm địa chỉ cho ${email}`);
        }

            // Continue with card flow similar to scan/check flow.
            try {
                // For normal accounts, go directly to consumer wallet to avoid business-only routing.
                await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000
                });
                await new Promise(resolve => setTimeout(resolve, 1500));

                if (sharedCardQueue.remainingCount() === 0) {
                    console.log(`Không còn thẻ dùng chung khả dụng cho ${email}`);
                    console.app(`Không còn thẻ dùng chung khả dụng cho ${email}`);
                } else {
                    const addCard = require(path.join(__dirname, '..', 'api', 'addCard.js'));

                    let liveCount = 0;
                    let dieCount = 0;

                    while (true) {
                        if (global.data.settings.stopRequested) {
                            console.app(`Tiến trình bị dừng, dừng claim thẻ cho ${email}`);
                            break;
                        }
                        if (!page || page.isClosed()) {
                            console.app(`Trang đã đóng cho ${email}, dừng claim thẻ dùng chung`);
                            break;
                        }

                        const card = sharedCardQueue.claimNextCard(email);
                        if (!card) {
                            console.log(`Đã hết thẻ dùng chung cho ${email}`);
                            console.app(`Đã hết thẻ dùng chung cho ${email}`);
                            break;
                        }

                        const form = {
                            number: card.number,
                            month: card.month,
                            year: card.year,
                            name: card.name,
                            cvc: card.cvc
                        };

                        console.log(`Đang xử lý thẻ dùng chung ***${card.number.slice(-4)} cho ${email}`);
                        console.app(`Đang xử lý thẻ dùng chung ***${card.number.slice(-4)} cho ${email}`);

                        const res = await addCard(page, form);

                        if (res.success) {
                            liveCount++;
                            appendCardResult('live', card, email);
                            console.log(`Thẻ LIVE ***${card.number.slice(-4)} cho ${email}`);
                            console.app(`Thẻ LIVE ***${card.number.slice(-4)} cho ${email}`);
                        } else {
                            const reason = res.step || res.error ? ` (${res.step || 'unknown_step'}: ${res.error || 'unknown_error'})` : '';
                            dieCount++;
                            appendCardResult('die', card, email, reason.replace(/^\s*\(|\)\s*$/g, ''));
                            console.log(`Thẻ DIE ***${card.number.slice(-4)} cho ${email}${reason}`);
                            console.app(`Thẻ DIE ***${card.number.slice(-4)} cho ${email}${reason}`);

                            const fatalReason = `${res.step || ''} ${res.error || ''}`.toLowerCase();
                            if (fatalReason.includes('page_closed') || fatalReason.includes('detached frame') || fatalReason.includes('session closed')) {
                                console.app(`Lỗi nghiêm trọng ở page/frame cho ${email}, dừng claim thẻ dùng chung`);
                                break;
                            }
                        }

                        await returnToWallet(page);
                    }

                    console.log(`Đã hoàn tất flow thẻ cho ${email}: ${liveCount} live, ${dieCount} die`);
                    console.app(`Đã hoàn tất flow thẻ cho ${email}: ${liveCount} live, ${dieCount} die`);
                }
            } catch (cardFlowError) {
                console.log(`Lỗi flow thẻ cho ${email}: ${cardFlowError.message}`);
                console.app(`Lỗi flow thẻ cho ${email}: ${cardFlowError.message}`);
            }
        console.log(`Login thành công: ${email}`);
        console.app(`Login thành công: ${email}`);
    } catch (error) {
        if (String(error.message || '').includes('ACCOUNT_LOCKED') || String(error.message || '').includes('account-status') || await isAccountLockedPage(page)) {
            markLockedAccount(email, 'ACCOUNT_LOCKED');
            console.app(`Phát hiện account bị khóa: ${email}`);
            return;
        }

        console.log(`Login normal thất bại [${index + 1}] ${email}: ${error.message}`);
        console.app(`Login normal thất bại [${index + 1}] ${email}: ${error.message}`);
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {}
            if (global.activeBrowsers) {
                const idx = global.activeBrowsers.indexOf(browser);
                if (idx > -1) global.activeBrowsers.splice(idx, 1);
            }
        }
    }
}

module.exports = updateNormal;
