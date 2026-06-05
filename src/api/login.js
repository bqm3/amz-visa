const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// Function to handle connection timeout
async function handleConnectionTimeout(page, retryCount = 0) {
    if (retryCount >= 3) {
        throw new Error("MAX_RETRIES_EXCEEDED");
    }
    
    console.log(`Phát hiện timeout kết nối, chờ 30s rồi thử lại (lần ${retryCount + 1}/3)...`);
    console.app(`Phát hiện timeout kết nối, chờ 30s rồi thử lại (lần ${retryCount + 1}/3)...`);
    
    // Wait 30 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
        // Reload page
        console.log(`Đang refresh trang sau timeout...`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 7000 });
        
        // Wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`✅ Page refreshed successfully`);
        return true;
    } catch (error) {
        console.error(`Lỗi khi refresh trang:`, error.message);
        return false;
    }
}

// ✅ SINGLE OPTIMIZED waitForPageLoad FUNCTION
async function waitForPageLoad(page, timeout = 5000) {
    try {
        console.log('Đang chờ trang tải xong...');

        // Bounded wait: never block forever if Amazon keeps page in non-complete state.
        await page.waitForFunction(
            () => document.readyState === 'complete' || document.readyState === 'interactive',
            { timeout: Math.max(1000, timeout) }
        ).catch(() => null);

        // Short stabilization delay
        await new Promise(resolve => setTimeout(resolve, 300));
        
        console.log('✅ Page loaded successfully');
        
    } catch (error) {
        console.log(`Lỗi khi tải trang: ${error.message}, vẫn tiếp tục...`);
        
        // Minimal fallback
        await new Promise(resolve => setTimeout(resolve, 300));
    }
}

async function isCaptchaPage(page) {
    try {
        return await page.evaluate(() => {
            return !!(
                document.querySelector('form[action="/errors/validateCaptcha"] img') ||
                document.querySelector('#captchacharacters') ||
                document.body.innerText.includes('Enter the characters you see below') ||
                document.body.innerText.includes('Type the characters you see in this image')
            );
        });
    } catch (_) {
        return false;
    }
}

async function waitForManualCaptchaSolve(page, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const stillCaptcha = await isCaptchaPage(page);
        if (!stillCaptcha) {
            console.log("CAPTCHA đã được giải thủ công, tiếp tục login...");
            console.app("CAPTCHA đã được giải thủ công, tiếp tục login...");
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return false;
}

async function ensureEmailInputVisible(page) {
    const selectors = ['#ap_email_login', '#ap_email', 'input[name="email"]', 'input[type="email"]', 'input[name="ap_email"]'];
    for (const sel of selectors) {
        try {
            await page.waitForSelector(sel, { timeout: 5000 });
            return sel;
        } catch (_) {}
    }
    return null;
}

async function resolveAccountSwitcherFast(page) {
    try {
        const currentUrl = page.url() || '';
        const urlLooksLikeSwitcher =
            currentUrl.includes('/ax/claim') ||
            currentUrl.includes('/ax/signin') ||
            currentUrl.includes('switchaccount') ||
            currentUrl.includes('switch_account=picker') ||
            currentUrl.includes('switcher_type=');

        // Avoid probing with repeated evaluate calls when page is not in switcher context.
        if (!urlLooksLikeSwitcher) return false;

        for (let i = 0; i < 6; i++) {
            const handled = await Promise.race([
                page.evaluate(() => {
                const url = window.location.href || '';
                const isPickerPage = url.includes('switch_account=picker') || url.includes('switcher_type=');

                const clickish = (el) => {
                    if (!el) return false;
                    try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
                    try { el.click(); return true; } catch (_) {}
                    try {
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        return true;
                    } catch (_) {}
                    return false;
                };

                // Newer picker page: "Which account do you want to use?"
                if (isPickerPage) {
                    const pickerAction = document.querySelector('a.cvf-widget-btn-verify-account-switcher[role="button"]')
                        || document.querySelector('form.cvf-widget-form-account-switcher button[type="submit"]')
                        || document.querySelector('form.cvf-widget-form-account-switcher input[type="submit"]')
                        || document.querySelector('[data-test-id="customerName"]');
                    if (clickish(pickerAction)) return true;
                }

                const forms = Array.from(document.querySelectorAll('.cvf-widget-form-account-switcher'));
                if (!forms.length) return false;

                const targetForm = forms.find(f => {
                    const t = (f.querySelector('[data-test-id="accountType"]')?.textContent || '').toLowerCase();
                    return t.includes('personal account');
                }) || forms[0];

                if (!targetForm) return false;

                const customer = targetForm.querySelector('[data-test-id="customerName"]');
                const anchor = targetForm.querySelector('a.cvf-widget-btn-verify-account-switcher[role="button"]');

                // customerName can be a non-actionable text node; prefer actionable controls.
                if (clickish(anchor)) return true;
                if (clickish(customer)) {
                    const actionable = targetForm.querySelector('a.cvf-widget-btn-verify-account-switcher[role="button"]')
                        || targetForm.querySelector('button[type="submit"], input[type="submit"], button, [role="button"]');
                    if (clickish(actionable)) return true;
                }
                try {
                    if (typeof targetForm.submit === 'function') {
                        targetForm.submit();
                        return true;
                    }
                } catch (_) {}
                return false;
                }),
                new Promise(resolve => setTimeout(() => resolve(false), 2500))
            ]);

            if (handled) {
                try {
                    await Promise.race([
                        page.waitForNavigation({ timeout: 5000 }),
                        new Promise(resolve => setTimeout(resolve, 1200))
                    ]);
                } catch (_) {}
                return true;
            }

            await new Promise(resolve => setTimeout(resolve, 400));
        }
    } catch (_) {}
    return false;
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
            content.includes('Your account is currently under review') ||
            content.includes('Billing verification required') ||
            content.includes('your orders are on hold') ||
            content.includes('verify your billing information')) {
            return 'ACCOUNT_LOCKED';
        }
        
        // Check for captcha that might indicate suspicious activity
        if (content.includes('Enter the characters you see below') ||
            content.includes('Type the characters you see in this image')) {
            return 'SUSPICIOUS_ACTIVITY';
        }
        
        return 'NORMAL';
    } catch (error) {
        console.log(`Lỗi khi kiểm tra trạng thái account: ${error.message}`);
        return 'NORMAL';
    }
}

// Function to remove locked account from files
function removeLockedAccount(email) {
    try {
        console.log(`Bắt đầu xử lý xóa account bị khóa: ${email}`);
        console.app(`Bắt đầu xử lý xóa account bị khóa: ${email}`);
        
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
                console.log(`Đã xóa ${email} khỏi acc.txt`);
                console.app(`Đã xóa ${email} khỏi acc.txt`);
            } else {
                console.log(`Không tìm thấy account ${email} trong acc.txt`);
                console.app(`Không tìm thấy account ${email} trong acc.txt`);
            }
        } else {
            console.log(`Không tìm thấy file acc.txt tại: ${accPath}`);
            console.app(`Không tìm thấy file acc.txt tại: ${accPath}`);
        }

        // Remove from data.json with absolute path
        const dataPath = path.join(__dirname, '..', 'data', 'data.json');
        console.log(`Đang kiểm tra đường dẫn data.json: ${dataPath}`);
        
        if (fs.existsSync(dataPath)) {
            console.log(`data.json tồn tại, đang đọc nội dung...`);
            let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            let dataChanged = false;
            
            // Remove from childCount
            if (data.childCount && data.childCount[email]) {
                delete data.childCount[email];
                dataChanged = true;
                console.log(`Đã xóa ${email} khỏi childCount trong data.json`);
            }
            
            // Remove from businessAccounts if exists
            if (data.businessAccounts && Array.isArray(data.businessAccounts)) {
                const originalCount = data.businessAccounts.length;
                data.businessAccounts = data.businessAccounts.filter(acc => acc !== email);
                if (data.businessAccounts.length !== originalCount) {
                    dataChanged = true;
                    console.log(`Đã xóa ${email} khỏi businessAccounts trong data.json`);
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
                console.log(`Đã thêm ${email} vào lịch sử account bị khóa`);
            }
            
            if (dataChanged) {
                fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
                console.log(`Đã cập nhật data.json - xóa ${email}`);
                console.app(`Đã cập nhật data.json - xóa ${email}`);
            }
        } else {
            console.log(`Không tìm thấy data.json tại: ${dataPath}`);
            console.app(`Không tìm thấy data.json tại: ${dataPath}`);
        }
        
        // Create locked accounts report file
        const lockedReportPath = path.join(__dirname, '..', 'data', 'locked_accounts.txt');
        const timestamp = new Date().toISOString();
        const reportLine = `${timestamp}: ${email} - ACCOUNT_LOCKED - REMOVED_FROM_FILES\n`;
        fs.appendFileSync(lockedReportPath, reportLine, 'utf8');
        console.log(`Đã thêm vào báo cáo account bị khóa: ${lockedReportPath}`);
        
        return true;
    } catch (error) {
        console.error(`Lỗi khi xóa account bị khóa ${email}:`, error.message);
        console.app(`Lỗi khi xóa account bị khóa ${email}: ${error.message}`);
        return false;
    }
}

// Main login function
async function login(page, { email, pass, code, proxy }) {
    console.log("Gọi hàm login với email:", email, "và password:", pass);
    console.app("Gọi hàm login với email:", email, "và password:", pass);

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
            console.log(`Đang mở trang login (còn ${retries} lần thử)...`);
            console.app(`Đang mở trang login (còn ${retries} lần thử)...`);
            await page.goto(
                'https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https://www.amazon.com/?ref_=nav_signin&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.ns=http://specs.openid.net/auth/2.0',
                { waitUntil: 'domcontentloaded', timeout: 10000 }
            );
            
            // Wait for page to load completely
            await waitForPageLoad(page);
            
            success = true;
        } catch (err) {
            retries--;
            
            // Handle timeout errors
            if (err.message.includes('timeout') || err.message.includes('net::ERR_') || err.message.includes('Navigation timeout')) {
                console.log(`Phát hiện timeout điều hướng: ${err.message}`);
                
                try {
                    const handled = await handleConnectionTimeout(page, 3 - retries);
                    if (handled && retries > 0) {
                        console.log(`Thử lại sau khi xử lý timeout...`);
                        continue;
                    }
                } catch (timeoutError) {
                    console.log(`Xử lý timeout thất bại: ${timeoutError.message}`);
                }
            }
            
            if (retries === 0) {
                console.log("Không tải được trang login Amazon sau nhiều lần thử.");
                console.app("Không tải được trang login Amazon sau nhiều lần thử.");
                throw new Error("FAILED_LOAD_LOGIN_PAGE");
            }
            console.log(`Lỗi khi tải trang: ${err.message}. Đang thử lại...`);
            console.app(`Lỗi khi tải trang: ${err.message}. Đang thử lại...`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // Handle CAPTCHA if present
    if (await isCaptchaPage(page)) {
        if (global.data.parentAcc.geminiKey && global.data.parentAcc.geminiKey != "") {
            await handleCapcha(page, timeout);
            await waitForPageLoad(page);
        } else {
            console.log("Phát hiện CAPTCHA nhưng chưa có Gemini key. Vui lòng giải CAPTCHA trong cửa sổ browser.");
            console.app("Phát hiện CAPTCHA. Hãy giải thủ công trong browser (tối đa 120s)...");
            const solved = await waitForManualCaptchaSolve(page, 120000);
            if (!solved) {
                throw new Error("CAPTCHA_NOT_SOLVED_MANUALLY");
            }
            await waitForPageLoad(page);
        }
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
            let emailSelector = await ensureEmailInputVisible(targetPage);

            if (!emailSelector) {
                const currentUrl = targetPage.url();
                console.log(`⚠️ Email input not visible on URL: ${currentUrl}. Retrying signin page...`);
                console.app(`⚠️ Email input missing, reloading signin page...`);

                await targetPage.goto(
                    'https://www.amazon.com/ap/signin',
                    { waitUntil: 'domcontentloaded', timeout: 45000 }
                );
                await waitForPageLoad(targetPage, 10000);

                if (await isCaptchaPage(targetPage)) {
                    if (global.data.parentAcc.geminiKey && global.data.parentAcc.geminiKey != "") {
                        await handleCapcha(targetPage, timeout);
                    } else {
                        console.app("Phát hiện CAPTCHA. Hãy giải thủ công trong browser (tối đa 120s)...");
                        const solved = await waitForManualCaptchaSolve(targetPage, 120000);
                        if (!solved) throw new Error("CAPTCHA_NOT_SOLVED_MANUALLY");
                    }
                }

                emailSelector = await ensureEmailInputVisible(targetPage);
            }

            if (!emailSelector) {
                const finalUrl = targetPage.url();
                throw new Error(`EMAIL_FIELD_NOT_FOUND|URL=${finalUrl}`);
            }

            let filled = false;
            try {
                await targetPage.click(emailSelector, { clickCount: 3 });
                await targetPage.keyboard.press('Backspace');
                await targetPage.keyboard.type(email, { delay: 20 });
                filled = true;
            } catch (_) {}

            if (!filled) {
                await targetPage.evaluate(({ selector, value }) => {
                    const el = document.querySelector(selector);
                    if (!el) throw new Error('EMAIL_ELEMENT_NOT_FOUND');
                    el.focus();
                    el.value = value;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }, { selector: emailSelector, value: email });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.log("Lỗi khi nhập email:", error.message);
            console.app("Lỗi khi nhập email: " + error.message);
            throw new Error("FAILED_FILL_EMAIL");
        }
    }
    
    // Click continue button
    {
        const targetPage = page;
        try {
            await puppeteer.Locator.race([
                targetPage.locator('#continue'),
                targetPage.locator('input#continue'),
                targetPage.locator('button#continue'),
                targetPage.locator('input[type="submit"][name="continue"]')
            ])
                .setTimeout(8000)
                .click();
            await targetPage.waitForNavigation({ timeout: 8000 });
            await waitForPageLoad(page);
        } catch (error) {
            console.log("Lỗi sau khi bấm Continue:", error.message);
            console.app("Lỗi sau khi bấm Continue: " + error.message);
            throw new Error("FAILED_CLICK_CONTINUE");
        }
    }
    
    // Fill password field
    {
        const targetPage = page;
        try {
            let passwordSelector = null;
            const passwordSelectors = ['#ap_password', 'input[name="password"]', 'input[type="password"]'];
            for (const selector of passwordSelectors) {
                try {
                    await targetPage.waitForSelector(selector, { timeout: 4000 });
                    passwordSelector = selector;
                    break;
                } catch (_) {}
            }
            if (!passwordSelector) {
                throw new Error('PASSWORD_FIELD_NOT_FOUND');
            }
            try {
                await targetPage.locator(passwordSelector).fill(pass);
            } catch (_) {
                await targetPage.click(passwordSelector, { clickCount: 3 });
                await targetPage.keyboard.press('Backspace');
                await targetPage.keyboard.type(pass, { delay: 20 });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.log("Lỗi khi nhập password:", error.message);
            console.app("Lỗi khi nhập password: " + error.message);
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
                            await new Promise(r => setTimeout(r, 200));
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
                console.log(`Chờ điều hướng kết thúc với thông báo: ${navError.message}`);
            }
            
            // Wait for page to stabilize
            await waitForPageLoad(page);
            
            let afterClickUrl;
            try {
                afterClickUrl = await targetPage.url();
            } catch (e) {
                console.log('Lỗi khi lấy URL sau click, có thể trang đang chuyển hướng...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                afterClickUrl = await targetPage.url();
            }
            
            console.log(`🔍 URL before: ${beforeClickUrl}`);
            console.log(`🔍 URL after: ${afterClickUrl}`);
            
            // Check account status after sign in
            const accountStatus = await detectAccountStatus(targetPage);
            
            if (accountStatus === 'ACCOUNT_LOCKED') {
                console.log(`Account ${email} bị khóa hoặc bị tạm ngưng`);
                console.app(`Account ${email} bị khóa hoặc bị tạm ngưng`);
                
                // Remove account from files immediately
                const removeResult = removeLockedAccount(email);
                if (removeResult) {
                    console.log(`Đã xử lý xóa account bị khóa cho ${email}`);
                } else {
                    console.log(`Không thể xóa account bị khóa ${email} khỏi file`);
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
                    console.log(`Account ${email} bị khóa (phát hiện sau bước kiểm tra password)`);
                    console.app(`Account ${email} bị khóa (phát hiện sau bước kiểm tra password)`);
                    
                    const removeResult = removeLockedAccount(email);
                    if (removeResult) {
                        console.log(`Đã xử lý xóa account bị khóa cho ${email}`);
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
                        console.log(`Sai password cho ${email}`);
                        console.app(`Sai password cho ${email}`);
                        throw new Error("INCORRECT_PASS");
                    }
                }
            }
            
            console.log('Đã bấm Sign in thành công');
            
        } catch (error) {
            console.log("Lỗi sau khi bấm Sign in:", error.message);
            console.app("Lỗi sau khi bấm Sign in: " + error.message);
            
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
        console.log("Phát hiện trang MFA, đang xử lý MFA...");

        let mfaRetries = 3;
        while (mfaRetries > 0) {
            try {
                let twofactor = require("node-2fa");
                let mfaToken = twofactor.generateToken(code).token;
                console.log("Đã tạo mã MFA:", mfaToken);

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
                        console.log("Đã bấm tùy chọn 'Don't require'");
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (dontRequireError) {
                    console.log("Không tìm thấy hoặc không bấm được tùy chọn 'Don't require', tiếp tục...");
                }

                {
                    const targetPage = page;
                    await targetPage.locator('#auth-signin-button').click();
                    // User-requested fast path after MFA: no heavy page-load wait here.
                    await new Promise(resolve => setTimeout(resolve, 3500));
                }

                console.log("Đã xử lý MFA thành công");
                break; // Success
                
            } catch (mfaError) {
                mfaRetries--;
                console.log(`Lỗi khi xử lý MFA (còn ${mfaRetries} lần thử):`, mfaError.message);
                
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

    // Fast continue after MFA (requested): keep only a short fixed delay.
    await new Promise(resolve => setTimeout(resolve, 500));

    // Immediately resolve account switcher to avoid hanging on /ax/claim page.
    await resolveAccountSwitcherFast(page);

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

    // Handle account switcher for normal login: only probe when switcher-like URL/content is present
    try {
        const targetPage = page;
        const shouldCheckSwitcher = await targetPage.evaluate(() => {
            const url = window.location.href || '';
            if (url.includes('/ax/claim') || url.includes('/ax/signin') || url.includes('switchaccount') || url.includes('switch_account=picker') || url.includes('switcher_type=')) return true;
            return !!document.querySelector('a.cvf-widget-btn-verify-account-switcher[role="button"]');
        });

        if (!shouldCheckSwitcher) {
            console.log("Không phát hiện màn chọn account, bỏ qua bước xử lý switcher.");
            throw new Error("__SKIP_SWITCHER__");
        }

        let clickedSwitcher = false;
        for (let attempt = 0; attempt < 2; attempt++) {
            clickedSwitcher = await targetPage.evaluate(() => {
                const url = window.location.href || '';
                const isPickerPage = url.includes('switch_account=picker') || url.includes('switcher_type=');

                const smartClick = (el) => {
                    if (!el) return false;
                    try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
                    try { el.click(); return true; } catch (_) {}
                    try {
                        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                        return true;
                    } catch (_) {}
                    return false;
                };

                // Newer picker page: click actionable switcher control first.
                if (isPickerPage) {
                    const pickerAction = document.querySelector('a.cvf-widget-btn-verify-account-switcher[role="button"]')
                        || document.querySelector('form.cvf-widget-form-account-switcher button[type="submit"]')
                        || document.querySelector('form.cvf-widget-form-account-switcher input[type="submit"]')
                        || document.querySelector('[data-test-id="customerName"]');
                    if (smartClick(pickerAction)) return true;
                }

                const forms = Array.from(document.querySelectorAll('.cvf-widget-form-account-switcher'));
                if (!forms.length) return false;

                const isPersonalForm = (form) => {
                    const accountType = form.querySelector('[data-test-id="accountType"]');
                    return (accountType?.textContent || '').toLowerCase().includes('personal account');
                };

                const targetForm = forms.find(isPersonalForm) || forms[0];
                if (!targetForm) return false;

                const customerNameNode = targetForm.querySelector('[data-test-id="customerName"]');
                const anchorNode = targetForm.querySelector('a.cvf-widget-btn-verify-account-switcher[role="button"]');

                // customerName can be just display text. Prefer actionable switcher controls.
                if (smartClick(anchorNode)) return true;
                if (smartClick(customerNameNode)) {
                    const actionable = targetForm.querySelector('a.cvf-widget-btn-verify-account-switcher[role="button"]')
                        || targetForm.querySelector('button[type="submit"], input[type="submit"], button, [role="button"]');
                    if (smartClick(actionable)) return true;
                }

                // Fallback: submit parent form explicitly.
                try {
                    if (typeof targetForm.submit === 'function') {
                        targetForm.submit();
                        return true;
                    }
                } catch (_) {}
                return false;
            });
            if (clickedSwitcher) break;
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        if (clickedSwitcher) {
            try {
                await Promise.race([
                    targetPage.waitForNavigation({ timeout: 5000 }),
                    new Promise(resolve => setTimeout(resolve, 1200))
                ]);
            } catch (_) {}
            await waitForPageLoad(page);
            console.log("Đã bấm lựa chọn account cá nhân");
        } else {
            console.log("Không tìm thấy lựa chọn đổi account sau MFA, tiếp tục...");
        }
    } catch (error) {
        if (error.message !== "__SKIP_SWITCHER__") {
            console.log("Xử lý màn chọn account thất bại, tiếp tục...");
        }
    }

    // Safety: if still stuck on account switch page, force go home.
    if (
        page.url().includes('/ax/claim') ||
        page.url().includes('switchaccount') ||
        page.url().includes('switch_account=picker') ||
        page.url().includes('switcher_type=')
    ) {
        try {
            await page.goto('https://www.amazon.com/?ref_=nav_signin', {
                waitUntil: 'domcontentloaded',
                timeout: 7000
            });
        } catch (_) {}
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
            console.log(`Account ${email} bị khóa (kiểm tra cuối)`);
            
            const removeResult = removeLockedAccount(email);
            if (removeResult) {
                console.log(`Đã xử lý xóa account bị khóa cho ${email}`);
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
                console.log(`Account ${email} bị khóa (kiểm tra nút Continue)`);
                
                const removeResult = removeLockedAccount(email);
                if (removeResult) {
                    console.log(`Đã xử lý xóa account bị khóa cho ${email}`);
                }
                
                throw new Error("ACCOUNT_LOCKED");
            }
        }
        
        // keep final wait minimal to avoid post-MFA lag
    }

    // Wait briefly for final navigation to settle
    await new Promise((resolve, reject) => {
        let interval = setInterval(() => {
            const u = page.url();
            if (
                u.includes('amazon.com/?') ||
                u.includes('amazon.com/') ||
                u.includes('/a/addresses') ||
                u.includes('/cpe/yourpayments') ||
                u.includes('account-status.amazon.com') ||
                u.length <= 25
            ) {
                clearInterval(interval);
                resolve();
                return;
            }
        }, 1000);
        
        // Timeout quickly to avoid long hangs on intermediate pages
        setTimeout(() => {
            clearInterval(interval);
            resolve();
        }, 8000);
    });
    
    // final page load wait removed to reduce latency
    
    console.log(`Login thành công cho ${email}`);
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
            console.log("Không phát hiện form CAPTCHA, tiếp tục...");
            captchaResolved = true;
            return;
        }

        console.log(`Phát hiện CAPTCHA, đang thử giải (lần ${captchaAttempts}/${maxCaptchaAttempts})...`);
        
        try {
            const captchaSrc = await page.evaluate(() => {
                const captchaImage = document.querySelector('form[action="/errors/validateCaptcha"] img');
                return captchaImage ? captchaImage.src : null;
            });

            console.log("Nguồn ảnh CAPTCHA:", captchaSrc);
            const resCapcha = await require(path.join(__dirname, "capcha.js"))(captchaSrc);

            if (!resCapcha || !resCapcha.success) {
                console.log("Giải CAPTCHA thất bại, thử lại...");
                continue;
            }

            console.log("Kết quả CAPTCHA:", resCapcha);
            console.app("Kết quả CAPTCHA:", resCapcha.captchaCode);

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
                            console.log("Chờ chuyển trang sau khi submit CAPTCHA bị timeout, vẫn tiếp tục");
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
                    console.log("CAPTCHA vẫn còn sau khi submit, thử lại...");
                } else {
                    console.log("Đã vượt CAPTCHA thành công!");
                    captchaResolved = true;
                }
            } catch (e) {
                console.log("Lỗi khi kiểm tra form CAPTCHA:", e);
                captchaResolved = true;
            }
            
        } catch (captchaError) {
            console.log(`Lỗi khi xử lý CAPTCHA: ${captchaError.message}`);
            
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
