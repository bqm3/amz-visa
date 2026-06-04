const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');
const windowManager = require('./windowManager');
const cardTracker = require('./cardTracker');

const dataDir = path.join(__dirname, '..', 'data');
const dataFilePath = path.join(dataDir, 'data.json');
const checkCardFilePath = path.join(dataDir, 'checkcard.txt');
const lockedAccountsFilePath = path.join(dataDir, 'locked_accounts.txt');

let data = {};
try {
    data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
} catch (e) {
    data = {};
}

let listChild = [];
let listCards = [];
let listProxy = [];
let totalCards = 0;
let binCache = {};

// Shared card queue - all Chrome instances take cards from the same queue sequentially
let sharedCardQueue = [];   // Single shared card list
let checkedCardsSet = new Set(); // In-memory set of cards already in checkcard.txt
let accountQueue = [];     // Shared account queue (all accounts)
let accountQueueIndex = 0; // Next account to assign

function parseCardLine(card) {
    const parts = String(card || '').trim().split('|').map(v => v.trim());
    if (parts.length < 4 || !parts[0]) return null;

    const number = parts[0].replace(/\D/g, '');
    if (!number) return null;

    const monthNumber = Number(parts[1]);
    const month = Number.isFinite(monthNumber) && monthNumber > 0
        ? String(monthNumber).padStart(2, '0')
        : parts[1];
    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
    const cvc = parts[3];

    return {
        number,
        month,
        year,
        cvc,
        name: parts[4] || 'Saint David',
        key: `${number}|${month}|${year}|${cvc}`,
        raw: String(card || '').trim()
    };
}

function getCardKey(card) {
    const parsed = parseCardLine(card);
    return parsed ? parsed.key : String(card || '').trim();
}

function getCardLast4(card) {
    const parsed = parseCardLine(card);
    if (parsed) return parsed.number.slice(-4);
    return String(card || '').split('|')[0].replace(/\D/g, '').slice(-4);
}

function saveDataNow() {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadLockedAccountEmails() {
    const lockedAccounts = new Set();

    if (data.lockedAccounts) {
        Object.keys(data.lockedAccounts).forEach(email => lockedAccounts.add(email));
    }

    try {
        if (fs.existsSync(lockedAccountsFilePath)) {
            const content = fs.readFileSync(lockedAccountsFilePath, 'utf8');
            content.replace(/\r/g, '').split('\n').forEach(line => {
                const match = line.match(/:\s*([^\s]+@[^\s]+)\s*-/) || line.match(/^([^\s|:]+@[^\s|:]+)/);
                if (match) lockedAccounts.add(match[1].trim());
            });
        }
    } catch (e) {
        console.log(`Could not load locked_accounts.txt: ${e.message}`);
    }

    return lockedAccounts;
}

function markAccountLocked(email, reason = 'ACCOUNT_LOCKED') {
    if (!email) return;

    if (!data.lockedAccounts) data.lockedAccounts = {};
    data.lockedAccounts[email] = { lockedAt: Date.now(), reason };

    try {
        saveDataNow();
    } catch (e) {
        console.log(`Could not save locked account to data.json: ${e.message}`);
    }

    try {
        const existing = fs.existsSync(lockedAccountsFilePath)
            ? fs.readFileSync(lockedAccountsFilePath, 'utf8')
            : '';
        if (!existing.includes(email)) {
            fs.appendFileSync(lockedAccountsFilePath, `${new Date().toISOString()}: ${email} - ${reason} - AUTO_DETECTED\n`, 'utf8');
        }
    } catch (e) {
        console.log(`Could not write locked account: ${e.message}`);
    }
}

function isAccountLockedError(error) {
    const message = String(error && (error.message || error.error || error) || '');
    return message.includes('ACCOUNT_LOCKED') || message.includes('account-status.amazon.com');
}

async function isAccountLockedPage(page) {
    try {
        if (!page || page.isClosed()) return false;
        if (page.url().includes('account-status.amazon.com')) return true;
        return await page.evaluate(() => {
            const text = (document.body && document.body.innerText || '').toLowerCase();
            return text.includes('account locked temporarily') ||
                text.includes('your account has been locked') ||
                text.includes('account has been locked') ||
                text.includes('account on hold') ||
                text.includes('your account is currently under review');
        });
    } catch (e) {
        return false;
    }
}

async function closeBrowserSafe(browser) {
    try {
        if (browser) await browser.close();
    } catch (e) {}
}

async function switchToNextAccount(chromeIndex, browser, proxy, delay = 5000) {
    await closeBrowserSafe(browser);
    const nextAcc = getNextAccount();
    if (nextAcc) {
        console.app(`Chrome ${chromeIndex + 1}: Switching to next account...`);
        setTimeout(() => startAccountSession(chromeIndex, nextAcc, proxy), delay);
    } else {
        console.app(`Chrome ${chromeIndex + 1}: No more accounts available`);
    }
}

/**
 * Load checkcard.txt into memory Set for fast lookup
 */
function loadCheckCardFile() {
    checkedCardsSet.clear();
    try {
        if (fs.existsSync(checkCardFilePath)) {
            const content = fs.readFileSync(checkCardFilePath, 'utf8');
            const lines = content.replaceAll('\r', '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
            lines.forEach(line => {
                checkedCardsSet.add(line);
                checkedCardsSet.add(getCardKey(line));
            });
            console.log(`📋 Loaded ${checkedCardsSet.size} cards from checkcard.txt`);
        }
    } catch (e) {
        console.log(`⚠️ Could not load checkcard.txt: ${e.message}`);
    }
}

/**
 * Check if a card is already in checkcard.txt
 */
function isCardInCheckFile(card) {
    const cardKey = getCardKey(card);
    return checkedCardsSet.has(cardKey);
}

/**
 * Write a card to checkcard.txt (append) and add to memory Set
 */
function writeCardToCheckFile(card) {
    const cardKey = getCardKey(card);
    if (checkedCardsSet.has(cardKey)) return; // Already exists
    checkedCardsSet.add(cardKey);
    try {
        fs.appendFileSync(checkCardFilePath, cardKey + '\n', 'utf8');
        console.app(`CLAIM card ***${getCardLast4(card)} -> checkcard.txt`);
    } catch (e) {
        console.log(`⚠️ Could not write to checkcard.txt: ${e.message}`);
    }
}

/**
 * Get the next card from the shared queue.
 * Skips cards that are already in checkcard.txt.
 * Returns null if no more cards available.
 */
function getNextCard() {
    while (sharedCardQueue.length > 0) {
        const card = sharedCardQueue.shift();
        
        // Check if card already in checkcard.txt → skip
        if (isCardInCheckFile(card)) {
            console.log(`Card ***${getCardLast4(card)} already in checkcard.txt, skipping`);
            continue;
        }
        
        // Skip already processed cards (from cardTracker)
        if (cardTracker.isProcessed(card)) {
            console.log(`Card ***${getCardLast4(card)} already processed, skipping`);
            continue;
        }
        
        // Card is available - write to checkcard.txt to "claim" it
        writeCardToCheckFile(card);
        return card;
    }
    return null; // No more cards
}

async function checkCard() {
    // ✅ READ CONFIG FROM global.uiConfig (set by Apply Config button)
    let numChrome = 1;

    if (global.uiConfig) {
        numChrome = global.uiConfig.numChrome || 1;
        listChild = global.uiConfig.accounts || [];
        listCards = global.uiConfig.cards || [];
        console.log(`📋 Using UI config: ${numChrome} Chrome, ${listChild.length} accounts, ${listCards.length} cards`);
    } else {
        // Fallback: read from files
        try {
            listChild = fs.readFileSync(path.join(__dirname, "..", "data", 'acc.txt'), 'utf8')
                .replaceAll("\r", '').split("\n").map(l => l.trim()).filter(l => l.length > 0);
        } catch (e) {
            console.log(`❌ Could not load acc.txt: ${e.message}`);
            listChild = [];
        }
        try {
            listCards = fs.readFileSync(path.join(__dirname, "..", "data", 'card.txt'), 'utf8')
                .replaceAll("\r", '').split("\n").map(l => l.trim()).filter(l => l.length > 0);
        } catch (e) {
            console.log(`❌ Could not load card.txt: ${e.message}`);
            listCards = [];
        }
    }

    if (!listChild.length) {
        console.app("❌ No accounts found");
        return;
    }
    if (!listCards.length) {
        console.app("❌ No cards found");
        return;
    }

    // ✅ Filter out locked accounts
    const lockedAccounts = loadLockedAccountEmails();

    const availableAccounts = listChild.filter(acc => {
        const email = acc.split('|')[0].trim();
        return !lockedAccounts.has(email);
    });

    console.log(`🔒 Accounts: ${availableAccounts.length} available, ${listChild.length - availableAccounts.length} locked`);
    console.app(`🔒 Accounts: ${availableAccounts.length} available, ${listChild.length - availableAccounts.length} locked`);

    if (!availableAccounts.length) {
        console.app("❌ No available (non-locked) accounts");
        return;
    }

    // ✅ Setup shared account queue
    accountQueue = [...availableAccounts];
    accountQueueIndex = 0;

    // ✅ Load checkcard.txt to know which cards are already processed
    loadCheckCardFile();

    // ✅ Setup shared card queue - all Chrome instances share one queue
    sharedCardQueue = [...listCards];

    console.log(`📋 Shared card queue: ${sharedCardQueue.length} total cards`);
    console.app(`📋 Shared card queue: ${sharedCardQueue.length} total cards, ${checkedCardsSet.size} already checked`);

    // Load proxies
    try {
        listProxy = fs.readFileSync(path.join(__dirname, "..", "data", 'proxies.txt'), 'utf8')
            .replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);
    } catch (err) {
        console.log(`⚠️ Could not load proxies.txt: ${err.message}`);
        listProxy = [];
    }

    // Set total card count
    totalCards = listCards.length;
    if (!global.data) {
        global.data = {};
    }
    global.data.cardTotal = totalCards;

    if (console.card && typeof console.card.setTotal === 'function') {
        console.card.setTotal(totalCards);
    }

    !data.childCount ? data.childCount = {} : "";
    !global.temp ? global.temp = {} : "";
    !global.temp.checkCard ? global.temp.checkCard = {} : "";

    // ✅ RESET WINDOW POSITIONS AT START
    windowManager.reset();

    console.app(`🚀 Starting card check: ${totalCards} cards across ${numChrome} Chrome instances`);

    // ✅ CREATE CHROME INSTANCES - all share the same card queue
    for (let i = 0; i < numChrome; i++) {
        let proxy = null;
        if (listProxy.length) {
            const proxyIndex = i % listProxy.length;
            const proxyLine = listProxy[proxyIndex];
            let [host, port, user, pass] = proxyLine.split(':');
            proxy = { host, port, user, pass };
            console.log(`🔗 Chrome ${i + 1}: Using proxy index ${proxyIndex + 1}`);
        }

        launchChromeInstance(i, proxy);
    }
}

/**
 * Get the next available account from shared queue
 * Returns null if no more accounts available
 */
function getNextAccount() {
    if (accountQueueIndex >= accountQueue.length) {
        return null; // No more accounts
    }
    const account = accountQueue[accountQueueIndex];
    accountQueueIndex++;
    return account;
}

/**
 * Re-add an account to the end of the queue (for reuse after completing cards)
 */
function recycleAccount(accountStr) {
    accountQueue.push(accountStr);
}

/**
 * Launch a Chrome instance with its own card queue
 * When account is locked, gets next account from shared queue
 */
async function launchChromeInstance(chromeIndex, proxy) {
    const accountStr = getNextAccount();
    if (!accountStr) {
        console.app(`❌ Chrome ${chromeIndex + 1}: No accounts available`);
        return;
    }

    await startAccountSession(chromeIndex, accountStr, proxy);
}

/**
 * Start a session with a specific account on a Chrome instance
 * This handles login → clear cards → process card queue
 * WRAPPED in top-level try/catch to prevent Chrome crash
 */
async function startAccountSession(chromeIndex, accountStr, proxy, retryCount = 0) {
    const MAX_RETRIES = 3; // Max retries per Chrome instance before giving up
    let browser = null;

    try {
    let [email, pass, secret] = accountStr.split("|");

    if (data.childCount[email] >= 80) {
        console.app(`⏭️ Chrome ${chromeIndex + 1}: Max cards reached for ${email}, trying next account`);
        const nextAcc = getNextAccount();
        if (nextAcc) {
            return startAccountSession(chromeIndex, nextAcc, proxy, 0);
        } else {
            console.app(`❌ Chrome ${chromeIndex + 1}: No more accounts available`);
            return;
        }
    }

    console.log(`🔐 Chrome ${chromeIndex + 1}: Starting session for ${email} (${data.childCount[email] || 0}/80)`);
    console.app(`🔐 Chrome ${chromeIndex + 1}: ${email} (${data.childCount[email] || 0}/80)`);

    const windowPosition = windowManager.getNextPosition();

    if (!global.data.settings) {
        global.data.settings = {};
    }
    if (!global.data.parentAcc) {
        global.data.parentAcc = {};
    }

    if (proxy) {
        console.log(`🌐 Chrome ${chromeIndex + 1}: Testing proxy ${proxy.user}@${proxy.host}:${proxy.port}`);
    }

    const userDataDir = path.join(dataDir, 'chrome-profiles', `scan-${Date.now()}-${chromeIndex + 1}-${Math.random().toString(16).slice(2)}`);
    const defaultProfileDir = path.join(userDataDir, 'Default');
    fs.mkdirSync(defaultProfileDir, { recursive: true });
    fs.writeFileSync(path.join(defaultProfileDir, 'Preferences'), JSON.stringify({
        credentials_enable_service: false,
        profile: {
            password_manager_enabled: false,
            password_manager_leak_detection: false,
            default_content_setting_values: {
                notifications: 2
            }
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

    const launchOptions = {
        headless: !global.data.settings.showBrowser && global.data.parentAcc.geminiKey != "",
        timeout: 60000,
        userDataDir,
        prefs: {
            credentials_enable_service: false,
            'profile.password_manager_enabled': false,
            'profile.password_manager_leak_detection': false,
            'autofill.profile_enabled': false,
            'autofill.credit_card_enabled': false,
            'autofill.credit_card_fido_auth_enabled': false,
            'payments.can_make_payment_enabled': false,
            'profile.default_content_setting_values.notifications': 2
        },
        args: [
            ...(proxy ? [`--proxy-server=${proxy.host}:${proxy.port}`] : []),
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--ignore-certificate-errors',
            '--disable-infobars',
            `--window-position=${windowPosition.x},${windowPosition.y}`,
            `--window-size=${windowPosition.width},${windowPosition.height}`,
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gpu',
            '--disable-save-password-bubble',
            '--disable-autofill-keyboard-accessory-view',
            '--disable-autofill-keyboard-accessory',
            '--disable-autofill-type-predictions',
            '--disable-translate',
            '--disable-features=VizDisplayCompositor,AutofillServerCommunication,AutofillEnableAccountWalletStorage,PasswordManagerOnboarding,PasswordManagerSettingsMigration',
            '--disable-password-generation',
            '--disable-password-manager-reauthentication',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--proxy-bypass-list=<-loopback>',
            '--disable-proxy-certificate-handler',
            '--ignore-ssl-errors',
            '--ignore-certificate-errors-spki-list',
            '--ignore-ssl-errors-list',
            '--allow-running-insecure-content'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    };

    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (launchError) {
        if (String(launchError.message || '').includes('Could not find Chrome')) {
            const installedChrome = puppeteer.executablePath();
            console.log(`⚠️ Chrome ${chromeIndex + 1}: Retrying with executablePath: ${installedChrome}`);
            browser = await puppeteer.launch({
                ...launchOptions,
                executablePath: installedChrome
            });
        } else {
            console.app(`❌ Chrome ${chromeIndex + 1}: Launch failed - ${launchError.message}`);
            // Try next account
            const nextAcc = getNextAccount();
            if (nextAcc) {
                setTimeout(() => startAccountSession(chromeIndex, nextAcc, proxy), 5000);
            }
            return;
        }
    }

    const page = await browser.newPage();
    
    await page.setViewport({
        width: windowPosition.width - 20,
        height: windowPosition.height - 100
    });

    if (proxy && proxy.user && proxy.pass) {
        await page.authenticate({
            username: proxy.user,
            password: proxy.pass
        });
    }

    await page.setDefaultNavigationTimeout(90000);
    await page.setDefaultTimeout(90000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Test proxy
    if (proxy) {
        try {
            await page.goto('https://httpbin.org/ip', { waitUntil: 'networkidle2', timeout: 30000 });
            const proxyIP = await page.evaluate(() => {
                try { return JSON.parse(document.body.innerText).origin; } catch { return 'Unknown'; }
            });
            console.app(`✅ Chrome ${chromeIndex + 1}: Proxy IP: ${proxyIP}`);
        } catch (proxyTestError) {
            console.app(`❌ Chrome ${chromeIndex + 1}: Proxy failed for ${email}`);
            await browser.close();
            const nextAcc = getNextAccount();
            if (nextAcc) {
                setTimeout(() => startAccountSession(chromeIndex, nextAcc, proxy), 5000);
            }
            return;
        }
    }

    let form = {
        email,
        pass,
        code: secret,
        proxy: proxy ? { host: proxy.host, port: proxy.port, username: proxy.user, password: proxy.pass } : null
    };

    // Login
    try {
        await require(path.join(__dirname, "..", "api", "login.js"))(page, form);
    } catch (loginError) {
        if (isAccountLockedError(loginError) || await isAccountLockedPage(page)) {
            console.app(`Chrome ${chromeIndex + 1}: Account locked for ${email}`);
            markAccountLocked(email, 'ACCOUNT_LOCKED');
            await switchToNextAccount(chromeIndex, browser, proxy, 5000);
            return;
        }

        console.app(`❌ Chrome ${chromeIndex + 1}: Login failed for ${email}`);
        await browser.close();
        // Try next account with same Chrome instance
        const nextAcc = getNextAccount();
        if (nextAcc) {
            setTimeout(() => startAccountSession(chromeIndex, nextAcc, proxy), 10000);
        }
        return;
    }

    await new Promise(resolve => setTimeout(resolve, 1500));

    // Check if account suspended/locked
    if (await isAccountLockedPage(page)) {
        console.app(`Chrome ${chromeIndex + 1}: Account suspended: ${email}`);
        markAccountLocked(email, 'ACCOUNT_LOCKED');
        await switchToNextAccount(chromeIndex, browser, proxy, 5000);
        return;
    }

    let linkNow = page.url();

    // Ensure we're on Amazon
    if (!linkNow.includes('amazon.com') || linkNow.includes('/ap/') || linkNow.includes('/gp/')) {
        try {
            await page.goto('https://www.amazon.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (navError) {}
        linkNow = page.url();
    }

    if (global.data.settings.addAddress) {
        // Check address book
        try {
            await require(path.join(__dirname, "..", "api", "addAddress.js")).gotoBook(page);
            if (!(await require(path.join(__dirname, "..", "api", "addAddress.js")).checkBook(page))) {
                await require(path.join(__dirname, "..", "api", "addAddress.js")).addAddress(page);
            }
            try {
                await page.goto(linkNow, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (navError) {}
        } catch (addressError) {
            console.app(`Chrome ${chromeIndex + 1}: Address error for ${email}`);
        }
    } else {
        console.app(`Chrome ${chromeIndex + 1}: Skip address for ${email}`);
    }

    let res = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);
    if (res.error) {
        console.app(`❌ Chrome ${chromeIndex + 1}: Payment page error for ${email}`);
        await browser.close();
        const nextAcc = getNextAccount();
        if (nextAcc) {
            setTimeout(() => startAccountSession(chromeIndex, nextAcc, proxy), 10000);
        }
        return;
    }

    await clearExistingCards(page, email, chromeIndex);

    // Start processing card queue for this Chrome instance
    processCardQueue(page, browser, email, chromeIndex, proxy, accountStr);

    } catch (sessionError) {
        // ✅ TOP-LEVEL CATCH: Prevent Chrome crash on any unhandled error
        console.app(`❌ Chrome ${chromeIndex + 1}: Session error - ${sessionError.message}`);
        console.log(`❌ Chrome ${chromeIndex + 1}: Full error:`, sessionError);

        // Try to close browser if still open
        try {
            if (browser) await browser.close();
        } catch (closeErr) {
            console.log(`⚠️ Chrome ${chromeIndex + 1}: Could not close browser: ${closeErr.message}`);
        }

        // Retry with next account if available
        if (retryCount < MAX_RETRIES) {
            const nextAcc = getNextAccount();
            if (nextAcc) {
                console.app(`🔄 Chrome ${chromeIndex + 1}: Retrying with next account (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
                setTimeout(() => startAccountSession(chromeIndex, nextAcc, proxy, retryCount + 1), 10000);
            } else {
                console.app(`❌ Chrome ${chromeIndex + 1}: No more accounts available after error`);
            }
        } else {
            console.app(`❌ Chrome ${chromeIndex + 1}: Max retries (${MAX_RETRIES}) reached, stopping this Chrome instance`);
        }
    }
}

/**
 * Process cards from this Chrome's card queue
 */
async function processCardQueue(page, browser, email, chromeIndex, proxy, accountStr) {
    if (!global.temp.checkCard[chromeIndex]) {
        global.temp.checkCard[chromeIndex] = {};
    }

    if (await isAccountLockedPage(page)) {
        console.app(`Chrome ${chromeIndex + 1}: Account locked while processing ${email}`);
        markAccountLocked(email, 'ACCOUNT_LOCKED');
        await switchToNextAccount(chromeIndex, browser, proxy, 5000);
        return;
    }

    // Get next card from shared queue (no per-Chrome queue)
    // Check if there are cards left in the shared queue
    const peekHasCards = sharedCardQueue.length > 0;
    const hasCardsToVerify = Object.keys(global.temp.checkCard[chromeIndex] || {}).length > 0;

    if (!peekHasCards && !hasCardsToVerify) {
        console.app(`🏁 Chrome ${chromeIndex + 1}: All cards processed and verified`);
        await browser.close();
        return;
    }

    if (!peekHasCards && hasCardsToVerify) {
        console.app(`🔄 Chrome ${chromeIndex + 1}: No more cards, verifying ${Object.keys(global.temp.checkCard[chromeIndex]).length} remaining`);
        updateRemainingCardCount();
        await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter || 10000));
        return checkWallet(page, browser, email, chromeIndex, proxy, accountStr);
    }

    const currentCount = data.childCount[email] || 0;
    if (currentCount >= 80) {
        console.app(`⏭️ Chrome ${chromeIndex + 1}: Max cards for ${email}, switching account`);
        await browser.close();
        const nextAcc = getNextAccount();
        if (nextAcc) {
            return startAccountSession(chromeIndex, nextAcc, proxy);
        } else {
            console.app(`❌ Chrome ${chromeIndex + 1}: No more accounts, cards remaining in shared queue`);
            return;
        }
    }

    const remainingInQueue = sharedCardQueue.length;
    console.app(`➕ Chrome ${chromeIndex + 1}: Adding cards (${email}, ${currentCount}/80, ~${remainingInQueue} cards left in queue)`);

    // Process one card per account turn so Chrome 1/2/3 claim card 1/2/3,
    // then whichever account finishes first claims the next card.
    for (let i = 0; i < 1; i++) {
        if (await isAccountLockedPage(page)) {
            console.app(`Chrome ${chromeIndex + 1}: Account locked while adding cards for ${email}`);
            markAccountLocked(email, 'ACCOUNT_LOCKED');
            await switchToNextAccount(chromeIndex, browser, proxy, 5000);
            return;
        }

        const card = getNextCard(); // Get next card from shared queue (with checkcard.txt validation)
        if (!card) {
            console.app(`📋 Chrome ${chromeIndex + 1}: No more cards available in shared queue`);
            break;
        }
        const parsedCard = parseCardLine(card);
        if (!parsedCard) {
            console.app(`Chrome ${chromeIndex + 1}: Invalid card line skipped`);
            continue;
        }
        let form = {
            number: parsedCard.number,
            month: parsedCard.month,
            year: parsedCard.year,
            name: parsedCard.name,
            cvc: parsedCard.cvc
        };
        console.app(`Chrome ${chromeIndex + 1}: Input card ***${form.number.slice(-4)} ${form.month}/${form.year} for ${email}`);

        const getAddCardErrorCode = (result) => {
            if (!result) return 'UNKNOWN';
            if (typeof result.error === 'string') return result.error;
            if (result.error && typeof result.error.message === 'string') return result.error.message;
            return 'UNKNOWN';
        };

        let addRes;
        try {
            addRes = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        } catch (error) {
            if (isAccountLockedError(error) || await isAccountLockedPage(page)) {
                console.app(`Chrome ${chromeIndex + 1}: Account locked after add card for ${email}`);
                markAccountLocked(email, 'ACCOUNT_LOCKED');
                await switchToNextAccount(chromeIndex, browser, proxy, 5000);
                return;
            }
            addRes = { success: false, error: error.message || 'ADD_CARD_ERROR' };
        }
        if (isAccountLockedError(addRes) || await isAccountLockedPage(page)) {
            console.app(`Chrome ${chromeIndex + 1}: Account locked after add card for ${email}`);
            markAccountLocked(email, 'ACCOUNT_LOCKED');
            await switchToNextAccount(chromeIndex, browser, proxy, 5000);
            return;
        }

        let attempts = 1;
        const maxAttempts = 5;
        let lastAddCardError = getAddCardErrorCode(addRes);

        while (!addRes.success && addRes.error !== 'CARD_DIE' && attempts < maxAttempts) {
            lastAddCardError = getAddCardErrorCode(addRes);
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 5000));

            try {
                await page.reload({ waitUntil: ['domcontentloaded'], timeout: 30000 });
                await new Promise(resolve => setTimeout(resolve, 8000));

                const currentUrl = page.url();
                if (!currentUrl.includes('yourpayments') || !currentUrl.includes('wallet')) {
                    let navRes = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);
                    if (navRes.error) break;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            } catch (error) {
                if (error.name !== 'TimeoutError') {
                    console.log(`WARN Chrome ${chromeIndex + 1}: Reload error: ${error.message}`);
                }
            }

            try {
                addRes = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
            } catch (error) {
                if (isAccountLockedError(error) || await isAccountLockedPage(page)) {
                    console.app(`Chrome ${chromeIndex + 1}: Account locked after add card retry for ${email}`);
                    markAccountLocked(email, 'ACCOUNT_LOCKED');
                    await switchToNextAccount(chromeIndex, browser, proxy, 5000);
                    return;
                }
                addRes = { success: false, error: error.message || 'ADD_CARD_ERROR' };
            }
            if (isAccountLockedError(addRes) || await isAccountLockedPage(page)) {
                console.app(`Chrome ${chromeIndex + 1}: Account locked after add card retry for ${email}`);
                markAccountLocked(email, 'ACCOUNT_LOCKED');
                await switchToNextAccount(chromeIndex, browser, proxy, 5000);
                return;
            }
            lastAddCardError = getAddCardErrorCode(addRes);
        }

        if (!addRes.success) {
            if (addRes.error === 'CARD_DIE') {
                let cardBin = await getCardInfo(form.number);
                if (!cardBin.success) {
                    cardBin = { scheme: 'Unknown', type: 'Unknown', cardTier: 'Unknown', a2: 'Unknown', country: 'Unknown', issuer: 'Unknown' };
                }
                console.card.die(`DIE|${form.number}|${form.month}|${form.year}|${form.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
                console.app(`❌ Chrome ${chromeIndex + 1}: DIE ***${form.number.slice(-4)}`);

                cardTracker.markAsProcessed(card, 'DIE');

                const cardRemoved = await removeCard(page);
                let removeRetries = 0;
                while (cardRemoved.reload && removeRetries < 3) {
                    removeRetries++;
                    await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                    await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                    const retryRemove = await removeCard(page);
                    if (retryRemove.success) break;
                }

                data.childCount[email] = (data.childCount[email] || 0) + 1;
                fs.writeFileSync(path.join(__dirname, "..", "data", 'data.json'), JSON.stringify(data, null, 2), 'utf8');
                saveRemainingCards();
            } else {
                console.app(`❌ Chrome ${chromeIndex + 1}: Card add failed ***${card.slice(-4)}`);
                // Put card back to end of queue for retry
                // cardQueue.push(card); // Optional: retry later
            }
            continue;
        }

        // addRes.success = true (LIVE)
        let cardBin = await getCardInfo(form.number);
        if (!cardBin.success) {
            cardBin = { scheme: 'Unknown', type: 'Unknown', cardTier: 'Unknown', a2: 'Unknown', country: 'Unknown', issuer: 'Unknown' };
        }
        console.card.live(`LIVE|${form.number}|${form.month}|${form.year}|${form.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
        console.app(`✅ Chrome ${chromeIndex + 1}: LIVE ***${form.number.slice(-4)}`);

        cardTracker.markAsProcessed(card, 'LIVE');

        const cardRemoved = await removeCard(page);
        let removeRetries = 0;
        while (cardRemoved.reload && removeRetries < 3) {
            removeRetries++;
            await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
            await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
            const retryRemove = await removeCard(page);
            if (retryRemove.success) break;
        }

        data.childCount[email] = (data.childCount[email] || 0) + 1;
        fs.writeFileSync(path.join(__dirname, "..", "data", 'data.json'), JSON.stringify(data, null, 2), 'utf8');
        saveRemainingCards();

        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 2000)));
    }

    updateRemainingCardCount();

    console.app(`⏳ Chrome ${chromeIndex + 1}: Waiting ${(global.data.settings.checkAfter || 10000) / 1000}s for ${email}`);
    await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter || 10000));

    checkWallet(page, browser, email, chromeIndex, proxy, accountStr);
}

/**
 * Check wallet and verify card status
 */
async function checkWallet(page, browser, email, chromeIndex, proxy, accountStr) {
    try {
        console.app(`🔍 Chrome ${chromeIndex + 1}: Checking wallet for ${email}`);

        if (await isAccountLockedPage(page)) {
            console.app(`Chrome ${chromeIndex + 1}: Account locked while checking wallet for ${email}`);
            markAccountLocked(email, 'ACCOUNT_LOCKED');
            await switchToNextAccount(chromeIndex, browser, proxy, 5000);
            return;
        }

        await page.reload({
            waitUntil: ["networkidle0", "domcontentloaded"],
            timeout: data.settings?.navigationTimeout || 30000
        });

        if (await isAccountLockedPage(page)) {
            console.app(`Chrome ${chromeIndex + 1}: Account locked after wallet reload for ${email}`);
            markAccountLocked(email, 'ACCOUNT_LOCKED');
            await switchToNextAccount(chromeIndex, browser, proxy, 5000);
            return;
        }

        await page.waitForSelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical', { timeout: 15000 });

        let length = await page.evaluate(async () => {
            let wallet = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            return wallet && wallet.childNodes[0] ? wallet.childNodes[0].childNodes.length : 0;
        });

        let cardIndex = 0;
        let processedCards = 0;
        let removedCards = 0;

        while (cardIndex < length) {
            let walletClicked = await page.evaluate((i) => {
                let container = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                if (!container || !container.childNodes[0] || !container.childNodes[0].childNodes[i]) return false;

                let wallet = container.childNodes[0].childNodes[i];
                if (wallet && wallet.nodeName && wallet.nodeName.toLowerCase() == 'div') {
                    const isAddBox = wallet.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                    if (isAddBox) return false;
                    wallet.click();
                    return true;
                }
                return false;
            }, cardIndex);

            if (!walletClicked) {
                cardIndex++;
                continue;
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            let cardInfo = await page.evaluate(() => {
                let card = document.querySelector('.a-size-base-plus.pmts-instrument-number-tail span');
                let link = document.querySelector('.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img');
                return {
                    number: card ? card.innerText : '',
                    link: link ? link.src : '',
                };
            });

            if (!cardInfo.number) {
                cardIndex++;
                continue;
            }

            let fourNum = cardInfo.number.split('•••• ')[1];
            if (!fourNum) {
                fourNum = cardInfo.number.replace(/\D/g, '').slice(-4);
            }

            // Check if card is in our temp storage
            if (!global.temp.checkCard[chromeIndex] || !global.temp.checkCard[chromeIndex][fourNum]) {
                // Remove old card not in our session
                const cardRemoved = await removeCard(page);
                let removeRetries = 0;
                while (cardRemoved.reload && removeRetries < 3) {
                    removeRetries++;
                    await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                    await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                    const retryRemove = await removeCard(page);
                    if (retryRemove.success) { removedCards++; break; }
                }
                cardIndex++;
                continue;
            }

            processedCards++;

            let cardBin = await getCardInfo(global.temp.checkCard[chromeIndex][fourNum].card.number);
            if (!cardBin.success) {
                cardBin = { scheme: 'Unknown', type: 'Unknown', cardTier: 'Unknown', a2: 'Unknown', country: 'Unknown', issuer: 'Unknown' };
            }

            const storedImg = global.temp.checkCard[chromeIndex][fourNum].img || '';
            const currentImg = cardInfo.link || '';

            // Remove card after checking
            const cardRemoved = await removeCard(page);
            let removeRetries = 0;
            while (cardRemoved.reload && removeRetries < 3) {
                removeRetries++;
                await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                const retryRemove = await removeCard(page);
                if (retryRemove.success) break;
            }

            if (!cardRemoved.success && removeRetries >= 3) {
                cardIndex++;
                continue;
            }

            removedCards++;
            saveRemainingCards();

            // Determine card status
            if (storedImg !== currentImg) {
                console.card.live(`LIVE|${global.temp.checkCard[chromeIndex][fourNum].card.number}|${global.temp.checkCard[chromeIndex][fourNum].card.month}|${global.temp.checkCard[chromeIndex][fourNum].card.year}|${global.temp.checkCard[chromeIndex][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
                console.app(`✅ Chrome ${chromeIndex + 1}: LIVE ***${fourNum}`);
            } else {
                console.card.die(`DIE|${global.temp.checkCard[chromeIndex][fourNum].card.number}|${global.temp.checkCard[chromeIndex][fourNum].card.month}|${global.temp.checkCard[chromeIndex][fourNum].card.year}|${global.temp.checkCard[chromeIndex][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
                console.app(`❌ Chrome ${chromeIndex + 1}: DIE ***${fourNum}`);
            }

            delete global.temp.checkCard[chromeIndex][fourNum];
            cardIndex++;
        }

        console.app(`📊 Chrome ${chromeIndex + 1}: Wallet check done - ${processedCards} processed, ${removedCards} removed`);

        const remainingTempCards = Object.keys(global.temp.checkCard[chromeIndex] || {}).length;
        if (remainingTempCards > 0) {
            console.app(`🔄 Chrome ${chromeIndex + 1}: ${remainingTempCards} cards remaining`);
            return processCardQueue(page, browser, email, chromeIndex, proxy, accountStr);
        } else {
            return processCardQueue(page, browser, email, chromeIndex, proxy, accountStr);
        }

    } catch (error) {
        if (isAccountLockedError(error) || await isAccountLockedPage(page)) {
            console.app(`Chrome ${chromeIndex + 1}: Account locked during wallet check for ${email}`);
            markAccountLocked(email, 'ACCOUNT_LOCKED');
            await switchToNextAccount(chromeIndex, browser, proxy, 5000);
            return;
        }

        console.app(`❌ Chrome ${chromeIndex + 1}: Wallet check error for ${email} - ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return processCardQueue(page, browser, email, chromeIndex, proxy, accountStr);
    }
}

/**
 * Clear existing cards in wallet
 */
async function clearExistingCards(page, email, chromeIndex) {
    try {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const currentUrl = page.url();
        if (!currentUrl.includes('yourpayments') || !currentUrl.includes('wallet')) {
            await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        let existingCardCount = await page.evaluate(() => {
            const walletContainer = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            if (!walletContainer || !walletContainer.childNodes[0]) return 0;
            const paymentMethods = walletContainer.childNodes[0].childNodes;
            let realCardCount = 0;
            for (let i = 0; i < paymentMethods.length; i++) {
                const method = paymentMethods[i];
                if (method.nodeName && method.nodeName.toLowerCase() === 'div') {
                    const isAddBox = method.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                    if (!isAddBox) realCardCount++;
                }
            }
            return realCardCount;
        });

        if (existingCardCount === 0) return;

        console.app(`🗑️ Chrome ${chromeIndex + 1}: Removing ${existingCardCount} existing cards for ${email}`);

        let removedCount = 0;
        let maxRetries = 10;

        while (removedCount < existingCardCount && maxRetries > 0) {
            maxRetries--;

            const cardClicked = await page.evaluate(() => {
                const walletContainer = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                if (!walletContainer || !walletContainer.childNodes[0]) return false;
                const paymentMethods = walletContainer.childNodes[0].childNodes;
                for (let i = 0; i < paymentMethods.length; i++) {
                    const method = paymentMethods[i];
                    if (method.nodeName && method.nodeName.toLowerCase() === 'div') {
                        const isAddBox = method.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                        if (!isAddBox) { method.click(); return true; }
                    }
                }
                return false;
            });

            if (!cardClicked) break;

            await new Promise(resolve => setTimeout(resolve, 3000));

            let retryCount = 0;
            let cardRemoved = { success: false };
            while (retryCount < 3 && !cardRemoved.success) {
                cardRemoved = await removeCard(page);
                if (cardRemoved.success) {
                    removedCount++;
                    await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                    break;
                } else if (cardRemoved.reload) {
                    await page.reload({ waitUntil: ["domcontentloaded"] });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    retryCount++;
                } else {
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        console.app(`✅ Chrome ${chromeIndex + 1}: Cleared ${removedCount}/${existingCardCount} cards for ${email}`);
        await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
        console.app(`❌ Chrome ${chromeIndex + 1}: Clear cards error for ${email}`);
    }
}

async function removeCard(page) {
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (!page || page.isClosed()) {
                return { success: false, error: 'PAGE_CLOSED' };
            }

            await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));

            const removeLinkClicked = await page.evaluate(() => {
                const selectors = [
                    '.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-link-normal',
                    '.apx-wallet-payment-method-details-section a[href*="remove"]',
                    '.pmts-portal-component .a-link-normal',
                    'a:has-text("Remove")',
                    '.apx-remove-link'
                ];
                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.offsetParent !== null) {
                        element.click();
                        return { success: true, selector };
                    }
                }
                return { success: false };
            });

            if (!removeLinkClicked.success) {
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                } else {
                    return { success: false, reload: true, error: 'NO_REMOVE_LINK' };
                }
            }

            await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));

            const removalHandled = await page.evaluate(() => {
                const removeWithoutSelecting = document.querySelector('.a-popover[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]');
                if (removeWithoutSelecting) {
                    removeWithoutSelecting.click();
                    return { success: true, method: 'remove_without_selecting' };
                }

                const popoverButtons = [
                    '.a-popover[aria-hidden="false"] .apx-remove-link-button',
                    '.a-popover-modal .apx-remove-link-button',
                    '.a-declarative[aria-hidden="false"] .apx-remove-link-button'
                ];
                for (const selector of popoverButtons) {
                    const button = document.querySelector(selector);
                    if (button && button.offsetParent !== null) {
                        button.click();
                        return { success: true, method: 'popover_button', selector };
                    }
                }

                const confirmButtons = [
                    '.a-popover[aria-hidden="false"] .pmts-delete-instrument input.a-button-input',
                    '.a-popover[aria-hidden="false"] .apx-remove-button-desktop input',
                    '.a-popover-modal input.a-button-input[type="submit"]'
                ];
                for (const selector of confirmButtons) {
                    const button = document.querySelector(selector);
                    if (button && button.offsetParent !== null) {
                        button.click();
                        return { success: true, method: 'confirm_button', selector };
                    }
                }

                return { success: false };
            });

            if (removalHandled.success) {
                await new Promise(resolve => setTimeout(resolve, randomInt(2000, 4000)));

                const verifyRemoval = await page.evaluate(() => {
                    const popoverStillVisible = document.querySelector('.a-popover[aria-hidden="false"]');
                    const walletVisible = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css');
                    return {
                        popoverGone: !popoverStillVisible,
                        walletVisible: !!walletVisible,
                        currentUrl: window.location.href
                    };
                });

                if (verifyRemoval.popoverGone || verifyRemoval.walletVisible) {
                    return { success: true };
                } else {
                    return { success: true }; // Assume success
                }
            } else {
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
            }

        } catch (error) {
            if (error.message.includes('detached') || error.message.includes('Session closed')) {
                return { success: false, error: 'FRAME_DETACHED' };
            }
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }
        }
    }

    return { success: false, reload: true, error: 'MAX_ATTEMPTS_EXCEEDED' };
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function getCardInfo(cardNumber) {
    try {
        const bin = cardNumber.substring(0, 8);
        const binKey = bin.substring(0, 6);

        if (binCache[binKey]) {
            return {
                success: true,
                scheme: binCache[binKey].scheme,
                type: binCache[binKey].type,
                cardTier: binCache[binKey].cardTier,
                a2: binCache[binKey].a2,
                country: binCache[binKey].country,
                issuer: binCache[binKey].issuer
            };
        }

        let res = (await axios.get(`https://data.handyapi.com/bin/${cardNumber}`)).data;

        if (res.Status === "SUCCESS") {
            binCache[binKey] = {
                scheme: res.Scheme,
                type: res.Type,
                cardTier: res.CardTier,
                a2: res.Country.A2,
                country: res.Country.Name,
                issuer: res.Issuer
            };
            return { success: true, ...binCache[binKey] };
        }

        return { success: false, error: res.Status };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            scheme: 'Unknown',
            type: 'Unknown',
            cardTier: 'Unknown',
            a2: 'Unknown',
            country: 'Unknown',
            issuer: 'Unknown'
        };
    }
}

var saveData = setInterval(() => {
    fs.writeFileSync(path.join(__dirname, "..", "data", 'data.json'), JSON.stringify(data, null, 2), 'utf8');
}, 5000);

function saveRemainingCards() {
    // Remaining cards = cards not yet taken from shared queue
    const allRemaining = [...sharedCardQueue];

    if (!global.data.dirSave) {
        global.data.dirSave = path.join(__dirname, "..", "data");
    }

    fs.writeFileSync(path.join(global.data.dirSave, 'remaining_cards.txt'), allRemaining.join('\n'), 'utf8');
    updateRemainingCardCount();
}

function updateRemainingCardCount() {
    const remaining = Math.max(0, sharedCardQueue.length);

    if (console.card && typeof console.card.setRemaining === 'function') {
        console.card.setRemaining(remaining);
    }

    return remaining;
}

module.exports = checkCard;
