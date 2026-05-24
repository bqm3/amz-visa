const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Function to handle connection timeout
async function handleConnectionTimeout(page, retryCount = 0) {
    if (retryCount >= 3) {
        throw new Error("MAX_RETRIES_EXCEEDED");
    }
    
    console.log(`⚠️ Connection timeout detected, waiting 30s before retry (attempt ${retryCount + 1}/3)...`);
    console.app(`⚠️ Connection timeout detected, waiting 30s before retry (attempt ${retryCount + 1}/3)...`);
    
    // Wait 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    try {
        // Reload page
        console.log(`🔄 Refreshing page after timeout...`);
        await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
        
        // Wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log(`✅ Page refreshed successfully`);
        return true;
    } catch (error) {
        console.error(`❌ Error during page refresh:`, error.message);
        return false;
    }
}

// ✅ SINGLE OPTIMIZED waitForPageLoad FUNCTION
async function waitForPageLoad(page, timeout = 15000) {
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
        
        // Simple wait for content to stabilize (no navigation wait that causes issues)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('✅ Page loaded successfully');
        
    } catch (error) {
        console.log(`⚠️ Page load error: ${error.message}, continuing anyway...`);
        
        // Minimal fallback
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
}

// Function to detect account status
async function detectAccountStatus(page) {
    try {
        const url = page.url();
        const content = await page.content();
        
        // Check for various account lock scenarios
        if (url.includes('/ap/signin') && (content.includes('locked') || 
            content.includes('suspended') || 
            content.includes('Your account has been temporarily locked') ||
            content.includes('We noticed some unusual activity') ||
            content.includes('To continue, please verify your identity'))) {
            return 'ACCOUNT_LOCKED';
        }
        
        if (url.includes('account-status.amazon.com') ||
            content.includes('Account on hold') ||
            content.includes('Your account is currently under review')) {
            return 'ACCOUNT_LOCKED';
        }
        
        // Check for captcha that might indicate suspicious activity
        if (content.includes('Enter the characters you see below') ||
            content.includes('Type the characters you see in this image')) {
            return 'SUSPICIOUS_ACTIVITY';
        }
        
        return 'NORMAL';
    } catch (error) {
        console.log(`Error detecting account status: ${error.message}`);
        return 'NORMAL';
    }
}

// Function to remove locked account from files
function removeLockedAccount(email) {
    try {
        console.log(`🔍 Starting removal process for locked account: ${email}`);
        console.app(`🔍 Starting removal process for locked account: ${email}`);
        
        // Remove from acc.txt with absolute path
        const accPath = path.join(__dirname, '..', 'data', 'acc.txt');
        console.log(`📁 Checking acc.txt path: ${accPath}`);
        
        if (fs.existsSync(accPath)) {
            console.log(`✅ acc.txt file exists, reading content...`);
            const accContent = fs.readFileSync(accPath, 'utf8');
            const originalLines = accContent.split('\n');
            console.log(`📊 Original file has ${originalLines.length} lines`);
            
            const filteredLines = originalLines.filter(line => {
                const trimmedLine = line.trim();
                if (trimmedLine.length === 0 || trimmedLine.startsWith('//') || trimmedLine.startsWith('#')) {
                    return true; // Keep comments and empty lines
                }
                const emailFromLine = trimmedLine.split('|')[0];
                const shouldKeep = emailFromLine !== email;
                if (!shouldKeep) {
                    console.log(`🗑️ Removing line: ${trimmedLine}`);
                    console.app(`🗑️ Removing account: ${emailFromLine}`);
                }
                return shouldKeep;
            });
            
            console.log(`📊 Filtered file has ${filteredLines.length} lines`);
            
            if (filteredLines.length !== originalLines.length) {
                fs.writeFileSync(accPath, filteredLines.join('\n'), 'utf8');
                console.log(`💾 Successfully removed ${email} from acc.txt`);
                console.app(`💾 Successfully removed ${email} from acc.txt`);
            } else {
                console.log(`⚠️ Account ${email} not found in acc.txt`);
                console.app(`⚠️ Account ${email} not found in acc.txt`);
            }
        } else {
            console.log(`❌ acc.txt file not found at: ${accPath}`);
            console.app(`❌ acc.txt file not found at: ${accPath}`);
        }

        // Remove from data.json with absolute path
        const dataPath = path.join(__dirname, '..', 'data', 'data.json');
        console.log(`📁 Checking data.json path: ${dataPath}`);
        
        if (fs.existsSync(dataPath)) {
            console.log(`✅ data.json file exists, reading content...`);
            let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            let dataChanged = false;
            
            // Remove from childCount
            if (data.childCount && data.childCount[email]) {
                delete data.childCount[email];
                dataChanged = true;
                console.log(`🗑️ Removed ${email} from data.json childCount`);
            }
            
            // Remove from businessAccounts if exists
            if (data.businessAccounts && Array.isArray(data.businessAccounts)) {
                const originalCount = data.businessAccounts.length;
                data.businessAccounts = data.businessAccounts.filter(acc => acc !== email);
                if (data.businessAccounts.length !== originalCount) {
                    dataChanged = true;
                    console.log(`🗑️ Removed ${email} from data.json businessAccounts`);
                }
            }
            
            // Add to locked accounts history
            if (!data.lockedAccountsHistory) {
                data.lockedAccountsHistory = [];
            }
            
            // Check if already in history to avoid duplicates
            const alreadyInHistory = data.lockedAccountsHistory.some(acc => acc.email === email);
            if (!alreadyInHistory) {
                data.lockedAccountsHistory.push({
                    email: email,
                    lockedAt: new Date().toISOString(),
                    reason: 'ACCOUNT_LOCKED',
                    removedFromFiles: true
                });
                dataChanged = true;
                console.log(`📝 Added ${email} to locked accounts history`);
            }
            
            if (dataChanged) {
                fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
                console.log(`💾 Updated data.json - removed ${email}`);
                console.app(`💾 Updated data.json - removed ${email}`);
            }
        } else {
            console.log(`❌ data.json file not found at: ${dataPath}`);
            console.app(`❌ data.json file not found at: ${dataPath}`);
        }
        
        // Create locked accounts report file
        const lockedReportPath = path.join(__dirname, '..', 'data', 'locked_accounts.txt');
        const timestamp = new Date().toISOString();
        const reportLine = `${timestamp}: ${email} - ACCOUNT_LOCKED - REMOVED_FROM_FILES\n`;
        fs.appendFileSync(lockedReportPath, reportLine, 'utf8');
        console.log(`📄 Added to locked accounts report: ${lockedReportPath}`);
        
        return true;
    } catch (error) {
        console.error(`❌ Error removing locked account ${email}:`, error.message);
        console.app(`❌ Error removing locked account ${email}: ${error.message}`);
        return false;
    }
}

// Main login function
async function login(page, { email, pass, code, proxy }) {
    console.log("Login function called with email:", email, "and password:", pass);
    console.app("Login function called with email:", email, "and password:", pass);

    const timeout = 30 * 60 * 1000;
    page.setDefaultTimeout(timeout);

    // Set navigation timeout separately
    page.setDefaultNavigationTimeout(60000); // 60 seconds navigation timeout

    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({ username: proxy.username, password: proxy.password });
    }

    {
        const targetPage = page;
        await targetPage.setViewport({
            width: 700,
            height: 700
        });
    }

    // Add retry logic for the Amazon login page
    let retries = 3;
    let success = false;

    while (retries > 0 && !success) {
        try {
            console.log(`Attempting to navigate to login page (${retries} attempts left)...`);
            console.app(`Attempting to navigate to login page (${retries} attempts left)...`);
            await page.goto(
                'https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https://www.amazon.com/?ref_=nav_signin&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.ns=http://specs.openid.net/auth/2.0',
                { waitUntil: 'networkidle2', timeout: 60000 }
            );
            
            // Wait for page to load completely
            await waitForPageLoad(page);
            
            success = true;
        } catch (err) {
            retries--;
            
            // Handle timeout errors
            if (err.message.includes('timeout') || err.message.includes('net::ERR_') || err.message.includes('Navigation timeout')) {
                console.log(`🔄 Navigation timeout detected: ${err.message}`);
                
                try {
                    const handled = await handleConnectionTimeout(page, 3 - retries);
                    if (handled && retries > 0) {
                        console.log(`🔄 Retrying after timeout handling...`);
                        continue;
                    }
                } catch (timeoutError) {
                    console.log(`❌ Failed to handle timeout: ${timeoutError.message}`);
                }
            }
            
            if (retries === 0) {
                console.log("Failed to load Amazon login page after multiple attempts.");
                console.app("Failed to load Amazon login page after multiple attempts.");
                throw new Error("FAILED_LOAD_LOGIN_PAGE");
            }
            console.log(`Error loading page: ${err.message}. Retrying...`);
            console.app(`Error loading page: ${err.message}. Retrying...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // Handle CAPTCHA if present
    if (global.data.parentAcc.geminiKey && global.data.parentAcc.geminiKey != "") {
        await handleCapcha(page, timeout);
        await waitForPageLoad(page);
    }
    
    try {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Continue shopping)'),
            targetPage.locator('button'),
            targetPage.locator('::-p-xpath(/html/body/div/div[1]/div[3]/div/div/form/div/div/span/span/button)'),
            targetPage.locator(':scope >>> button'),
            targetPage.locator('::-p-text(Continue shopping)')
        ])
            .setTimeout(1000)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 237.39999389648438,
                y: 15.149993896484375,
              },
            });
        await Promise.all(promises);
        
        await waitForPageLoad(page);
        
    } catch (_) {}

    // Fill email field
    {
        const targetPage = page;
        try {
            await targetPage.locator('#ap_email').fill(email);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.log("Error filling email:", error.message);
            console.app("Error filling email:" + error.message);
            throw new Error("FAILED_FILL_EMAIL");
        }
    }
    
    // Click continue button
    {
        const targetPage = page;
        try {
            await targetPage.locator('#continue').click();
            await targetPage.waitForNavigation({ timeout: 60000 });
            await waitForPageLoad(page);
        } catch (error) {
            console.log("Error after clicking continue:", error.message);
            console.app("Error after clicking continue:" + error.message);
            throw new Error("FAILED_CLICK_CONTINUE");
        }
    }
    
    // Fill password field
    {
        const targetPage = page;
        try {
            await targetPage.locator('#ap_password').fill(pass);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.log("Error filling password:", error.message);
            console.app("Error filling password:" + error.message);
            throw new Error("FAILED_FILL_PASSWORD");
        }
    }
    
    // ✅ IMPROVED SIGN IN HANDLING - Prevent execution context destruction
    {
        const targetPage = page;
        try {
            console.log('🖱️ Clicking sign in button...');
            
            // Get URL before clicking
            let beforeClickUrl = await targetPage.url();
            
            // ✅ USE SAFER CLICK METHOD WITHOUT IMMEDIATE NAVIGATION WAIT
            await targetPage.locator('#signInSubmit').click();
            
            // ✅ WAIT FOR POTENTIAL NAVIGATION OR PAGE CHANGES
            let navigationOccurred = false;
            try {
                await Promise.race([
                    // Wait for navigation if it happens
                    targetPage.waitForNavigation({ timeout: 15000 }).then(() => {
                        navigationOccurred = true;
                    }),
                    // Or wait for URL change
                    new Promise(async (resolve) => {
                        for (let i = 0; i < 30; i++) {
                            await new Promise(r => setTimeout(r, 500));
                            try {
                                const currentUrl = await targetPage.url();
                                if (currentUrl !== beforeClickUrl) {
                                    navigationOccurred = true;
                                    resolve();
                                    return;
                                }
                            } catch (e) {
                                // Page might be navigating
                                break;
                            }
                        }
                        resolve();
                    })
                ]);
            } catch (navError) {
                console.log(`⚠️ Navigation wait completed with: ${navError.message}`);
            }
            
            // Wait for page to stabilize
            await waitForPageLoad(page);
            
            let afterClickUrl;
            try {
                afterClickUrl = await targetPage.url();
            } catch (e) {
                console.log('⚠️ Error getting URL after click, page might be navigating...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                afterClickUrl = await targetPage.url();
            }
            
            console.log(`🔍 URL before: ${beforeClickUrl}`);
            console.log(`🔍 URL after: ${afterClickUrl}`);
            
            // Check account status after sign in
            const accountStatus = await detectAccountStatus(targetPage);
            
            if (accountStatus === 'ACCOUNT_LOCKED') {
                console.log(`❌ Account ${email} is locked or suspended`);
                console.app(`❌ Account ${email} is locked or suspended`);
                
                // Remove account from files immediately
                const removeResult = removeLockedAccount(email);
                if (removeResult) {
                    console.log(`✅ Successfully processed locked account removal for ${email}`);
                } else {
                    console.log(`⚠️ Failed to remove locked account ${email} from files`);
                }
                
                throw new Error("ACCOUNT_LOCKED");
            }
            
            // Check if login failed (URL didn't change significantly)
            const urlChanged = afterClickUrl !== beforeClickUrl && 
                               !afterClickUrl.includes('/ap/signin') && 
                               !afterClickUrl.includes('/ap/mfa');
            
            if (!urlChanged && !navigationOccurred) {
                // Double check for account lock
                const currentStatus = await detectAccountStatus(targetPage);
                if (currentStatus === 'ACCOUNT_LOCKED') {
                    console.log(`❌ Account ${email} is locked (detected after password check)`);
                    console.app(`❌ Account ${email} is locked (detected after password check)`);
                    
                    const removeResult = removeLockedAccount(email);
                    if (removeResult) {
                        console.log(`✅ Successfully processed locked account removal for ${email}`);
                    }
                    
                    throw new Error("ACCOUNT_LOCKED");
                } else {
                    // Check for error messages on page
                    const hasErrors = await targetPage.evaluate(() => {
                        const errorSelectors = [
                            '.a-alert-error',
                            '.a-alert-warning',
                            '[data-action-type="DISMISS_ERROR_ALERT"]',
                            '.auth-error-message'
                        ];
                        return errorSelectors.some(selector => document.querySelector(selector));
                    });
                    
                    if (hasErrors) {
                        console.log(`❌ Incorrect password for ${email}`);
                        console.app(`❌ Incorrect password for ${email}`);
                        throw new Error("INCORRECT_PASS");
                    }
                }
            }
            
            console.log('✅ Sign in click successful');
            
        } catch (error) {
            console.log("Error after clicking sign in:", error.message);
            console.app("Error after clicking sign in:" + error.message);
            
            // Handle specific account lock scenarios
            if (error.message === "ACCOUNT_LOCKED") {
                throw new Error("ACCOUNT_LOCKED");
            }
            
            if (error.message === "INCORRECT_PASS") {
                throw new Error("INCORRECT_PASS");
            }
            
            throw new Error("FAILED_SIGN_IN");
        }
    }

    // Handle MFA if required
    if (page.url().includes('/ap/mfa')) {
        console.log("MFA page detected. Handling MFA...");
        console.app("MFA page detected. Handling MFA...");

        let mfaRetries = 3;
        while (mfaRetries > 0) {
            try {
                let twofactor = require("node-2fa");
                let mfaToken = twofactor.generateToken(code).token;
                console.log("Generated MFA token:", mfaToken);
                console.app("Generated MFA token:" + mfaToken);

                {
                    const targetPage = page;
                    await targetPage.locator('#auth-mfa-otpcode').fill(mfaToken);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Check if "Don't require" option exists and click it
                try {
                    const targetPage = page;
                    const dontRequireExists = await targetPage.evaluate(() => {
                        const element = document.querySelector("label[for='auth-mfa-remember-device'] span");
                        return element && element.textContent.includes("Don't require");
                    });

                    if (dontRequireExists) {
                        await targetPage.locator("label[for='auth-mfa-remember-device']").click();
                        console.log("Clicked 'Don't require' option");
                        console.app("Clicked 'Don't require' option");
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (dontRequireError) {
                    console.log("'Don't require' option not found or couldn't click, continuing...");
                }

                {
                    const targetPage = page;
                    await targetPage.locator('#auth-signin-button').click();
                    await targetPage.waitForNavigation({ timeout: 60000 });
                    await waitForPageLoad(page);
                }

                console.log("MFA handled successfully");
                console.app("MFA handled successfully");
                break; // Success
                
            } catch (mfaError) {
                mfaRetries--;
                console.log(`Error handling MFA (${mfaRetries} retries left):`, mfaError.message);
                console.app("Error handling MFA:" + mfaError.message);
                
                // Handle timeout in MFA
                if (mfaError.message.includes('timeout') && mfaRetries > 0) {
                    await handleConnectionTimeout(page, 3 - mfaRetries);
                    continue;
                }
                
                if (mfaRetries === 0) {
                    throw new Error("FAILED_MFA");
                }
                
                // Wait before retry (MFA token might need to be regenerated)
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    // Wait for page to stabilize
    {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const targetPage = page;
        await targetPage.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });
        });
        
        await waitForPageLoad(page);
    }

    // Handle account fixup page (phone verification skip)
    if (page.url().includes('/ap/accountfixup?clientContext=')) {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Not now)'),
            targetPage.locator('#ap-account-fixup-phone-skip-link'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ap-account-fixup-phone-skip-link\\"])'),
            targetPage.locator(':scope >>> #ap-account-fixup-phone-skip-link'),
            targetPage.locator('::-p-text(Not now)')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 23.662506103515625,
                y: 9.20001220703125,
              },
            });
        await Promise.all(promises);
        
        await waitForPageLoad(page);
    }

    // Handle business account selector
    try {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-text(Business account)'),
            targetPage.locator("html > body > #a-page > div.a-section > #authportal-center-section > #authportal-main-section > div:nth-of-type(2) > div > #ap-account-switcher-container > div.a-box > div > div > div:nth-of-type(2) > div > [data-test-id='switchableAccounts'] [data-test-id='accountType']"),
            targetPage.locator('::-p-xpath(//*[@data-test-id=\\"accountType\\"])'),
            targetPage.locator(":scope >>> html > body > #a-page > div.a-section > #authportal-center-section > #authportal-main-section > div:nth-of-type(2) > div > #ap-account-switcher-container > div.a-box > div > div > div:nth-of-type(2) > div > [data-test-id='switchableAccounts'] [data-test-id='accountType']")
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 76.03750610351562,
                y: 10,
              },
            });
        await Promise.all(promises);
        
        await waitForPageLoad(page);
        
    } catch (error) {
        console.log("Business account selector not found or not needed, continuing with regular account...");
        console.app("Business account selector not found or not needed, continuing with regular account...");
    }
    
    // Final checks and account lock detection
    {
        const targetPage = page;
        await new Promise(resolve => setTimeout(resolve, 1000));
        await targetPage.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });
        });

        // Final account lock check
        const finalStatus = await detectAccountStatus(page);
        
        if (finalStatus === 'ACCOUNT_LOCKED') {
            console.log(`❌ Account ${email} is locked (final check)`);
            console.app(`❌ Account ${email} is locked (final check)`);
            
            const removeResult = removeLockedAccount(email);
            if (removeResult) {
                console.log(`✅ Successfully processed locked account removal for ${email}`);
            }
            
            throw new Error("ACCOUNT_LOCKED");
        }

        // Handle continue shopping button if still on signin page
        if(page.url().includes('/ap/signin')) {
            try {
                await puppeteer.Locator.race([
                    targetPage.locator('button[type="submit"].a-button-text[alt="Continue shopping"]'),
                    targetPage.locator('::-p-xpath(//button[@type="submit" and @class="a-button-text" and @alt="Continue shopping"])'),
                    targetPage.locator(':scope >>> button[type="submit"].a-button-text[alt="Continue shopping"]')
                ])
                    .setTimeout(5000)
                    .click();
                    
                await waitForPageLoad(page);
                
            } catch (error) {
                console.log(`❌ Account ${email} is locked (continue button check)`);
                console.app(`❌ Account ${email} is locked (continue button check)`);
                
                const removeResult = removeLockedAccount(email);
                if (removeResult) {
                    console.log(`✅ Successfully processed locked account removal for ${email}`);
                }
                
                throw new Error("ACCOUNT_LOCKED");
            }
        }
        
        await waitForPageLoad(page);
    }

    // Wait for final navigation to complete
    await new Promise((resolve, reject) => {
        let interval = setInterval(() => {
            if (page.url().includes('amazon.com/?') || page.url().length <= 25 || page.url().includes('account-status.amazon.com')) {
                clearInterval(interval);
                resolve();
                return;
            }
        }, 1000);
        
        // Timeout after 30 seconds
        setTimeout(() => {
            clearInterval(interval);
            resolve();
        }, 30000);
    });
    
    await waitForPageLoad(page);
    
    console.log(`✅ Login successful for ${email}`);
    console.app(`✅ Login successful for ${email}`);
}

// CAPTCHA handling function
async function handleCapcha(page, timeout) {
    let captchaResolved = false;
    let captchaAttempts = 0;
    const maxCaptchaAttempts = 5;

    while (!captchaResolved && captchaAttempts < maxCaptchaAttempts) {
        captchaAttempts++;
        await new Promise((resolve) => setTimeout(resolve, 1000));

        let captchaForm;
        try {
            captchaForm = await page.$('form[action="/errors/validateCaptcha"] img');
        } catch (_) { }

        if (!captchaForm) {
            console.log("No captcha form detected, proceeding...");
            captchaResolved = true;
            return;
        }

        console.log(`Captcha detected, attempting to solve (attempt ${captchaAttempts}/${maxCaptchaAttempts})...`);
        
        try {
            const captchaSrc = await page.evaluate(() => {
                const captchaImage = document.querySelector('form[action="/errors/validateCaptcha"] img');
                return captchaImage ? captchaImage.src : null;
            });

            console.log("Captcha image source:", captchaSrc);
            const resCapcha = await require(path.join(__dirname, "capha.js"))(captchaSrc);

            if (!resCapcha || !resCapcha.success) {
                console.log("Captcha solution failed, retrying...");
                console.app("Captcha solution failed, retrying...");
                continue;
            }

            console.log("Captcha result:", resCapcha);
            console.app("Captcha result:", resCapcha.captchaCode);

            // Click captcha field
            await puppeteer.Locator.race([
                page.locator('::-p-aria(Type characters)'),
                page.locator('#captchacharacters'),
                page.locator('::-p-xpath(//*[@id=\\"captchacharacters\\"])'),
                page.locator(':scope >>> #captchacharacters')
            ])
                .setTimeout(timeout)
                .click({
                    offset: {
                        x: 42.5,
                        y: 11.015625,
                    },
                });

            // Fill captcha field
            await puppeteer.Locator.race([
                page.locator('::-p-aria(Type characters)'),
                page.locator('#captchacharacters'),
                page.locator('::-p-xpath(//*[@id=\\"captchacharacters\\"])'),
                page.locator(':scope >>> #captchacharacters')
            ])
                .setTimeout(timeout)
                .fill(resCapcha.captchaCode);
                
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Submit the captcha
            const promises = [];
            const startWaitingForEvents = () => {
                promises.push(
                    page.waitForNavigation({ timeout: 60000 })
                        .catch(err => {
                            console.log("Navigation timeout after CAPTCHA submission, continuing anyway");
                            console.app("Navigation timeout after CAPTCHA submission, continuing anyway");
                            return null;
                        })
                );
            }

            await puppeteer.Locator.race([
                page.locator('::-p-aria(Continue shopping)'),
                page.locator('button'),
                page.locator('::-p-xpath(/html/body/div/div[1]/div[3]/div/div/form/div[2]/div/span/span/button)'),
                page.locator(':scope >>> button'),
                page.locator('::-p-text(Continue shopping)')
            ])
                .setTimeout(timeout)
                .on('action', () => startWaitingForEvents())
                .click({
                    offset: {
                        x: 76.5,
                        y: 6.015625,
                    },
                });

            await Promise.all(promises);
            await waitForPageLoad(page);

            // Check if captcha is still present after submission
            try {
                captchaForm = await page.$('form[action="/errors/validateCaptcha"] img');
                if (captchaForm) {
                    console.log("Captcha still present after submission, retrying...");
                    console.app("Captcha still present after submission, retrying...");
                } else {
                    console.log("Captcha passed successfully!");
                    console.app("Captcha passed successfully!");
                    captchaResolved = true;
                }
            } catch (e) {
                console.log("Error checking captcha form:", e);
                captchaResolved = true;
            }
            
        } catch (captchaError) {
            console.log(`Captcha handling error: ${captchaError.message}`);
            
            // Handle timeout in captcha
            if (captchaError.message.includes('timeout')) {
                await handleConnectionTimeout(page, captchaAttempts);
            }
        }
    }
    
    if (!captchaResolved) {
        throw new Error("FAILED_SOLVE_CAPTCHA_MAX_ATTEMPTS");
    }
}

module.exports = login;