const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
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
        console.log(`Error loading business accounts: ${error.message}`);
    }
    return [];
}

// ⭐ CHECK IF ACCOUNT SHOULD BE SKIPPED
function shouldSkipBusinessUpgrade(email) {
    const businessAccounts = loadBusinessAccounts();
    const isAlreadyBusiness = businessAccounts.includes(email);
    
    if (isAlreadyBusiness) {
        console.log(`Business account exists for ${email}, selecting Business account and continuing`);
        console.app(`Business account exists for ${email}, selecting Business account and continuing`);
        return false;
    }
    
    return false;
}

// Validate proxy count
if (proxies.length === 0) {
    console.log("⚠️ Warning: No proxies found in proxies.txt, running without proxy");
    console.app("⚠️ Warning: No proxies found in proxies.txt, running without proxy");
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
        console.app(`Could not save locked account to data.json: ${error.message}`);
    }

    try {
        const existing = fs.existsSync(lockedPath) ? fs.readFileSync(lockedPath, 'utf8') : '';
        if (!existing.includes(email)) {
            fs.appendFileSync(lockedPath, `${new Date().toISOString()}: ${email} - ${reason} - AUTO_DETECTED\n`, 'utf8');
        }
    } catch (error) {
        console.app(`Could not write locked account: ${error.message}`);
    }
}

async function stopIfLocked(page, email, context = '') {
    if (!(await isAccountLockedPage(page))) return false;

    markLockedAccount(email, 'ACCOUNT_LOCKED');
    console.app(`Account locked detected${context ? ` ${context}` : ''}: ${email}`);
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
                console.log(`Clicked Start browsing for ${email}`);
                console.app(`Clicked Start browsing for ${email}`);
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

    console.log(`Start browsing button not found for ${email}, continuing to card flow`);
    console.app(`Start browsing button not found for ${email}, continuing to card flow`);
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
        console.log(`WARN Could not return to wallet: ${error.message}`);
    }
}

async function runBusinessCardFlow(page, email) {
    if (await stopIfLocked(page, email, 'before card flow')) {
        return;
    }

    if (sharedCardQueue.remainingCount() === 0) {
        console.log(`No shared cards available for ${email}`);
        console.app(`No shared cards available for ${email}`);
        return;
    }

    const addCard = require(path.join(__dirname, '..', 'api', 'addCard.js'));
    let liveCount = 0;
    let dieCount = 0;

    await returnToWallet(page);

    while (true) {
        if (!page || page.isClosed()) {
            console.app(`Page closed for ${email}, stop claiming shared cards`);
            break;
        }

        const card = sharedCardQueue.claimNextCard(email);
        if (!card) {
            console.log(`No more shared cards for ${email}`);
            console.app(`No more shared cards for ${email}`);
            break;
        }

        const form = {
            number: card.number,
            month: card.month,
            year: card.year,
            name: card.name,
            cvc: card.cvc
        };

        console.log(`Business shared card ***${card.number.slice(-4)} for ${email}`);
        console.app(`Business shared card ***${card.number.slice(-4)} for ${email}`);

        const res = await addCard(page, form);
        if (res.success) {
            liveCount++;
            appendCardResult('live', card, email);
            console.log(`LIVE business card ***${card.number.slice(-4)} for ${email}`);
            console.app(`LIVE business card ***${card.number.slice(-4)} for ${email}`);
        } else {
            const reason = res.step || res.error ? ` (${res.step || 'unknown_step'}: ${res.error || 'unknown_error'})` : '';
            dieCount++;
            appendCardResult('die', card, email, reason.replace(/^\s*\(|\)\s*$/g, ''));
            console.log(`DIE business card ***${card.number.slice(-4)} for ${email}${reason}`);
            console.app(`DIE business card ***${card.number.slice(-4)} for ${email}${reason}`);

            const fatalReason = `${res.step || ''} ${res.error || ''}`.toLowerCase();
            if (fatalReason.includes('page_closed') || fatalReason.includes('detached frame') || fatalReason.includes('session closed')) {
                console.app(`Fatal page/frame error for ${email}, stop claiming shared cards`);
                break;
            }
        }

        await returnToWallet(page);
    }

    console.log(`Business card flow completed for ${email}: ${liveCount} live, ${dieCount} die`);
    console.app(`Business card flow completed for ${email}: ${liveCount} live, ${dieCount} die`);
}

async function runBusinessAddressFlow(page, email) {
    if (!global.data.settings.addAddress) {
        console.app(`Skip business address for ${email}`);
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
        console.log(`Business address flow completed for ${email}`);
        console.app(`Business address flow completed for ${email}`);
    } catch (error) {
        console.log(`Business address flow failed for ${email}: ${error.message}`);
        console.app(`Business address flow failed for ${email}: ${error.message}`);
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
            console.log(`✅ Added ${email} to business accounts list`);
            console.app(`✅ Added ${email} to business accounts list`);
            
            // Save data immediately
            fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
            return true;
        } else {
            console.log(`ℹ️ ${email} already in business accounts list`);
            console.app(`ℹ️ ${email} already in business accounts list`);
            return false;
        }
        
    } catch (error) {
        console.error(`❌ Error adding business account ${email}:`, error.message);
        console.app(`❌ Error adding business account ${email}: ${error.message}`);
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
    
    console.log(`🖥️ Max concurrent Chrome: ${maxConcurrentWindows}`);
    console.app(`🖥️ Max concurrent Chrome: ${maxConcurrentWindows}`);
    console.app("🚀 Starting Business Account Registration Process...");
    console.log("🚀 Starting Business Account Registration Process...");

    const startupCardPath = path.join(__dirname, '..', 'data', 'card.txt');
    const startupCardLines = fs.existsSync(startupCardPath)
        ? fs.readFileSync(startupCardPath, 'utf8').replace(/\r/g, '').split('\n').map(v => v.trim()).filter(Boolean)
        : [];
    sharedCardQueue.initialize(startupCardLines, true);
    if (console.card && typeof console.card.setTotal === 'function') {
        console.card.setTotal(startupCardLines.length);
    }
    if (sharedCardQueue.remainingCount() === 0) {
        console.app('No unclaimed cards available. Clear src/data/checkcard.txt if you want to run these cards again.');
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
            console.app(`Skip locked account: ${email}`);
            skippedCount++;
        } else if (!shouldSkipBusinessUpgrade(email)) {
            accountsToProcess.push(accountLine);
        } else {
            skippedCount++;
        }
    }

    console.log(`📊 Business Login Status:`);
    console.log(`📧 Total accounts: ${childAccounts.length}`);
    console.log(`🏢 Already business: ${businessAccounts.length}`);
    console.log(`⏭️ Skipped: ${skippedCount}`);
    console.log(`🔄 To process: ${accountsToProcess.length}`);
    console.app(`Total: ${childAccounts.length}, Already business: ${businessAccounts.length}, Skipped: ${skippedCount}, To process: ${accountsToProcess.length}`);

    if (accountsToProcess.length === 0) {
        console.log('✅ All accounts are already business accounts');
        console.app('✅ All accounts are already business accounts');
        return;
    }

    // Process remaining accounts
    const workerCount = Math.min(maxConcurrentWindows, accountsToProcess.length);
    console.log(`\nStarting ${workerCount} worker(s) for ${accountsToProcess.length} account(s)`);
    console.app(`Starting ${workerCount} worker(s) for ${accountsToProcess.length} account(s)`);

    const workers = Array.from({ length: workerCount }, (_, workerIndex) =>
        processBusinessWorker(workerIndex + 1, accountsToProcess)
    );

    await Promise.allSettled(workers);

    console.log("All business logins completed!");
    console.app("All business logins completed!");
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

        console.app(`Worker ${workerId}: starting account ${accountIndex + 1}/${accountsToProcess.length}: ${email}`);

        try {
            await processAccount(account, accountIndex);
        } catch (error) {
            console.error(`Worker ${workerId} error processing account ${email}:`, error.message);
            console.app(`Worker ${workerId} error processing account ${email}: ${error.message}`);
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
        console.log(`⚠️ Invalid account data: ${accountLine}`);
        console.app(`⚠️ Invalid account data: ${accountLine}`);
        return;
    }

    let browser = null;
    let page = null;

    try {
        console.log(`🌐 [${batchIndex + 1}] Starting login for: ${email}`);
        console.app(`🌐 [${batchIndex + 1}] Starting login for: ${email}`);

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
            console.log(`🌐 [${batchIndex + 1}] Using proxy: ${host}:${port} for ${email}`);
            console.app(`🌐 [${batchIndex + 1}] Using proxy: ${host}:${port} for ${email}`);
            currentProxyIndex++;
        } else {
            console.log(`🌐 [${batchIndex + 1}] No proxy available, using direct connection for ${email}`);
            console.app(`🌐 [${batchIndex + 1}] No proxy available, using direct connection for ${email}`);
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

        // Launch browser with positioned window
        const launchOptions = {
            headless: !global.data.settings.showBrowser,
            userDataDir,
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
        console.log(`🔐 [${batchIndex + 1}] Attempting business login for: ${email}`);
        console.app(`🔐 [${batchIndex + 1}] Attempting business login for: ${email}`);

        await require(path.join(__dirname, "..", "api", "business", "login.js"))(page, loginForm);

        await new Promise(resolve => setTimeout(resolve, 1500));
        if (await isAccountLockedPage(page)) {
            markLockedAccount(email, 'ACCOUNT_LOCKED');
            console.app(`Account locked detected after login: ${email}`);
            return;
        }

        console.log(`✅ [${batchIndex + 1}] Successfully logged in: ${email}`);
        console.app(`✅ [${batchIndex + 1}] Successfully logged in: ${email}`);

        // Check if page have elements id 'cvf-filtered-account-switcher-header-text' is exists
        await new Promise(resolve => setTimeout(resolve, 5000));
        const accountSwitcherHeader = await page.evaluate(() => {
            return !!document.querySelector('#cvf-filtered-account-switcher-header-text');
        });

        if (!accountSwitcherHeader) {
            console.log(`🔄 [${batchIndex + 1}] Continuing login for: ${email}`)
            console.app(`🔄 [${batchIndex + 1}] Continuing login for: ${email}`);
            try {
                await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).continueLogin(page, loginForm);
            } catch (error) {
                throw new Error(`This account is already registered or has an error: ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).fillInfo(page, loginForm);
            await require(path.join(__dirname, "..", "api", "business", "fillInfo.js")).finalSetup(page, loginForm);
        } else {
            console.log(`🔄 [${batchIndex + 1}] Account switcher header found, selecting business account...`)
            console.app(`🔄 [${batchIndex + 1}] Account switcher header found, selecting business account...`);
            try {
                await page.waitForSelector('[data-test-id="accountType"]', { timeout: 10000 });
                const businessAccounts = await page.$$('[data-test-id="accountType"]');

                for (const account of businessAccounts) {
                    const text = await page.evaluate(el => el.textContent, account);
                    if (text.includes('Business account')) {
                        await account.click();

                        await page.waitForNavigation({ timeout: 30000 }).catch(e =>
                            console.log(`⚠️ [${batchIndex + 1}] Navigation timeout after clicking business account: ${e.message}`)
                        );
                        break;
                    }
                }

                if (await stopIfLocked(page, email, 'after switching business account')) {
                    return;
                }
            } catch (error) {
                console.error(`❌ [${batchIndex + 1}] Error selecting business account: ${error.message}`);
                console.app(`❌ [${batchIndex + 1}] Error selecting business account: ${error.message}`);
            }
            try {
                console.log(`🔍 [${batchIndex + 1}] Looking for Complete registration button`);
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
                    console.log(`🖱️ [${batchIndex + 1}] Clicking Complete registration button`);
                    await Promise.all([
                        page.waitForNavigation({ timeout: 30000 }).catch(e =>
                            console.log(`⚠️ [${batchIndex + 1}] Navigation timeout after clicking: ${e.message}`)
                        ),
                        page.click('[data-testid="Primary.REGISTRATION_START_COMPLETE_REGISTRATION.redirect"]').catch(() =>
                            page.evaluate(() => {
                                const buttons = Array.from(document.querySelectorAll('button'));
                                const button = buttons.find(el => el.textContent.includes('Complete registration'));
                                if (button) button.click();
                            })
                        )
                    ]);
                    console.log(`✓ [${batchIndex + 1}] Clicked Complete registration button`);

                    if (await stopIfLocked(page, email, 'after complete registration click')) {
                        return;
                    }
                } else {
                    if (await stopIfLocked(page, email, 'before already-selected card flow')) {
                        return;
                    }

                    console.log(`Business account already selected for ${email}, continuing to card flow`);
                    console.app(`Business account already selected for ${email}, continuing to card flow`);
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

        console.log(`✅ [${batchIndex + 1}] Business account setup completed for: ${email}`);
        console.app(`✅ [${batchIndex + 1}] Business account setup completed for: ${email}`);

        // ✅ ADD TO DATA.JSON - SIMPLE FORMAT
        addBusinessAccount(email);
        await runBusinessAddressFlow(page, email);
        await clickStartBrowsingIfPresent(page, email);
        await runBusinessCardFlow(page, email);

    } catch (error) {
        if (String(error.message || '').includes('ACCOUNT_LOCKED') || String(error.message || '').includes('account-status') || await isAccountLockedPage(page)) {
            markLockedAccount(email, 'ACCOUNT_LOCKED');
            console.app(`Account locked detected: ${email}`);
            return;
        }

        if (error.message.includes("ACCOUNT_ALREADY_BUSINESS") && page && !page.isClosed()) {
            console.log(`Business account already available for ${email}, continuing to card flow`);
            console.app(`Business account already available for ${email}, continuing to card flow`);
            addBusinessAccount(email);
            await runBusinessAddressFlow(page, email);
            await clickStartBrowsingIfPresent(page, email);
            await runBusinessCardFlow(page, email);
            return;
        }

        if (error.message.includes("Navigating frame was detached")) {
            console.log(`✅ [${batchIndex + 1}] Business account setup completed for: ${email} (frame detached - likely success)`);
            console.app(`✅ [${batchIndex + 1}] Business account setup completed for: ${email} (frame detached - likely success)`); 
            
            // ✅ ADD TO DATA.JSON - SIMPLE FORMAT
            addBusinessAccount(email);
            if (page && !page.isClosed()) {
                await runBusinessAddressFlow(page, email);
                await clickStartBrowsingIfPresent(page, email);
                await runBusinessCardFlow(page, email);
            }
            
        } else if (error.message.includes("ACCOUNT_ALREADY_BUSINESS")) {
            console.log(`✅ [${batchIndex + 1}] Account is already a business account: ${email}`);
            console.app(`✅ [${batchIndex + 1}] Account is already a business account: ${email}`);
            
            // ✅ ADD TO DATA.JSON - SIMPLE FORMAT
            addBusinessAccount(email);
            
        } else {
            console.error(`❌ [${batchIndex + 1}] Error logging in ${email}:`, error.message);
            console.app(`❌ [${batchIndex + 1}] Error logging in ${email}: ${error.message}`);
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
                console.log(`🚪 [${batchIndex + 1}] Browser closed for: ${email}`);
            } catch (closeError) {
                console.error(`⚠️ [${batchIndex + 1}] Error closing browser for ${email}:`, closeError.message);
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
    console.log("🧹 Cleaning up browsers...");
    console.app("🧹 Cleaning up browsers...");

    const closePromises = activeBrowsers.map(async (browser) => {
        try {
            await browser.close();
        } catch (error) {
            console.error("Error closing browser:", error);
        }
    });

    await Promise.allSettled(closePromises);
    activeBrowsers = [];

    console.log("✅ Cleanup completed!");
    console.app("✅ Cleanup completed!");
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log("\n🛑 Process interrupted. Cleaning up...");
    await cleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log("\n🛑 Process terminated. Cleaning up...");
    await cleanup();
    process.exit(0);
});

async function waitForPageLoad(page, timeout = 30000) {
    try {
        console.log('🔄 Waiting for page to load completely...');
        
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
            console.log('⚠️ Network idle timeout, continuing anyway...');
        });
        
        // Additional wait for any dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('✅ Page loaded successfully');
        
    } catch (error) {
        console.log(`⚠️ Page load timeout: ${error.message}, continuing anyway...`);
        
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
