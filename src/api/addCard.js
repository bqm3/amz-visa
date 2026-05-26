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

async function findFrameWithSelector(page, selectors, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const frames = page.frames();
        for (const frame of frames) {
            for (const selector of selectors) {
                try {
                    const handle = await frame.$(selector);
                    if (handle) {
                        return { frame, selector };
                    }
                } catch (error) {
                    // Keep scanning; frames can detach/reattach during Amazon transitions.
                }
            }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return null;
}

async function fillCardNumberAcrossFrames(page, cardNumber, selectors, timeoutMs = 9000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const frames = page.frames();
        for (const frame of frames) {
            for (const selector of selectors) {
                try {
                    await typeVisibleInputValue(frame, [selector], cardNumber, 'Card number', { digitsOnly: true });
                    return { ok: true, mode: `typed-frame:${selector}` };
                } catch (_) {}

                try {
                    await fillVisibleInputValue(frame, [selector], cardNumber, 'Card number', { digitsOnly: true });
                    return { ok: true, mode: `visible-frame:${selector}` };
                } catch (_) {}

                try {
                    const input = await frame.$(selector);
                    if (!input) continue;
                    await input.click({ clickCount: 3 });
                    await frame.keyboard.press('Backspace');
                    await frame.keyboard.type(cardNumber, { delay: 20 });
                    const verified = await frame.evaluate((sel, expected) => {
                        const input = document.querySelector(sel);
                        const actual = String(input?.value || '').replace(/\D/g, '');
                        const wanted = String(expected || '').replace(/\D/g, '');
                        return actual === wanted;
                    }, selector, cardNumber);
                    if (verified) return { ok: true, mode: `keyboard-frame:${selector}` };
                } catch (_) {}
            }

            try {
                const heuristic = await fillCardNumberHeuristic(frame, cardNumber);
                if (heuristic) return { ok: true, mode: 'heuristic' };
            } catch (_) {}
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { ok: false, mode: 'not_found' };
}

async function getCardFieldDiagnostics(page, selectors) {
    const diagnostics = [];
    for (const [frameIndex, frame] of page.frames().entries()) {
        try {
            const frameData = await frame.evaluate((sels) => {
                const result = [];
                for (const selector of sels) {
                    const nodes = Array.from(document.querySelectorAll(selector));
                    if (!nodes.length) continue;
                    result.push({
                        selector,
                        count: nodes.length,
                        fields: nodes.slice(0, 3).map((el) => {
                            const style = window.getComputedStyle(el);
                            const rect = el.getBoundingClientRect();
                            return {
                                name: el.getAttribute('name') || '',
                                id: el.id || '',
                                type: el.getAttribute('type') || '',
                                visible: style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0,
                                width: Math.round(rect.width),
                                height: Math.round(rect.height),
                                disabled: !!el.disabled,
                                readOnly: !!el.readOnly,
                                valueLength: String(el.value || '').length
                            };
                        })
                    });
                }
                return result;
            }, selectors);
            if (frameData.length) {
                diagnostics.push({
                    frameIndex,
                    url: (frame.url() || '').slice(0, 120),
                    matches: frameData
                });
            }
        } catch (_) {}
    }
    return diagnostics;
}

async function fillCvvAcrossFrames(page, cvc, timeoutMs = 8000) {
    const cvvSelectors = [
        'input[autocomplete="cc-csc"]',
        'input[name="addCreditCardVerificationNumber"]',
        'input[name*="Verification"]',
        'input[name*="verification"]',
        'input[name*="cvv" i]',
        'input[name*="cvc" i]',
        'input[name*="csc" i]',
        'input[id*="verification" i]',
        'input[id*="cvv" i]',
        'input[id*="cvc" i]',
        'input[aria-label*="security code" i]',
        'input[aria-label*="cvv" i]',
        'input[placeholder*="security code" i]',
        'input[placeholder*="cvv" i]'
    ];

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        for (const frame of page.frames()) {
            for (const selector of cvvSelectors) {
                try {
                    await typeVisibleInputValue(frame, [selector], String(cvc), 'CVV', { digitsOnly: true });
                    return { ok: true, mode: `typed:${selector}` };
                } catch (_) {}

                try {
                    await fillVisibleInputValue(frame, [selector], String(cvc), 'CVV', { digitsOnly: true });
                    return { ok: true, mode: `selector:${selector}` };
                } catch (_) {}
            }

            try {
                const heuristic = await frame.evaluate((value) => {
                    const isVisible = (el) => {
                        if (!el || el.disabled || el.readOnly) return false;
                        const style = window.getComputedStyle(el);
                        const rect = el.getBoundingClientRect();
                        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                    };
                    const setNativeValue = (el, nextValue) => {
                        el.focus();
                        try { el.click(); } catch (_) {}
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (setter) setter.call(el, nextValue);
                        else el.value = nextValue;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        el.blur();
                    };

                    const scoreInput = (el) => {
                        if (!isVisible(el)) return -1;
                        const attrs = [
                            el.getAttribute('autocomplete') || '',
                            el.getAttribute('name') || '',
                            el.getAttribute('id') || '',
                            el.getAttribute('aria-label') || '',
                            el.getAttribute('placeholder') || '',
                            el.className || ''
                        ].join(' ').toLowerCase();

                        let score = 0;
                        if (attrs.includes('cc-csc')) score += 120;
                        if (attrs.includes('security code')) score += 110;
                        if (attrs.includes('verification')) score += 100;
                        if (attrs.includes('cvv')) score += 100;
                        if (attrs.includes('cvc')) score += 100;
                        if (attrs.includes('csc')) score += 80;
                        const maxLength = Number(el.getAttribute('maxlength') || 0);
                        if (maxLength === 3 || maxLength === 4) score += 30;
                        if ((el.type || '').toLowerCase() === 'tel') score += 10;
                        return score;
                    };

                    const inputs = Array.from(document.querySelectorAll('input'));
                    const best = inputs
                        .map(input => ({ input, score: scoreInput(input) }))
                        .sort((a, b) => b.score - a.score)[0];

                    if (!best || best.score < 30) return null;
                    setNativeValue(best.input, value);
                    const actual = String(best.input.value || '').replace(/\D/g, '');
                    const wanted = String(value || '').replace(/\D/g, '');
                    if (actual !== wanted) return null;

                    return {
                        name: best.input.getAttribute('name') || '',
                        id: best.input.id || '',
                        score: best.score
                    };
                }, String(cvc));

                if (heuristic) {
                    console.log(`CVV filled with heuristic input: ${JSON.stringify(heuristic)}`);
                    return { ok: true, mode: 'heuristic' };
                }
            } catch (_) {}
        }

        await new Promise(resolve => setTimeout(resolve, 250));
    }

    return { ok: false, mode: 'not_found' };
}

async function fillCardNumberHeuristic(frame, cardNumber) {
    const target = await frame.evaluateHandle(() => {
        const scoreInput = (el) => {
            if (!el) return -1;
            if (el.disabled || el.readOnly) return -1;
            const style = window.getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none') return -1;

            const attrs = [
                el.getAttribute('autocomplete') || '',
                el.getAttribute('name') || '',
                el.getAttribute('id') || '',
                el.getAttribute('aria-label') || '',
                el.getAttribute('placeholder') || '',
                el.className || ''
            ].join(' ').toLowerCase();

            let score = 0;
            if (attrs.includes('cc-number')) score += 100;
            if (attrs.includes('cardnumber')) score += 90;
            if (attrs.includes('card-number')) score += 90;
            if (attrs.includes('card number')) score += 80;
            if (attrs.includes('credit')) score += 50;
            if (attrs.includes('debit')) score += 50;
            if (attrs.includes('account')) score += 30;
            if (el.tagName.toLowerCase() === 'input') score += 10;
            return score;
        };

        const inputs = [...document.querySelectorAll('input')];
        let best = null;
        let bestScore = -1;
        for (const input of inputs) {
            const score = scoreInput(input);
            if (score > bestScore) {
                best = input;
                bestScore = score;
            }
        }
        return bestScore > 0 ? best : null;
    });

    const element = target.asElement();
    if (!element) return false;
    await element.click({ clickCount: 3 });
    await frame.keyboard.press('Backspace');
    await frame.keyboard.type(cardNumber, { delay: 20 });
    return true;
}

// ✅ DIRECT INPUT FILL - bypasses Puppeteer Locator timeout issues on Amazon forms
async function fillInputDirect(pageOrFrame, selector, value, opts = {}) {
    const { delay = 20, useKeyboard = true } = opts;
    try {
        // Try click + keyboard type first (most reliable for triggering event handlers)
        const el = await pageOrFrame.waitForSelector(selector, { visible: true, timeout: 5000 });
        if (!el) throw new Error('Element not found: ' + selector);
        await el.click({ clickCount: 3 });
        await pageOrFrame.keyboard.press('Backspace');
        if (useKeyboard) {
            await pageOrFrame.keyboard.type(String(value), { delay });
        } else {
            // Fallback: set value via JS + dispatch events
            await pageOrFrame.evaluate((sel, val) => {
                const input = document.querySelector(sel);
                if (!input) return;
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(input, val);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, selector, String(value));
        }
        return true;
    } catch (_) {
        // Last resort: pure JS set value
        try {
            await pageOrFrame.evaluate((sel, val) => {
                const input = document.querySelector(sel);
                if (!input) return;
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(input, val);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, selector, String(value));
            return true;
        } catch (__) {
            return false;
        }
    }
}

async function fillVisibleInputValue(pageOrFrame, selectors, value, label, opts = {}) {
    const expected = String(value);
    const { digitsOnly = false } = opts;
    const result = await pageOrFrame.evaluate((sels, val, onlyDigits) => {
        const isVisible = (el) => {
            if (!el || el.disabled || el.readOnly) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };

        const normalize = (v) => onlyDigits ? String(v || '').replace(/\D/g, '') : String(v || '');
        const setNativeValue = (el, nextValue) => {
            el.focus();
            try { el.click(); } catch (_) {}
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, nextValue);
            else el.value = nextValue;

            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            el.blur();
        };

        for (const selector of sels) {
            const inputs = Array.from(document.querySelectorAll(selector)).filter(isVisible);
            for (const input of inputs) {
                setNativeValue(input, val);
                if (normalize(input.value) === normalize(val)) {
                    return {
                        ok: true,
                        selector,
                        name: input.getAttribute('name') || '',
                        id: input.id || '',
                        length: input.value.length
                    };
                }
            }
        }

        return { ok: false };
    }, selectors, expected, digitsOnly);

    if (!result?.ok) {
        throw new Error(`${label.toUpperCase().replace(/\s+/g, '_')}_VISIBLE_INPUT_NOT_FILLED`);
    }

    console.log(`${label} filled in visible input: ${result.selector}`);
    return result;
}

async function typeVisibleInputValue(pageOrFrame, selectors, value, label, opts = {}) {
    const expected = String(value);
    const { digitsOnly = false } = opts;

    for (const selector of selectors) {
        let handles = [];
        try {
            handles = await pageOrFrame.$$(selector);
        } catch (_) {
            handles = [];
        }

        for (const handle of handles) {
            try {
                const canUse = await handle.evaluate((el) => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                });
                if (!canUse) continue;

                await handle.click({ clickCount: 3 });
                await handle.evaluate((el) => {
                    el.value = '';
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
                await handle.type(expected, { delay: 35 });

                const verified = await handle.evaluate((el, val, onlyDigits) => {
                    const normalize = (v) => onlyDigits ? String(v || '').replace(/\D/g, '') : String(v || '');
                    return normalize(el.value) === normalize(val);
                }, expected, digitsOnly);

                if (verified) {
                    console.log(`${label} typed in visible input: ${selector}`);
                    return { ok: true, selector };
                }
            } catch (_) {}
        }
    }

    throw new Error(`${label.toUpperCase().replace(/\s+/g, '_')}_VISIBLE_INPUT_NOT_TYPED`);
}

async function selectVisibleValue(pageOrFrame, selectors, value, label) {
    const expected = String(value);
    const result = await pageOrFrame.evaluate((sels, val) => {
        const isVisible = (el) => {
            if (!el || el.disabled) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        };

        for (const selector of sels) {
            const selects = Array.from(document.querySelectorAll(selector)).filter(isVisible);
            for (const select of selects) {
                select.value = val;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                if (select.value === val) {
                    return { ok: true, selector, value: select.value };
                }
            }
        }

        return { ok: false };
    }, selectors, expected);

    if (!result?.ok) {
        throw new Error(`${label.toUpperCase().replace(/\s+/g, '_')}_VISIBLE_SELECT_NOT_SET`);
    }

    console.log(`${label} selected in visible popup select: ${result.selector}`);
    return result;
}

async function selectVisibleValueNative(pageOrFrame, selectors, value, label) {
    const expected = String(value);
    for (const selector of selectors) {
        let handles = [];
        try {
            handles = await pageOrFrame.$$(selector);
        } catch (_) {
            handles = [];
        }

        for (const handle of handles) {
            try {
                const canUse = await handle.evaluate((el) => {
                    if (!el || el.disabled) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                });
                if (!canUse) continue;

                await handle.select(expected);
                const verified = await handle.evaluate((el, val) => String(el.value) === String(val), expected);
                if (verified) {
                    console.log(`${label} selected natively: ${selector}`);
                    return { ok: true, selector };
                }
            } catch (_) {}
        }
    }

    throw new Error(`${label.toUpperCase().replace(/\s+/g, '_')}_VISIBLE_SELECT_NOT_NATIVE_SET`);
}

async function clickAddressConfirmationIfPresent(page) {
    const clickInContext = async (ctx) => {
        try {
            return await ctx.evaluate(() => {
                const isVisible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                };

                const candidates = [
                    ...document.querySelectorAll('input[type="submit"], button, a, .a-button-input')
                ];

                for (const el of candidates) {
                    if (!isVisible(el)) continue;
                    const text = `${el.value || ''} ${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
                    if (
                        text.includes('use this address') ||
                        text.includes('use selected address') ||
                        text.includes('ship to this address') ||
                        text.trim() === 'continue'
                    ) {
                        el.click();
                        return text.slice(0, 80);
                    }
                }
                return null;
            });
        } catch (_) {
            return null;
        }
    };

    const topClick = await clickInContext(page);
    if (topClick) return topClick;

    for (const frame of page.frames()) {
        const frameClick = await clickInContext(frame);
        if (frameClick) return frameClick;
    }

    return null;
}

async function inspectCardSubmitState(page, last4) {
    const inspectContext = async (ctx) => {
        try {
            return await ctx.evaluate((cardLast4) => {
                const visibleText = (el) => {
                    if (!el) return '';
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return '';
                    return (el.innerText || el.textContent || '').trim();
                };

                const bodyText = visibleText(document.body);
                const lowerText = bodyText.toLowerCase();
                const errorSelectors = [
                    '.a-alert-error',
                    '.a-form-error',
                    '.pmts-error',
                    '[class*="error"] .a-alert-content',
                    '[data-testid*="error"]'
                ];
                const errorText = errorSelectors
                    .map(sel => Array.from(document.querySelectorAll(sel)).map(visibleText).filter(Boolean).join(' '))
                    .filter(Boolean)
                    .join(' ')
                    .trim();

                const problemText = [
                    'there was a problem',
                    'invalid',
                    'declined',
                    'not accepted',
                    'please enter',
                    'please correct',
                    'expired',
                    'unable to add',
                    'cannot add'
                ].find(token => lowerText.includes(token));

                const formVisible = !!Array.from(document.querySelectorAll(
                    'form.apx-add-card-compact-form, input[name="addCreditCardNumber"], input[name="ppw-accountHolderName"]'
                )).find(el => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                });

                const last4Visible = !!cardLast4 && bodyText.includes(cardLast4);
                const successTextVisible =
                    lowerText.includes('payment method has been added') ||
                    lowerText.includes('card has been added') ||
                    lowerText.includes('successfully added');

                return {
                    errorText: errorText || problemText || '',
                    formVisible,
                    last4Visible,
                    successTextVisible
                };
            }, last4);
        } catch (_) {
            return null;
        }
    };

    const states = [];
    const topState = await inspectContext(page);
    if (topState) states.push(topState);

    for (const frame of page.frames()) {
        const frameState = await inspectContext(frame);
        if (frameState) states.push(frameState);
    }

    return {
        errorText: states.map(s => s.errorText).find(Boolean) || '',
        formVisible: states.some(s => s.formVisible),
        last4Visible: states.some(s => s.last4Visible),
        successTextVisible: states.some(s => s.successTextVisible)
    };
}

async function waitForCardSubmitResult(page, last4, timeoutMs = 18000) {
    const started = Date.now();
    let addressClicked = false;

    while (Date.now() - started < timeoutMs) {
        const clickedAddress = await clickAddressConfirmationIfPresent(page);
        if (clickedAddress && !addressClicked) {
            addressClicked = true;
            console.log(`Address confirmation clicked after card submit: ${clickedAddress}`);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }

        const state = await inspectCardSubmitState(page, last4);
        if (state.errorText) {
            return { success: false, error: state.errorText.slice(0, 180) };
        }
        if (state.last4Visible || state.successTextVisible) {
            return { success: true };
        }

        await new Promise(resolve => setTimeout(resolve, 700));
    }

    const finalState = await inspectCardSubmitState(page, last4);
    if (finalState.formVisible) {
        return { success: false, error: 'CARD_SUBMIT_STILL_ON_FORM' };
    }

    try {
        await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
            waitUntil: 'domcontentloaded',
            timeout: 8000
        });
        await new Promise(resolve => setTimeout(resolve, 2500));
        const walletState = await inspectCardSubmitState(page, last4);
        if (walletState.last4Visible || walletState.successTextVisible) {
            return { success: true };
        }
        if (walletState.errorText) {
            return { success: false, error: walletState.errorText.slice(0, 180) };
        }
    } catch (_) {}

    return { success: false, error: 'CARD_NOT_CONFIRMED_IN_WALLET' };
}

async function clickFilledPaymentFormSubmit(page, cardInfo) {
    const contexts = [page, ...page.frames()];
    for (const ctx of contexts) {
        try {
            const result = await ctx.evaluate((info) => {
                const isVisible = (el) => {
                    if (!el || el.disabled) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                };
                const digits = (v) => String(v || '').replace(/\D/g, '');
                const text = (v) => String(v || '').trim();
                const setNativeValue = (el, nextValue) => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const lastValue = el.value;
                    el.focus();
                    try { el.click(); } catch (_) {}
                    const proto = el instanceof HTMLSelectElement
                        ? HTMLSelectElement.prototype
                        : el instanceof HTMLTextAreaElement
                            ? HTMLTextAreaElement.prototype
                            : HTMLInputElement.prototype;
                    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                    if (setter) setter.call(el, nextValue);
                    else el.value = nextValue;
                    if (el._valueTracker) {
                        try { el._valueTracker.setValue(lastValue); } catch (_) {}
                    }
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                    return true;
                };
                const visible = (selector) => Array.from(document.querySelectorAll(selector)).filter(isVisible);
                const findFirst = (selectors, predicate = () => true) => {
                    for (const selector of selectors) {
                        const match = visible(selector).find(predicate);
                        if (match) return { el: match, selector };
                    }
                    return { el: null, selector: '' };
                };

                const card = findFirst([
                    'input[name="addCreditCardNumber"]',
                    'input[autocomplete="cc-number"]',
                    'input[name*="cardNumber"]',
                    'input[id*="cardNumber"]',
                    'input[aria-label*="card number" i]',
                    'input[placeholder*="card number" i]'
                ], el => digits(el.value).endsWith(digits(info.number).slice(-4)) || !digits(el.value));

                const name = findFirst([
                    'input[name="ppw-accountHolderName"]',
                    'input[autocomplete="cc-name"]',
                    'input[name*="accountHolderName"]',
                    'input[aria-label*="name" i]'
                ]);

                const month = findFirst([
                    'select[name="ppw-expirationDate_month"]',
                    'select[name*="expirationDate_month"]',
                    'select[aria-label*="month" i]'
                ]);

                const year = findFirst([
                    'select[name="ppw-expirationDate_year"]',
                    'select[name*="expirationDate_year"]',
                    'select[aria-label*="year" i]'
                ]);

                const cvv = findFirst([
                    'input[name="addCreditCardVerificationNumber"]',
                    'input[autocomplete="cc-csc"]',
                    'input[name*="Verification"]',
                    'input[name*="verification"]',
                    'input[name*="cvv" i]',
                    'input[name*="cvc" i]',
                    'input[aria-label*="security code" i]',
                    'input[placeholder*="security code" i]'
                ]);

                const state = {
                    card: card.el ? digits(card.el.value).length : 0,
                    name: name.el ? text(name.el.value).length : 0,
                    month: month.el ? text(month.el.value) : '',
                    year: year.el ? text(year.el.value) : '',
                    cvv: cvv.el ? digits(cvv.el.value).length : 0,
                    selectors: {
                        card: card.selector,
                        name: name.selector,
                        month: month.selector,
                        year: year.selector,
                        cvv: cvv.selector
                    }
                };

                if (!state.card || !state.name || !state.month || !state.year || (info.cvc && !state.cvv)) {
                    return { clicked: false, state };
                }

                const anchor = card.el || name.el || cvv.el || month.el || year.el;
                const form = anchor?.closest('form') || document.querySelector('form.apx-add-card-compact-form') || document;
                const ensureHidden = (name, value) => {
                    if (!form || form === document) return;
                    let input = Array.from(form.querySelectorAll(`input[type="hidden"][name="${name}"]`))[0];
                    if (!input) {
                        input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = name;
                        form.appendChild(input);
                    }
                    input.value = value;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                };

                // PaymentsPortal formDefinition uses these unprefixed parameter names.
                ensureHidden('accountHolderName', info.name);
                ensureHidden('expirationDate_month', String(Number(info.month)));
                ensureHidden('expirationDate_year', String(info.year));
                ensureHidden('expirationDate', `${String(Number(info.month)).padStart(2, '0')}/${info.year}`);
                ensureHidden('expirationDate_combinedMonthYear', `${String(Number(info.month)).padStart(2, '0')}/${info.year}`);

                const submitCandidates = Array.from(form.querySelectorAll(
                    'input[name="ppw-widgetEvent:AddCreditCardEvent"], input[type="submit"], button[type="submit"], .a-button-primary input.a-button-input, .a-button-input'
                )).filter(isVisible);

                let submit = submitCandidates.find(el => {
                    const label = `${el.value || ''} ${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
                    return label.includes('add') || label.includes('continue') || label.includes('confirm') || el.name === 'ppw-widgetEvent:AddCreditCardEvent';
                }) || submitCandidates[0];

                if (!submit) return { clicked: false, state };

                const submitSelector = submit.name
                    ? `${submit.tagName.toLowerCase()}[name="${submit.name}"]`
                    : submit.id
                        ? `#${submit.id}`
                        : '';
                return { clicked: true, method: 'button-ready', state, submitSelector };
            }, cardInfo);

            if (result?.clicked) {
                if (!result.submitSelector) {
                    console.log(`Payment form submit found without stable selector: ${JSON.stringify(result.state)}`);
                    return false;
                }
                const submitHandle = await ctx.$(result.submitSelector);
                if (!submitHandle) {
                    console.log(`Payment form submit selector missing after validation: ${result.submitSelector}`);
                    return false;
                }
                await submitHandle.click();
                console.log(`Payment form submit clicked with state: ${JSON.stringify(result.state)}`);
                return true;
            }
        } catch (_) {}
    }

    return false;
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

        // Step 2: Click "Add a credit or debit card" and wait popup iframe to open
        try {
            console.log('💳 Step 2: Selecting Credit/Debit Card...');
            let creditCardClicked = false;
            let attempts = 0;
            const maxAttempts = 4;

            while (!creditCardClicked && attempts < maxAttempts) {
                attempts++;
                console.log(`   Attempt ${attempts}/${maxAttempts}`);

                // Preferred: click exact submit input under Add a credit/debit row.
                try {
                    const exactClicked = await page.evaluate(() => {
                        const rows = Array.from(document.querySelectorAll('div[data-pmts-component-id]'));
                        for (const row of rows) {
                            const text = (row.textContent || '').toLowerCase();
                            if (!text.includes('add a credit or debit card')) continue;
                            const input = row.querySelector('input.a-button-input[type="submit"][aria-labelledby*="-88-announce"]')
                                || row.querySelector('input.a-button-input[type="submit"]');
                            if (input) {
                                input.click();
                                return true;
                            }
                        }
                        const byTestId = document.querySelector('#apx-add-credit-card-action-test-id input.a-button-input[type="submit"]');
                        if (byTestId) {
                            byTestId.click();
                            return true;
                        }
                        return false;
                    });
                    if (exactClicked) {
                        creditCardClicked = true;
                        console.log('   ✅ Clicked exact Add credit card submit input');
                    }
                } catch (_) {}

                if (!creditCardClicked) {
                    try {
                        await puppeteer.Locator.race([
                            page.locator('#apx-add-credit-card-action-test-id input.a-button-input'),
                            page.locator('::-p-aria(Add a credit or debit card)'),
                            page.locator('button:has-text("Add a credit or debit card")')
                        ]).setTimeout(3000).click();
                        creditCardClicked = true;
                        console.log('   ✅ Fallback locator clicked');
                    } catch (_) {}
                }

                if (!creditCardClicked) {
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }

            if (!creditCardClicked) {
                throw new Error('FAILED_CLICK_ADD_CREDIT_CARD_BUTTON');
            }

            // Must wait popup/secure iframe before entering card data.
            try {
                await page.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component, iframe[name*="ApxSecureIframe"], iframe[src*="payments"]', { timeout: 8000 });
            } catch (_) {}
            // Wait for iframe content to fully render before trying to fill fields.
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('✅ Step 2 completed - Credit/Debit Card selected');
            
        } catch (error) {
            console.log(`❌ Step 2 failed: ${error.message}`);
            return { success: false, error: error.message, step: 'add_credit_card', shouldRetry: retryCount < maxRetries - 1 };
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Step 3-8: Support both popup form and iframe form
        let usePopupForm = false;

        // Step 3-8: All iframe operations with improved error handling
        // Step 3: Enter card number
        try {
            const targetPage = page;
            targetPage.setDefaultTimeout(timeout);

            try {
                // ✅ EXPANDED POPUP FORM DETECTION - covers more Amazon variations
                const popupSelectors = [
                    'form.apx-add-card-compact-form input[name="addCreditCardNumber"]',
                    '#a-popover-content-1 input[name="addCreditCardNumber"]',
                    '#a-popover-content-2 input[name="addCreditCardNumber"]',
                    '#a-popover-content-3 input[name="addCreditCardNumber"]',
                    '.a-popover-content input[name="addCreditCardNumber"]',
                    'input[name="addCreditCardNumber"]'
                ];
                let popupCardNumber = null;
                for (const sel of popupSelectors) {
                    try {
                        popupCardNumber = await targetPage.$(sel);
                        if (popupCardNumber) {
                            const isVisiblePopupInput = await targetPage.evaluate((el) => {
                                const style = window.getComputedStyle(el);
                                const rect = el.getBoundingClientRect();
                                return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                            }, popupCardNumber);
                            if (isVisiblePopupInput) break;
                            popupCardNumber = null;
                        }
                    } catch (_) {}
                }

                if (popupCardNumber) {
                    usePopupForm = true;
                    await typeVisibleInputValue(targetPage, popupSelectors, cardInfo.number, 'Card number', { digitsOnly: true });
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                if (!usePopupForm) {
                const numberSelectors = [
                    // Standard Amazon selectors
                    'input[autocomplete="cc-number"]',
                    'input[name="addCreditCardNumber"]',
                    'input[name="ppw-accountHolderNumber"]',
                    'input[name*="cardNumber"]',
                    'input[id*="cardNumber"]',
                    '.a-input-text.a-form-normal.pmts-account-number',
                    '.a-input-text.a-form-normal.pmts-account-Number',
                    // ✅ NEWER AMAZON SELECTORS
                    'input[data-testid*="card-number"]',
                    'input[data-testid*="cardNumber"]',
                    'input[placeholder*="card number" i]',
                    'input[placeholder*="Card Number" i]',
                    'input[aria-label*="card number" i]',
                    'input[aria-label*="Card Number" i]',
                    'input[type="tel"][maxlength="19"]',
                    'input[type="tel"][maxlength="16"]',
                    'input[type="text"][maxlength="19"]',
                    'input[type="text"][maxlength="16"]',
                    'input[id*="credit-card"]',
                    'input[class*="card-number"]',
                    'input[class*="cardNumber"]',
                    'input[class*="account-number"]'
                ];

                const frameMatch = await findFrameWithSelector(targetPage, numberSelectors, 6000);
                if (frameMatch) {
                    console.log(`   🔍 Card number field found in frame (selector: ${frameMatch.selector})`);
                } else {
                    // Debug: log available frames and their URLs
                    try {
                        const frameUrls = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
                        console.log(`   ⚠️ Card number field not found after 6s. Available frames: ${frameUrls.length}`);
                        frameUrls.forEach((u, i) => console.log(`      Frame ${i}: ${u.substring(0, 100)}`));
                    } catch (_) {}
                }
                const quickFill = await fillCardNumberAcrossFrames(
                    targetPage,
                    cardInfo.number,
                    numberSelectors,
                    frameMatch ? 8000 : 10000
                );

                if (!quickFill.ok) {
                    try {
                        const diagnostics = await getCardFieldDiagnostics(targetPage, numberSelectors);
                        console.log(`Card number field diagnostics: ${JSON.stringify(diagnostics).slice(0, 1200)}`);
                    } catch (_) {}
                    throw new Error('CARD_NUMBER_FIELD_NOT_FOUND');
                }
                console.log(`✅ Card number filled with ${quickFill.mode}`);
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
                if (usePopupForm) {
                    await typeVisibleInputValue(
                        targetPage,
                        [
                            'form.apx-add-card-compact-form input[name="ppw-accountHolderName"]',
                            '.a-popover-content input[name="ppw-accountHolderName"]',
                            'input[name="ppw-accountHolderName"]'
                        ],
                        cardInfo.name,
                        'Cardholder name'
                    );
                    await new Promise(resolve => setTimeout(resolve, 300));
                } else {
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
                    
                    await typeVisibleInputValue(
                        iframe,
                        [
                            'input[name="ppw-accountHolderName"]',
                            '.a-input-text.a-form-normal.apx-add-credit-card-account-holder-name-input.mcx-input-fields',
                            'input[aria-label*="name" i]'
                        ],
                        cardInfo.name,
                        'Cardholder name'
                    );
                }
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
                if (usePopupForm) {
                    const monthValue = String(Number(cardInfo.month));
                    await selectVisibleValueNative(
                        targetPage,
                        [
                            'form.apx-add-card-compact-form select[name="ppw-expirationDate_month"]',
                            '.a-popover-content select[name="ppw-expirationDate_month"]',
                            'select[name="ppw-expirationDate_month"]'
                        ],
                        monthValue,
                        'Expiration month'
                    );
                    await new Promise(resolve => setTimeout(resolve, 300));
                } else {
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
                    
                    const monthIndex = Number(cardInfo.month);
                    console.log(`Selecting month: ${monthIndex}`);

                    await selectVisibleValueNative(
                        iframe,
                        [
                            'select[name="ppw-expirationDate_month"]',
                            'select[name*="expirationDate_month"]',
                            'select[aria-label*="month" i]'
                        ],
                        String(monthIndex),
                        'Expiration month'
                    );
                }
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
                if (usePopupForm) {
                    await selectVisibleValueNative(
                        targetPage,
                        [
                            'form.apx-add-card-compact-form select[name="ppw-expirationDate_year"]',
                            '.a-popover-content select[name="ppw-expirationDate_year"]',
                            'select[name="ppw-expirationDate_year"]'
                        ],
                        String(cardInfo.year),
                        'Expiration year'
                    );
                    await new Promise(resolve => setTimeout(resolve, 300));

                    // Fill CVV on popup flow if present.
                    if (cardInfo.cvc) {
                        const cvvFill = await fillCvvAcrossFrames(targetPage, cardInfo.cvc, 8000);
                        if (!cvvFill.ok) {
                            throw new Error('CVV_FIELD_NOT_FILLED');
                        }
                        console.log(`CVV filled before submit with ${cvvFill.mode}`);
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                } else {
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
                    
                    const currentYear = new Date().getFullYear();
                    const targetYear = Number(cardInfo.year);
                    const yearDifference = targetYear - currentYear;
                    
                    let yearSelected = false;

                    try {
                        await selectVisibleValueNative(
                            iframe,
                            [
                                'select[name="ppw-expirationDate_year"]',
                                'select[name*="expirationDate_year"]',
                                'select[aria-label*="year" i]'
                            ],
                            String(cardInfo.year),
                            'Expiration year'
                        );
                        yearSelected = true;
                    } catch (_) {}

                    if (!yearSelected) {
                        await iframe.locator('.a-button.a-button-dropdown.pmts-expiry-year.pmts-portal-component .a-button-text.a-declarative').click();
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    // ✅ STRATEGY 1: Find all year options dynamically (NO DEBUG LOGS)
                    if (!yearSelected) try {
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

                    if (cardInfo.cvc) {
                        const cvvFill = await fillCvvAcrossFrames(targetPage, cardInfo.cvc, 8000);
                        if (!cvvFill.ok) {
                            throw new Error('CVV_FIELD_NOT_FILLED');
                        }
                        console.log(`CVV filled before submit with ${cvvFill.mode}`);
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
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
                const clickedFilledForm = await clickFilledPaymentFormSubmit(targetPage, cardInfo);
                if (clickedFilledForm) {
                    console.log('Payment form submitted from filled form context');
                } else if (usePopupForm) {
                    // ✅ Use JS click - avoids waitForSelector timeout when DOM changes after fill
                    const submitClicked = await targetPage.evaluate(() => {
                        const isVisible = (el) => {
                            if (!el || el.disabled) return false;
                            const style = window.getComputedStyle(el);
                            const rect = el.getBoundingClientRect();
                            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
                        };
                        const selectors = [
                            'input[name="ppw-widgetEvent:AddCreditCardEvent"]',
                            'form.apx-add-card-compact-form input[type="submit"]',
                            '.a-button-primary.pmts-button-input input.a-button-input',
                            '#a-popover-content-1 input[type="submit"]',
                            '#a-popover-content-2 input[type="submit"]',
                            '#a-popover-content-3 input[type="submit"]',
                            '.a-popover-content input[type="submit"]',
                            'input.a-button-input[type="submit"]'
                        ];
                        for (const sel of selectors) {
                            const el = Array.from(document.querySelectorAll(sel)).find(isVisible);
                            if (el) { el.click(); return sel; }
                        }
                        return null;
                    });
                    if (submitClicked) {
                        console.log(`✅ Popup form submitted via JS click: ${submitClicked}`);
                    } else {
                        throw new Error('POPUP_SUBMIT_BUTTON_NOT_FOUND');
                    }
                } else {
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
                if (usePopupForm) {
                    const submitResult = await waitForCardSubmitResult(targetPage, cardInfo.number.slice(-4), 18000);
                    if (!submitResult.success) {
                        return {
                            success: false,
                            error: submitResult.error,
                            step: 'verify_popup_card_submit',
                            shouldRetry: retryCount < maxRetries - 1
                        };
                    }
                    return { success: true };
                }
                if (!(await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component'))) {
                    throw new Error('IFRAME_NOT_AVAILABLE_FOR_ADDRESS_CONFIRM');
                }
                
                await targetPage.waitForSelector('iframe.apx-secure-iframe.pmts-portal-component', { timeout: 6000 });

                const elementHandle = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
                if (!elementHandle) {
                    throw new Error('IFRAME_NOT_AVAILABLE_FOR_ADDRESS_CONFIRM');
                } else {
                    const iframe = await elementHandle.contentFrame();
                    if (!iframe) {
                        throw new Error('IFRAME_NOT_AVAILABLE_FOR_ADDRESS_CONFIRM');
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
                    console.log('Frame changed during address confirmation, verifying card result...');
                }
            }
        } catch (error) {
            console.error('Error confirming address:', error);
        }

        const submitResult = await waitForCardSubmitResult(page, cardInfo.number.slice(-4), 18000);
        if (!submitResult.success) {
            return {
                success: false,
                error: submitResult.error,
                step: 'verify_card_submit',
                shouldRetry: retryCount < maxRetries - 1
            };
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
