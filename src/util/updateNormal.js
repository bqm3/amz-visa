const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const windowManager = require('./windowManager');

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
const maxConcurrentWindows = Math.max(proxies.length, 1);

async function updateNormal() {
    windowManager.reset();
    console.log('Starting normal login process...');
    console.app('Starting normal login process...');

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
        const [host, port, username, password] = proxies[currentProxyIndex % proxies.length].split(':');
        proxy = { host, port, username, password };
        currentProxyIndex++;
    }

    let browser;
    try {
        const windowPosition = windowManager.getNextPosition();
        const launchOptions = {
            headless: !global.data.settings.showBrowser,
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

            // Continue with card flow similar to scan/check flow.
            try {
                // For normal accounts, go directly to consumer wallet to avoid business-only routing.
                await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000
                });
                await new Promise(resolve => setTimeout(resolve, 1500));

                const cardPath = path.join(__dirname, '..', 'data', 'card.txt');
                const cardLines = fs.existsSync(cardPath)
                    ? fs.readFileSync(cardPath, 'utf8').replace(/\r/g, '').split('\n').map(v => v.trim()).filter(Boolean)
                    : [];

                if (cardLines.length === 0) {
                    console.log(`No cards found in card.txt for ${email}`);
                    console.app(`No cards found in card.txt for ${email}`);
                } else {
                    const addCard = require(path.join(__dirname, '..', 'api', 'addCard.js'));
                    const maxCardsPerAccount = 3;
                    let addedCount = 0;

                    for (const cardLine of cardLines.slice(0, maxCardsPerAccount)) {
                        const [number, monthRaw, yearRaw, cvc] = cardLine.split('|');
                        if (!number || !monthRaw || !yearRaw || !cvc) continue;

                        const month = monthRaw.length === 1 ? `0${monthRaw}` : monthRaw;
                        const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
                        const form = { number, month, year, name: 'Saint David', cvc };

                        let res = await addCard(page, form);
                        let attempts = 1;
                        while (!res.success && attempts < 3) {
                            attempts++;
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            try {
                                await page.reload({ waitUntil: ['domcontentloaded'], timeout: 5000 });
                                await new Promise(resolve => setTimeout(resolve, 4000));
                                const currentUrl = page.url();
                                if (!currentUrl.includes('yourpayments') || !currentUrl.includes('wallet')) {
                                    await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
                                        waitUntil: 'domcontentloaded',
                                        timeout: 5000
                                    });
                                    await new Promise(resolve => setTimeout(resolve, 3000));
                                }
                            } catch (_) {}
                            res = await addCard(page, form);
                        }

                        if (res.success) {
                            addedCount++;
                            console.log(`Added card ***${number.slice(-4)} for ${email}`);
                            console.app(`Added card ***${number.slice(-4)} for ${email}`);
                        } else {
                            const reason = res.step || res.error ? ` (${res.step || 'unknown_step'}: ${res.error || 'unknown_error'})` : '';
                            console.log(`Failed card ***${number.slice(-4)} for ${email}${reason}`);
                            console.app(`Failed card ***${number.slice(-4)} for ${email}${reason}`);
                        }
                    }

                    console.log(`Card flow completed for ${email}: ${addedCount} card(s) added`);
                    console.app(`Card flow completed for ${email}: ${addedCount} card(s) added`);
                }
            } catch (cardFlowError) {
                console.log(`Card flow failed for ${email}: ${cardFlowError.message}`);
                console.app(`Card flow failed for ${email}: ${cardFlowError.message}`);
            }
        } catch (addressError) {
            console.log(`Address page action failed for ${email}: ${addressError.message}`);
            console.app(`Address page action failed for ${email}: ${addressError.message}`);
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
