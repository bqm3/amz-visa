const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { findChrome } = require('./chromeFinder');
const sharedCardQueue = require('./sharedCardQueue');
const windowManager = require('./windowManager'); // ✅ ADD IMPORT

// Load data files
const childAccounts = fs.readFileSync(path.join(__dirname, "..", "data", 'acc.txt'), 'utf8')
    .replaceAll("\r", '')
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

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

const proxies = fs.readFileSync(path.join(__dirname, "..", "data", 'proxies.txt'), 'utf8')
    .replaceAll("\r", '')
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

// ⭐ LOAD BUSINESS ACCOUNTS FROM DATA.JSON
function loadBusinessAccounts() {
    try {
        const dataPath = path.join(__dirname, "..", "data", "data.json");
        if (fs.existsSync(dataPath)) {
            const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            return data.businessAccounts || [];
        }
    } catch (error) {
        console.log(`Lỗi khi tải danh sách account business: ${error.message}`);
    }
    return [];
}

// ⭐ CHECK IF ACCOUNT SHOULD BE SKIPPED
function shouldSkipBusinessUpgrade(email) {
    const businessAccounts = loadBusinessAccounts();
    const isAlreadyBusiness = businessAccounts.includes(email);
    
    if (isAlreadyBusiness) {
        console.log(`Account business đã tồn tại cho ${email}, chọn Business account và tiếp tục`);
        console.app(`Account business đã tồn tại cho ${email}, chọn Business account và tiếp tục`);
        return false;
    }
    
    return false;
}

// Validate proxy count
if (proxies.length === 0) {
    console.log("Cảnh báo: không tìm thấy proxy trong proxies.txt, sẽ chạy không dùng proxy");
    console.app("Cảnh báo: không tìm thấy proxy trong proxies.txt, sẽ chạy không dùng proxy");
}

let currentAccountIndex = 0;
let currentProxyIndex = 0;
let maxConcurrentWindows = 1; // Will be set at runtime in updateBusiness()
let activeBrowsers = [];

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

async function stopIfLocked(page, email, context = '') {
    if (!(await isAccountLockedPage(page))) return false;

    markLockedAccount(email, 'ACCOUNT_LOCKED');
    console.app(`Phát hiện account bị khóa${context ? ` ${context}` : ''}: ${email}`);
    return true;
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

async function clickStartBrowsingIfPresent(page, email) {
    const started = Date.now();
    while (Date.now() - started < 15000) {
        try {
            if (await stopIfLocked(page, email, 'before start browsing')) {
                throw new Error('ACCOUNT_LOCKED');
            }

            const clicked = await page.evaluate(() => {
                const isVisible = (el) => {
                    if (!el || el.disabled) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                };

                const candidates = Array.from(document.querySelectorAll('button, a, input[type="button"], input[type="submit"]'))
                    .filter(isVisible);
                const button = candidates.find((el) => {
                    const text = [
                        el.innerText || '',
                        el.textContent || '',
                        el.value || '',
                        el.getAttribute('aria-label') || ''
                    ].join(' ').toLowerCase();
                    return text.includes('start browsing');
                });

                if (!button) return false;
                button.scrollIntoView({ block: 'center' });
                button.click();
                return true;
            });

            if (clicked) {
                console.log(`Đã bấm Start browsing cho ${email}`);
                console.app(`Đã bấm Start browsing cho ${email}`);
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
                    new Promise(resolve => setTimeout(resolve, 4000))
                ]);
                return true;
            }
        } catch (error) {
            if (String(error.message || '').includes('ACCOUNT_LOCKED')) throw error;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Không tìm thấy nút Start browsing cho ${email}, tiếp tục sang flow thẻ`);
    console.app(`Không tìm thấy nút Start browsing cho ${email}, tiếp tục sang flow thẻ`);
    return false;
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

async function runBusinessCardFlow(page, email) {
    if (await stopIfLocked(page, email, 'before card flow')) {
        return;
    }

    if (sharedCardQueue.remainingCount() === 0) {
        console.log(`Không còn thẻ dùng chung khả dụng cho ${email}`);
        console.app(`Không còn thẻ dùng chung khả dụng cho ${email}`);
        return;
    }

    const addCard = require(path.join(__dirname, '..', 'api', 'addCard.js'));
    let liveCount = 0;
    let dieCount = 0;

    await returnToWallet(page);

    while (true) {
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

        console.log(`Đang xử lý thẻ business dùng chung ***${card.number.slice(-4)} cho ${email}`);
        console.app(`Đang xử lý thẻ business dùng chung ***${card.number.slice(-4)} cho ${email}`);

        const res = await addCard(page, form);
        if (res.success) {
            liveCount++;
            appendCardResult('live', card, email);
            console.log(`Thẻ business LIVE ***${card.number.slice(-4)} cho ${email}`);
            console.app(`Thẻ business LIVE ***${card.number.slice(-4)} cho ${email}`);
        } else {
            const reason = res.step || res.error ? ` (${res.step || 'unknown_step'}: ${res.error || 'unknown_error'})` : '';
            dieCount++;
            appendCardResult('die', card, email, reason.replace(/^\s*\(|\)\s*$/g, ''));
            console.log(`Thẻ business DIE ***${card.number.slice(-4)} cho ${email}${reason}`);
            console.app(`Thẻ business DIE ***${card.number.slice(-4)} cho ${email}${reason}`);

            const fatalReason = `${res.step || ''} ${res.error || ''}`.toLowerCase();
            if (fatalReason.includes('page_closed') || fatalReason.includes('detached frame') || fatalReason.includes('session closed')) {
                console.app(`Lỗi nghiêm trọng ở page/frame cho ${email}, dừng claim thẻ dùng chung`);
                break;
            }
        }

        await returnToWallet(page);
    }

    console.log(`Đã hoàn tất flow thẻ business cho ${email}: ${liveCount} live, ${dieCount} die`);
    console.app(`Đã hoàn tất flow thẻ business cho ${email}: ${liveCount} live, ${dieCount} die`);
}

async function runBusinessAddressFlow(page, email) {
    if (!global.data.settings.addAddress) {
        console.app(`Bỏ qua bước thêm địa chỉ business cho ${email}`);
        return;
    }

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

        if (!clickedAddAddress.success) {
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
        } else {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const addressApi = require(path.join(__dirname, '..', 'api', 'addAddress.js'));
        await addressApi.addAddress(page, { apiRetries: 1 });
        console.log(`Đã hoàn tất thêm địa chỉ business cho ${email}`);
        console.app(`Đã hoàn tất thêm địa chỉ business cho ${email}`);
    } catch (error) {
        console.log(`Lỗi flow địa chỉ business cho ${email}: ${error.message}`);
        console.app(`Lỗi flow địa chỉ business cho ${email}: ${error.message}`);
    }
}

/**
 * Simple function to add business account to data.json (keeping original format)
 */
function addBusinessAccount(email) {
    try {
        const dataPath = path.join(__dirname, "..", "data", "data.json");
        let data = {};
        
        // Load existing data or create new structure
        if (fs.existsSync(dataPath)) {
            data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        }
        
        // Initialize businessAccounts array if not exists
        if (!data.businessAccounts) {
            data.businessAccounts = [];
        }
        
        // Add to business accounts list if not already present
        if (!data.businessAccounts.includes(email)) {
            data.businessAccounts.push(email);
            console.log(`Đã thêm ${email} vào danh sách account business`);
            console.app(`Đã thêm ${email} vào danh sách account business`);
            
            // Save data immediately
            fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } else {
            console.log(`${email} đã có trong danh sách account business`);
            console.app(`${email} đã có trong danh sách account business`);
            return false;
        }
        
    } catch (error) {
        console.error(`Lỗi khi thêm account business ${email}:`, error.message);
        console.app(`Lỗi khi thêm account business ${email}: ${error.message}`);
        return false;
    }
}

/**
 * Main function to start business login process
 */
async function updateBusiness() {
    // ✅ RESET STATE FOR NEW RUN
    currentAccountIndex = 0;
    currentProxyIndex = 0;
    
    // ✅ Use numChrome from UI config, fallback to proxy count, minimum 1
    maxConcurrentWindows = (global.uiConfig && global.uiConfig.numChrome) 
        ? global.uiConfig.numChrome 
        : Math.max(proxies.length, 1);
    
    // ✅ RESET WINDOW POSITIONS AT START
    windowManager.reset();
    
    console.log(`Số Chrome chạy song song tối đa: ${maxConcurrentWindows}`);
    console.app(`Số Chrome chạy song song tối đa: ${maxConcurrentWindows}`);
    console.app("Bắt đầu quy trình đăng ký account business...");
    console.log("Bắt đầu quy trình đăng ký account business...");

    const startupCardPath = path.join(__dirname, '..', 'data', 'card.txt');
    const startupCardLines = fs.existsSync(startupCardPath)
        ? fs.readFileSync(startupCardPath, 'utf8').replace(/\r/g, '').split('\n').map(v => v.trim()).filter(Boolean)
        : [];
    sharedCardQueue.initialize(startupCardLines, true);
    if (console.card && typeof console.card.setTotal === 'function') {
        console.card.setTotal(startupCardLines.length);
    }
    if (sharedCardQueue.remainingCount() === 0) {
        console.app('Không còn thẻ chưa claim. Xóa src/data/checkcard.txt nếu muốn chạy lại các thẻ này.');
        return;
    }

    // ⭐ FILTER OUT ALREADY BUSINESS ACCOUNTS
    const businessAccounts = loadBusinessAccounts();
    const lockedAccounts = loadLockedAccountEmails();
    const accountsToProcess = [];
    let skippedCount = 0;

    for (const accountLine of childAccounts) {
        const email = accountLine.split('|')[0];
        
        if (lockedAccounts.has(email)) {
            console.app(`Bỏ qua account bị khóa: ${email}`);
            skippedCount++;
        } else if (!shouldSkipBusinessUpgrade(email)) {
            accountsToProcess.push(accountLine);
        } else {
            skippedCount++;
        }
    }

    console.log(`Trạng thái login business:`);
    console.log(`Tổng account: ${childAccounts.length}`);
    console.log(`Đã là business: ${businessAccounts.length}`);
    console.log(`Đã bỏ qua: ${skippedCount}`);
    console.log(`Cần xử lý: ${accountsToProcess.length}`);
    console.app(`Tổng: ${childAccounts.length}, đã business: ${businessAccounts.length}, bỏ qua: ${skippedCount}, cần xử lý: ${accountsToProcess.length}`);

    if (accountsToProcess.length === 0) {
        console.log('Tất cả account đã là account business');
        console.app('Tất cả account đã là account business');
        return;
    }

    // Process remaining accounts
    const workerCount = Math.min(maxConcurrentWindows, accountsToProcess.length);
    console.log(`\nBắt đầu ${workerCount} worker cho ${accountsToProcess.length} account`);
    console.app(`Bắt đầu ${workerCount} worker cho ${accountsToProcess.length} account`);

    const workers = Array.from({ length: workerCount }, (_, workerIndex) =>
        processBusinessWorker(workerIndex + 1, accountsToProcess)
    );

    await Promise.allSettled(workers);

    console.log("Đã hoàn tất toàn bộ login business!");
    console.app("Đã hoàn tất toàn bộ login business!");
}

/**
 * Process accounts dynamically. When a browser/account finishes, this worker
 * immediately takes the next account instead of waiting for a whole batch.
 */
async function processBusinessWorker(workerId, accountsToProcess) {
    while (currentAccountIndex < accountsToProcess.length) {
        const accountIndex = currentAccountIndex++;
        const account = accountsToProcess[accountIndex];
        const email = account.split('|')[0];

        console.app(`Worker ${workerId}: bắt đầu account ${accountIndex + 1}/${accountsToProcess.length}: ${email}`);

        try {
            await processAccount(account, accountIndex);
        } catch (error) {
            console.error(`Worker ${workerId} lỗi khi xử lý account ${email}:`, error.message);
            console.app(`Worker ${workerId} lỗi khi xử lý account ${email}: ${error.message}`);
        }

        if (currentAccountIndex < accountsToProcess.length) {
            const delayMs = Math.max(500, 2000 - (proxies.length * 100));
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

/**
 * Process a single account
 */
async function processAccount(accountLine, batchIndex) {
    const [email, pass, secret] = accountLine.split("|");

    if (!email || !pass || !secret) {
        console.log(`Dữ liệu account không hợp lệ: ${accountLine}`);
        console.app(`Dữ liệu account không hợp lệ: ${accountLine}`);
        return;
    }

    let browser = null;
    let page = null;

    try {
        console.log(`[${batchIndex + 1}] Bắt đầu login cho: ${email}`);
        console.app(`[${batchIndex + 1}] Bắt đầu login cho: ${email}`);

        // Get proxy if available
        let proxy = null;
        if (proxies.length > 0) {
            const proxyLine = proxies[currentProxyIndex % proxies.length];
            const [host, port, user, proxyPass] = proxyLine.split(':');
            proxy = {
                host: host,
                port: port,
                username: user,
                password: proxyPass
            };
            console.log(`[${batchIndex + 1}] Dùng proxy ${host}:${port} cho ${email}`);
            console.app(`[${batchIndex + 1}] Dùng proxy ${host}:${port} cho ${email}`);
            currentProxyIndex++;
        } else {
            console.log(`[${batchIndex + 1}] Không có proxy, dùng kết nối trực tiếp cho ${email}`);
            console.app(`[${batchIndex + 1}] Không có proxy, dùng kết nối trực tiếp cho ${email}`);
        }

        // ✅ GET POSITION FROM WINDOW MANAGER
        const windowPosition = windowManager.getNextPosition();
        const userDataDir = path.join(__dirname, '..', 'data', 'chrome-profiles', `business-${Date.now()}-${batchIndex}-${Math.random().toString(16).slice(2)}`);
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
        // Launch browser with positioned window
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
                // ✅ SET WINDOW POSITION AND SIZE
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
            ignoreDefaultArgs: ['--enable-automation']
        };

        // Add proxy if available
        if (proxy) {
            launchOptions.args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
        }

        browser = await puppeteer.launch(launchOptions);
        activeBrowsers.push(browser);

        page = await browser.newPage();

        
        // ✅ SET VIEWPORT TO MATCH WINDOW SIZE
        await page.setViewport({
            width: windowPosition.width - 20,
            height: windowPosition.height - 100
        });

        // Authenticate proxy if needed
        if (proxy && proxy.username && proxy.password) {
            await page.authenticate({
                username: proxy.username,
                password: proxy.password
            });
        }

        // Prepare login form data
        const loginForm = {
            email: email,
            pass: pass,
            code: secret,
            proxy: proxy
        };

        // Call business login function
        console.log(`[${batchIndex + 1}] Đang login business cho: ${email}`);
        console.app(`[${batchIndex + 1}] Đang login business cho: ${email}`);

        await require(path.join(__dirname, "..", "api", "business", "login.js"))(page, loginForm);

        await new Promise(resolve => setTimeout(resolve, 1500));
        if (await isAccountLockedPage(page)) {
            markLockedAccount(email, 'ACCOUNT_LOCKED');
            console.app(`Phát hiện account bị khóa sau khi login: ${email}`);
            return;
        }

        console.log(`[${batchIndex + 1}] Login thành công: ${email}`);
        console.app(`[${batchIndex + 1}] Login thành công: ${email}`);

        // Check if page have elements id 'cvf-filtered-account-switcher-header-text' is exists
        await new Promise(resolve => setTimeout(resolve, 5000));
        const accountSwitcherHeader = await page.evaluate(() => {
            return !!document.querySelector('#cvf-filtered-account-switcher-header-text');
        });

        if (!accountSwitcherHeader) {
            console.log(`[${batchIndex + 1}] Tiếp tục hoàn tất login cho: ${email}`)
            console.app(`[${batchIndex + 1}] Tiếp tục hoàn tất login cho: ${email}`);
            try {
                await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).continueLogin(page, loginForm);
            } catch (error) {
                throw new Error(`This account is already registered or has an error: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).fillInfo(page, loginForm);
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).finalSetup(page, loginForm);
        } else {
            console.log(`[${batchIndex + 1}] Phát hiện màn chọn account, đang chọn account business...`)
            console.app(`[${batchIndex + 1}] Phát hiện màn chọn account, đang chọn account business...`);
            try {
                await page.waitForSelector('[data-test-id="accountType"]', { timeout: 10000 });
                const businessAccounts = await page.$$('[data-test-id="accountType"]');

                for (const account of businessAccounts) {
                    const text = await page.evaluate(el => el.textContent, account);
                    if (text.includes('Business account')) {
                        await account.click();

                        await page.waitForNavigation({ timeout: 30000 }).catch(e =>
                            console.log(`[${batchIndex + 1}] Chờ chuyển trang sau khi chọn account business bị timeout: ${e.message}`)
                        );
                        break;
                    }
                }

                if (await stopIfLocked(page, email, 'after switching business account')) {
                    return;
                }
            } catch (error) {
                console.error(`[${batchIndex + 1}] Lỗi khi chọn account business: ${error.message}`);
                console.app(`[${batchIndex + 1}] Lỗi khi chọn account business: ${error.message}`);
            }
            try {
                console.log(`[${batchIndex + 1}] Đang tìm nút Complete registration`);
                if (await stopIfLocked(page, email, 'before business registration check')) {
                    return;
                }

                // Check if "Complete registration" button exists
                const completeRegButton = await page.evaluate(() => {
                    const elements = [
                        document.querySelector('[data-testid="Primary.REGISTRATION_START_COMPLETE_REGISTRATION.redirect"]'),
                        Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Complete registration'))
                    ].filter(Boolean);
                    return elements.length > 0;
                });
                if (completeRegButton) {
                    console.log(`[${batchIndex + 1}] Đang bấm nút Complete registration`);
                    await Promise.all([
                        page.waitForNavigation({ timeout: 30000 }).catch(e =>
                            console.log(`[${batchIndex + 1}] Chờ chuyển trang sau khi bấm bị timeout: ${e.message}`)
                        ),
                        page.click('[data-testid="Primary.REGISTRATION_START_COMPLETE_REGISTRATION.redirect"]').catch(() =>
                            page.evaluate(() => {
                                const buttons = Array.from(document.querySelectorAll('button'));
                                const button = buttons.find(el => el.textContent.includes('Complete registration'));
                                if (button) button.click();
                            })
                        )
                    ]);
                    console.log(`[${batchIndex + 1}] Đã bấm nút Complete registration`);

                    if (await stopIfLocked(page, email, 'after complete registration click')) {
                        return;
                    }
                } else {
                    if (await stopIfLocked(page, email, 'before already-selected card flow')) {
                        return;
                    }

                    console.log(`Account business đã được chọn cho ${email}, tiếp tục sang flow thẻ`);
                    console.app(`Account business đã được chọn cho ${email}, tiếp tục sang flow thẻ`);
                    addBusinessAccount(email);
                    await runBusinessAddressFlow(page, email);
                    await clickStartBrowsingIfPresent(page, email);
                    await runBusinessCardFlow(page, email);
                    return;
                }
            } catch (error) {
                throw new Error(error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).fillInfo(page, loginForm);
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).finalSetup(page, loginForm);
        }

        if (await stopIfLocked(page, email, 'after business setup')) {
            return;
        }

        console.log(`[${batchIndex + 1}] Đã hoàn tất setup account business cho: ${email}`);
        console.app(`[${batchIndex + 1}] Đã hoàn tất setup account business cho: ${email}`);

        // ✅ ADD TO DATA.JSON - SIMPLE FORMAT
        addBusinessAccount(email);
        await runBusinessAddressFlow(page, email);
        await clickStartBrowsingIfPresent(page, email);
        await runBusinessCardFlow(page, email);

    } catch (error) {
        if (String(error.message || '').includes('ACCOUNT_LOCKED') || String(error.message || '').includes('account-status') || await isAccountLockedPage(page)) {
            markLockedAccount(email, 'ACCOUNT_LOCKED');
            console.app(`Phát hiện account bị khóa: ${email}`);
            return;
        }

        if (error.message.includes("ACCOUNT_ALREADY_BUSINESS") && page && !page.isClosed()) {
            console.log(`Account business đã có sẵn cho ${email}, tiếp tục sang flow thẻ`);
            console.app(`Account business đã có sẵn cho ${email}, tiếp tục sang flow thẻ`);
            addBusinessAccount(email);
            await runBusinessAddressFlow(page, email);
            await clickStartBrowsingIfPresent(page, email);
            await runBusinessCardFlow(page, email);
            return;
        }

        if (error.message.includes("Navigating frame was detached")) {
            console.log(`[${batchIndex + 1}] Đã hoàn tất setup account business cho: ${email} (frame bị detach, khả năng đã thành công)`);
            console.app(`[${batchIndex + 1}] Đã hoàn tất setup account business cho: ${email} (frame bị detach, khả năng đã thành công)`); 
            
            // ✅ ADD TO DATA.JSON - SIMPLE FORMAT
            addBusinessAccount(email);
            if (page && !page.isClosed()) {
                await runBusinessAddressFlow(page, email);
                await clickStartBrowsingIfPresent(page, email);
                await runBusinessCardFlow(page, email);
            }
            
        } else if (error.message.includes("ACCOUNT_ALREADY_BUSINESS")) {
            console.log(`[${batchIndex + 1}] Account đã là business: ${email}`);
            console.app(`[${batchIndex + 1}] Account đã là business: ${email}`);
            
            // ✅ ADD TO DATA.JSON - SIMPLE FORMAT
            addBusinessAccount(email);
            
        } else {
            console.error(`[${batchIndex + 1}] Lỗi khi login ${email}:`, error.message);
            console.app(`[${batchIndex + 1}] Lỗi khi login ${email}: ${error.message}`);
        }
    } finally {
        // Close browser
        if (browser) {
            try {
                await browser.close();
                // Remove from active browsers list
                const index = activeBrowsers.indexOf(browser);
                if (index > -1) {
                    activeBrowsers.splice(index, 1);
                }
                console.log(`[${batchIndex + 1}] Đã đóng trình duyệt cho: ${email}`);
            } catch (closeError) {
                console.error(`[${batchIndex + 1}] Lỗi khi đóng trình duyệt cho ${email}:`, closeError.message);
            }
        }
    }
}

/**
 * Helper function to randomly select an item from array
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Cleanup function to close all browsers
 */
async function cleanup() {
    console.log("Đang dọn dẹp các trình duyệt...");
    console.app("Đang dọn dẹp các trình duyệt...");

    const closePromises = activeBrowsers.map(async (browser) => {
        try {
            await browser.close();
        } catch (error) {
            console.error("Lỗi khi đóng trình duyệt:", error);
        }
    });

    await Promise.allSettled(closePromises);
    activeBrowsers = [];

    console.log("Đã dọn dẹp xong!");
    console.app("Đã dọn dẹp xong!");
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log("\nTiến trình bị ngắt. Đang dọn dẹp...");
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log("\nTiến trình đã dừng. Đang dọn dẹp...");
    await cleanup();
    process.exit(0);
});

async function waitForPageLoad(page, timeout = 30000) {
    try {
        console.log('Đang chờ trang tải xong...');
        
        // Wait for document ready state
        await page.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });
        });
        
        await page.waitForNavigation({ 
            waitUntil: 'networkidle0', 
            timeout 
        }).catch(() => {
            console.log('Chờ network idle bị timeout, vẫn tiếp tục...');
        });
        
        // Additional wait for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('Trang đã tải xong');
        
    } catch (error) {
        console.log(`Chờ tải trang bị timeout: ${error.message}, vẫn tiếp tục...`);
        
        // Fallback: just wait for document ready state
        await page.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });
        });
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

module.exports = updateBusiness;
