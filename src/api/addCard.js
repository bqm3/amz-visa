const puppeteer = require('puppeteer');

// ✅ ADD FRAME DETACHMENT HANDLER
async function safePageReload(page, timeout = 10000) {
    try {
        console.log("🔄 Attempting safe page reload...");
        
        // Check if page is still attached
        if (page.isClosed()) {
            console.log("❌ Page is already closed, cannot reload");
            throw new Error('PAGE_CLOSED');
        }
        
        await page.reload({ 
            waitUntil: ['domcontentloaded'], 
            timeout: timeout 
        });
        
        console.log("✅ Page reloaded successfully");
        return true;
        
    } catch (reloadError) {
        console.log(`❌ Page reload failed: ${reloadError.message}`);
        
        // If frame detached or page closed, signal for full restart
        if (reloadError.message.includes('detached Frame') || 
            reloadError.message.includes('Session closed') ||
            reloadError.message.includes('Page has been closed')) {
            throw new Error('FRAME_DETACHED');
        }
        
        throw reloadError;
    }
}

// ✅ CHECK IF IFRAME IS STILL VALID
async function isIframeValid(page, iframeSelector) {
    try {
        const elementHandle = await page.$(iframeSelector);
        if (!elementHandle) return false;
        
        const iframe = await elementHandle.contentFrame();
        if (!iframe) return false;
        
        // Try to access iframe content
        await iframe.evaluate(() => document.readyState);
        return true;
    } catch (error) {
        return false;
    }
}

async function addCard(page, cardInfo, retryCount = 0) {
    const maxRetries = 3;
    if (retryCount >= maxRetries) {
        console.log(`❌ Max retries (${maxRetries}) reached for addCard`);
        return { success: false, error: 'MAX_RETRIES_EXCEEDED', step: 'max_retries' };
    }
    
    try {
        const timeout = 15 * 1000; // ✅ INCREASED TIMEOUT
        page.setDefaultTimeout(timeout);

        // ✅ CHECK PAGE VALIDITY AT START
        if (page.isClosed()) {
            console.log("❌ Page is closed at start");
            return { success: false, error: 'PAGE_CLOSED', step: 'initial_check', shouldRetry: true };
        }

        // ✅ NAVIGATE TO PAYMENT PAGE FIRST
        try {
            console.log('🔄 Ensuring we are on payment page...');
            const currentUrl = page.url();
            
            if (!currentUrl.includes('yourpayments') || !currentUrl.includes('wallet')) {
                await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        } catch (navError) {
            console.log(`❌ Navigation error: ${navError.message}`);
            return { success: false, error: 'NAVIGATION_ERROR', step: 'navigation', shouldRetry: true };
        }

        // Step 1: Click "Add a payment method" - ✅ IMPROVED WITH RETRY
        try {
            console.log('📋 Step 1: Clicking Add Payment Method...');
            let clicked = false;
            let clickAttempts = 0;
            const maxClickAttempts = 5;
            
            while (!clicked && clickAttempts < maxClickAttempts) {
                clickAttempts++;
                console.log(`   Attempt ${clickAttempts}/${maxClickAttempts}`);
                
                try {
                    // Method 1: Race locator
                    await puppeteer.Locator.race([
                        page.locator('::-p-aria(Add a payment method[role=\\"link\\"])'),
                        page.locator('#pp-paEOaP-10'),
                        page.locator('::-p-xpath(//*[@id=\\"pp-paEOaP-10\\"])'),
                        page.locator(':scope >>> #pp-paEOaP-10')
                    ])
                        .setTimeout(8000) 
                        .click();
                    clicked = true;
                    console.log('   ✅ Race locator worked');
                    break;
                    
                } catch (raceError) {
                    console.log('   ❌ Race locator failed, trying alternatives...');
                }
                
                try {
                    // Method 2: Direct selector
                    const addButton = await page.waitForSelector('a[href*="payment"], button:has-text("Add a payment method"), a:has-text("Add a payment method")', { timeout: 5000 });
                    if (addButton) {
                        await addButton.click();
                        clicked = true;
                        console.log('   ✅ Direct selector worked');
                        break;
                    }
                } catch (directError) {
                    console.log('   ❌ Direct selector failed');
                }
                
                try {
                    // Method 3: JavaScript evaluation
                    const jsResult = await page.evaluate(() => {
                        const selectors = [
                            'a[href*="payment"]',
                            'button[data-testid*="add-payment"]', 
                            'a[data-testid*="add-payment"]',
                            '*[id*="pp-paEOaP"]'
                        ];
                        
                        for (const selector of selectors) {
                            const element = document.querySelector(selector);
                            if (element) {
                                element.click();
                                return { success: true, selector };
                            }
                        }
                        
                        // Try by text content
                        const elements = [...document.querySelectorAll('a, button')];
                        for (const el of elements) {
                            if (el.textContent.toLowerCase().includes('add') && 
                                el.textContent.toLowerCase().includes('payment')) {
                                el.click();
                                return { success: true, selector: 'text-based' };
                            }
                        }
                        
                        return { success: false };
                    });
                    
                    if (jsResult.success) {
                        clicked = true;
                        console.log(`   ✅ JavaScript worked with ${jsResult.selector}`);
                        break;
                    }
                } catch (jsError) {
                    console.log('   ❌ JavaScript failed');
                }
                
                // Wait before retry
                if (clickAttempts < maxClickAttempts) {
                    console.log('   ⏳ Waiting 2s before retry...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Try page refresh on 3rd attempt
                    if (clickAttempts === 3) {
                        console.log('   🔄 Refreshing page...');
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            }
            
            if (!clicked) {
                throw new Error(`Failed to click Add Payment Method after ${maxClickAttempts} attempts`);
            }
            
            console.log('✅ Step 1 completed - Add Payment Method clicked');
            
        } catch (error) {
            console.log(`❌ Step 1 failed: ${error.message}`);
            return { success: false, error: error.message, step: 'add_payment_method', shouldRetry: retryCount < maxRetries - 1 };
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 2: Click "Add a credit or debit card" - ✅ SIMILAR IMPROVEMENTS
        try {
            console.log('💳 Step 2: Selecting Credit/Debit Card...');
            let creditCardClicked = false;
            let attempts = 0;
            const maxAttempts = 5;
            
            while (!creditCardClicked && attempts < maxAttempts) {
                attempts++;
                console.log(`   Attempt ${attempts}/${maxAttempts}`);
                
                try {
                    await puppeteer.Locator.race([
                        page.locator('::-p-aria(Add a credit or debit card)'),
                        page.locator('#pp-7diwwq-34 input'),
                        page.locator('::-p-xpath(//*[@id=\\"pp-7diwwq-36\\"]/span/input)'),
                        page.locator(':scope >>> #pp-7diwwq-34 input')
                    ])
                        .setTimeout(8000)
                        .click();
                    creditCardClicked = true;
                    console.log('   ✅ Race locator worked');
                    break;
                    
                } catch (raceError) {
                    console.log('   ❌ Race locator failed');
                }
                
                try {
                    const creditButton = await page.waitForSelector('input[type="radio"][value*="credit"], input[type="radio"][value*="card"], label:has-text("credit"):has(input)', { timeout: 5000 });
                    if (creditButton) {
                        await creditButton.click();
                        creditCardClicked = true;
                        console.log('   ✅ Direct selector worked');
                        break;
                    }
                } catch (directError) {
                    console.log('   ❌ Direct selector failed');
                }
                
                try {
                    const jsResult = await page.evaluate(() => {
                        const elements = [
                            ...document.querySelectorAll('input[type="radio"]'),
                            ...document.querySelectorAll('label'),
                            ...document.querySelectorAll('button')
                        ];
                        
                        for (const element of elements) {
                            const text = element.textContent || element.value || element.getAttribute('aria-label') || '';
                            if (text.toLowerCase().includes('credit') || text.toLowerCase().includes('debit') || text.toLowerCase().includes('card')) {
                                element.click();
                                return { success: true, text: text.slice(0, 30) };
                            }
                        }
                        return { success: false };
                    });
                    
                    if (jsResult.success) {
                        creditCardClicked = true;
                        console.log(`   ✅ JavaScript worked: ${jsResult.text}`);
                        break;
                    }
                } catch (jsError) {
                    console.log('   ❌ JavaScript failed');
                }
                
                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            if (!creditCardClicked) {
                throw new Error(`Failed to select credit/debit card after ${maxAttempts} attempts`);
            }
            
            console.log('✅ Step 2 completed - Credit/Debit Card selected');
            
        } catch (error) {
            console.log(`❌ Step 2 failed: ${error.message}`);
            return { success: false, error: error.message, step: 'add_credit_card', shouldRetry: retryCount < maxRetries - 1 };
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 3-8: All iframe operations with improved error handling
        // Step 3: Enter card number
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    await iframe.waitForSelector('.a-input-text.a-form-normal.pmts-account-Number', { timeout: 5000 });
                    await iframe.locator('.a-input-text.a-form-normal.pmts-account-Number').click({
                        offset: { x: 66.92500305175781, y: 16.899993896484375 }
                    });
                    await iframe.locator('.a-input-text.a-form-normal.pmts-account-Number').fill(cardInfo.number);
                }
            } catch (error) {
                console.log("Card number entry failed:", error.message);
                
                // ✅ CHECK FOR FRAME DETACHMENT
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed')) {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during card number entry");
                return { success: false, error: 'FRAME_DETACHED', step: 'enter_card_number' };
            }
            
            console.error('Error entering card number:', error);
            return { success: false, error: error, step: 'enter_card_number' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 4: Enter cardholder name
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // ✅ CHECK IFRAME VALIDITY BEFORE USE
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    await iframe.waitForSelector('.a-input-text.a-form-normal.apx-add-credit-card-account-holder-name-input.mcx-input-fields', { timeout: 5000 });
                    await iframe.locator('.a-input-text.a-form-normal.apx-add-credit-card-account-holder-name-input.mcx-input-fields').fill(cardInfo.name);
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during name entry:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during name entry");
                return { success: false, error: 'FRAME_DETACHED', step: 'enter_cardholder_name' };
            }
            
            console.error('Error entering cardholder name:', error);
            return { success: false, error: error, step: 'enter_cardholder_name' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 5: Handle checkbox and month selection
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // ✅ CHECK IFRAME VALIDITY
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }

                    const isChecked = await iframe.evaluate(selector => {
                        const element = document.querySelector(selector);
                        return element ? element.checked : false;
                    }, '.a-checkbox.pmts-update-everywhere-checkbox.a-spacing-base label input');
                    console.log('Checkbox is checked:', isChecked);
                    if (isChecked) {
                        await iframe.locator('.a-checkbox.pmts-update-everywhere-checkbox.a-spacing-base label input').click();
                    }
                    
                    await iframe.locator('.a-button-text.a-declarative').click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    const monthIndex = Number(cardInfo.month);
                    console.log(`Selecting month: ${monthIndex}`);
                    
                    await iframe.locator('.a-popover.a-dropdown.a-dropdown-common.a-declarative > :nth-child(2) > :nth-child(1) > :nth-child(1) > :nth-child(' + monthIndex + ') > :nth-child(1)').click();
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during month selection:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during month selection");
                return { success: false, error: 'FRAME_DETACHED', step: 'handle_checkbox_month' };
            }
            
            console.error('Error handling checkbox and month selection:', error);
            return { success: false, error: error, step: 'handle_checkbox_month' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 6: Select year - ✅ CLEAN VERSION WITHOUT DEBUG LOGS
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    // Click year dropdown button
                    await iframe.locator('.a-button.a-button-dropdown.pmts-expiry-year.pmts-portal-component .a-button-text.a-declarative').click();
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    const currentYear = new Date().getFullYear();
                    const targetYear = Number(cardInfo.year);
                    const yearDifference = targetYear - currentYear;
                    
                    let yearSelected = false;
                    
                    // ✅ STRATEGY 1: Find all year options dynamically (NO DEBUG LOGS)
                    try {
                        await iframe.waitForSelector('.a-popover[aria-hidden="false"]', { timeout: 3000 });
                        
                        const yearOptions = await iframe.evaluate(() => {
                            const popover = document.querySelector('.a-popover[aria-hidden="false"]');
                            if (!popover) return [];
                            
                            const links = popover.querySelectorAll('a');
                            return Array.from(links).map((link, index) => ({
                                index: index + 1,
                                text: link.textContent.trim(),
                                element: link
                            }));
                        });
                        
                        const matchingOption = yearOptions.find(option => option.text === targetYear.toString());
                        
                        if (matchingOption) {
                            await iframe.evaluate((targetText) => {
                                const popover = document.querySelector('.a-popover[aria-hidden="false"]');
                                const links = popover.querySelectorAll('a');
                                for (const link of links) {
                                    if (link.textContent.trim() === targetText) {
                                        link.click();
                                        return true;
                                    }
                                }
                                return false;
                            }, targetYear.toString());
                            
                            yearSelected = true;
                        }
                        
                    } catch (yearError1) {
                        // Silent fail
                    }
                    
                    // ✅ STRATEGY 2: Try with calculated index (NO DEBUG LOGS)
                    if (!yearSelected) {
                        try {
                            const yearIndex = yearDifference + 1;
                            
                            const popoverSelectors = [
                                '.a-popover[aria-hidden="false"] ul li:nth-child(' + yearIndex + ') a',
                                '.a-popover[aria-hidden="false"] .a-dropdown-item:nth-child(' + yearIndex + ')',
                                '.a-popover[aria-hidden="false"] a:nth-child(' + yearIndex + ')',
                                '#a-popover-3 > :nth-child(2) > :nth-child(1) > :nth-child(1) > :nth-child(' + yearIndex + ') > :nth-child(1)'
                            ];
                            
                            for (const selector of popoverSelectors) {
                                try {
                                    await iframe.waitForSelector(selector, { timeout: 2000 });
                                    await iframe.click(selector);
                                    yearSelected = true;
                                    break;
                                } catch (selectorError) {
                                    continue;
                                }
                            }
                        } catch (yearError2) {
                            // Silent fail
                        }
                    }
                    
                    // ✅ STRATEGY 3: Brute force try all possible indices (NO DEBUG LOGS)
                    if (!yearSelected) {
                        for (let i = 1; i <= 20; i++) {
                            try {
                                const selector = `.a-popover[aria-hidden="false"] a:nth-child(${i})`;
                                await iframe.waitForSelector(selector, { timeout: 1000 });
                                
                                const yearText = await iframe.evaluate((sel) => {
                                    const element = document.querySelector(sel);
                                    return element ? element.textContent.trim() : '';
                                }, selector);
                                
                                if (yearText === targetYear.toString()) {
                                    await iframe.click(selector);
                                    yearSelected = true;
                                    break;
                                }
                            } catch (bruteError) {
                                continue;
                            }
                        }
                    }
                    
                    // ✅ STRATEGY 4: Keyboard navigation as last resort (NO DEBUG LOGS)
                    if (!yearSelected) {
                        try {
                            await iframe.focus('.a-button.a-button-dropdown.pmts-expiry-year.pmts-portal-component');
                            
                            const currentYear = new Date().getFullYear();
                            const targetYear = Number(cardInfo.year);
                            const yearDiff = targetYear - currentYear;
                            
                            if (yearDiff >= 0) {
                                for (let i = 0; i < yearDiff; i++) {
                                    await iframe.keyboard.press('ArrowDown');
                                    await new Promise(resolve => setTimeout(resolve, 200));
                                }
                            } else {
                                for (let i = 0; i < Math.abs(yearDiff); i++) {
                                    await iframe.keyboard.press('ArrowUp');
                                    await new Promise(resolve => setTimeout(resolve, 200));
                                }
                            }
                            
                            await iframe.keyboard.press('Enter');
                            yearSelected = true;
                            
                        } catch (keyboardError) {
                            // Silent fail
                        }
                    }
                    
                    if (!yearSelected) {
                        throw new Error(`All year selection strategies failed for year ${targetYear}`);
                    }
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during year selection:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during year selection");
                return { success: false, error: 'FRAME_DETACHED', step: 'select_year' };
            }
            
            console.error('Error selecting year:', error);
            return { success: false, error: error.message, step: 'select_year' };
        }
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Step 7: Submit card
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_INVALID');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 8000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    console.error('Could not find credit card iframe');
                    throw new Error('IFRAME_NOT_FOUND');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_CONTENT_FRAME_NULL');
                    }
                    
                    await iframe.waitForSelector('.a-button-input', { timeout: 5000 });
                    await iframe.locator('.a-button-input').click({
                        offset: { x: 2.125, y: 13.5 }
                    });
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during submission:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed') ||
                    error.message === 'IFRAME_INVALID') {
                    throw new Error('FRAME_DETACHED');
                }
                
                throw error;
            }
        } catch (error) {
            if (error.message === 'FRAME_DETACHED') {
                console.log("❌ Frame detached during card submission");
                return { success: false, error: 'FRAME_DETACHED', step: 'submit_card' };
            }
            
            console.error('Error submitting card:', error);
            return { success: false, error: error, step: 'submit_card' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 8: Confirm address - ✅ CLEAN VERSION WITHOUT DEBUG LOGS
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    return { success: true };
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 6000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    return { success: true };
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        return { success: true };
                    }
                    
                    let addressConfirmed = false;
                    
                    // Strategy 1: Original selector (NO DEBUG LOGS)
                    try {
                        await iframe.waitForSelector('span.a-button.a-spacing-base.a-button-primary.pmts-use-selected-address.pmts-button-input input.a-button-input', { timeout: 3000 });
                        await iframe.locator('span.a-button.a-spacing-base.a-button-primary.pmts-use-selected-address.pmts-button-input input.a-button-input').click({
                            offset: {
                                x: 51.53749084472656,
                                y: 13.699981689453125,
                            },
                        });
                        addressConfirmed = true;
                    } catch (addr1Error) {
                        // Silent fail
                    }
                    
                    // Strategy 2: Generic button selectors (NO DEBUG LOGS)
                    if (!addressConfirmed) {
                        try {
                            const buttonSelectors = [
                                'input[type="submit"]',
                                '.a-button-input',
                                'button[type="submit"]',
                                '*[class*="use-selected-address"] input',
                                '*[class*="pmts-button"] input'
                            ];
                            
                            for (const selector of buttonSelectors) {
                                try {
                                    await iframe.waitForSelector(selector, { timeout: 2000 });
                                    await iframe.click(selector);
                                    addressConfirmed = true;
                                    break;
                                } catch (selectorError) {
                                    continue;
                                }
                            }
                        } catch (addr2Error) {
                            // Silent fail
                        }
                    }
                    
                    // Strategy 3: JavaScript click (NO DEBUG LOGS)
                    if (!addressConfirmed) {
                        try {
                            const jsResult = await iframe.evaluate(() => {
                                const buttons = [
                                    ...document.querySelectorAll('input[type="submit"]'),
                                    ...document.querySelectorAll('button'),
                                    ...document.querySelectorAll('.a-button-input'),
                                    ...document.querySelectorAll('*[class*="use-selected-address"]'),
                                    ...document.querySelectorAll('*[class*="button"]')
                                ];
                                
                                for (const button of buttons) {
                                    const text = button.textContent || button.value || '';
                                    if (text.toLowerCase().includes('use') || 
                                        text.toLowerCase().includes('confirm') ||
                                        text.toLowerCase().includes('continue') ||
                                        button.type === 'submit') {
                                        try {
                                            button.click();
                                            return { success: true, method: 'javascript', text: text.slice(0, 30) };
                                        } catch (e) {
                                            continue;
                                        }
                                    }
                                }
                                return { success: false };
                            });
                            
                            if (jsResult.success) {
                                addressConfirmed = true;
                            }
                        } catch (addr3Error) {
                            // Silent fail
                        }
                    }
                }
            } catch (error) {
                console.error('Error interacting with credit card iframe during address confirmation:', error.message);
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Session closed')) {
                    return { success: true };
                }
            }
        } catch (error) {
            console.error('Error confirming address:', error);
        }

        return { success: true };
        
    } catch (error) {
        console.error('Error in addCard function:', error);
        
        if (error.message === 'FRAME_DETACHED' || 
            error.message.includes('detached Frame') ||
            error.message.includes('Session closed')) {
            
            return { success: false, error: 'FRAME_DETACHED', step: 'frame_detached', shouldRestart: true };
        }
        
        return { 
            success: false, 
            error: error.message, 
            shouldRetry: retryCount < maxRetries - 1 
        };
    }
}

module.exports = addCard;