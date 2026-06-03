const puppeteer = require('puppeteer');

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

async function safePageReload(page, timeout = 10000) {
    try {
        if (page.isClosed()) throw new Error('PAGE_CLOSED');
        await page.reload({ waitUntil: ['domcontentloaded'], timeout });
        return true;
    } catch (err) {
        if (
            err.message.includes('detached Frame') ||
            err.message.includes('Session closed') ||
            err.message.includes('Page has been closed')
        ) throw new Error('FRAME_DETACHED');
        throw err;
    }
}

async function isIframeValid(page, iframeSelector) {
    try {
        const el = await page.$(iframeSelector);
        if (!el) return false;
        const iframe = await el.contentFrame();
        if (!iframe) return false;
        await iframe.evaluate(() => document.readyState);
        return true;
    } catch {
        return false;
    }
}

async function findFrameWithSelector(page, selectors, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        for (const frame of page.frames()) {
            for (const selector of selectors) {
                try {
                    const handle = await frame.$(selector);
                    if (handle) return { frame, selector };
                } catch { /* frame may detach */ }
            }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return null;
}

// ─────────────────────────────────────────────
// ✅ FIX 1: React-aware input setter
// Sets value AND triggers all React synthetic events
// ─────────────────────────────────────────────
async function setReactInputValue(frameOrPage, selector, value) {
    return frameOrPage.evaluate((sel, val) => {
        const input = document.querySelector(sel);
        if (!input) return false;

        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        )?.set;

        // Clear first so React sees a "change"
        if (nativeSetter) nativeSetter.call(input, '');
        else input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));

        // Set new value
        if (nativeSetter) nativeSetter.call(input, val);
        else input.value = val;

        // Trigger full React event chain
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: val.slice(-1) }));
        input.dispatchEvent(new KeyboardEvent('keypress',{ bubbles: true, key: val.slice(-1) }));
        input.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: val.slice(-1) }));
        input.dispatchEvent(new FocusEvent('blur',  { bubbles: true }));

        return input.value === val || input.value.replace(/\D/g,'') === val.replace(/\D/g,'');
    }, selector, value);
}

async function setReactSelectValue(frameOrPage, selector, value) {
    return frameOrPage.evaluate((sel, val) => {
        const select = document.querySelector(sel);
        if (!select) return false;

        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLSelectElement.prototype, 'value'
        )?.set;

        if (nativeSetter) nativeSetter.call(select, val);
        else select.value = val;

        select.dispatchEvent(new Event('input',  { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value === val;
    }, selector, value);
}

async function typeLikeUser(page, frameOrPage, selectors, value, label, opts = {}) {
    const expected = String(value);
    const { digitsOnly = false } = opts;
    const normalize = v => digitsOnly ? String(v || '').replace(/\D/g, '') : String(v || '');

    for (const selector of selectors) {
        let handles = [];
        try {
            handles = await frameOrPage.$$(selector);
        } catch {
            handles = [];
        }

        for (const handle of handles) {
            try {
                const visible = await handle.evaluate(el => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
                });
                if (!visible) continue;

                await handle.click({ clickCount: 3 });
                await page.keyboard.down('Control');
                await page.keyboard.press('A');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await page.keyboard.type(expected, { delay: 45 });

                const verified = await handle.evaluate((el, val, onlyDigits) => {
                    const normalizeValue = v => onlyDigits ? String(v || '').replace(/\D/g, '') : String(v || '');
                    const ok = normalizeValue(el.value) === normalizeValue(val);
                    if (ok) {
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        el.blur();
                    }
                    return ok;
                }, expected, digitsOnly);

                if (verified) {
                    console.log(`${label} typed like user: ${selector}`);
                    return { ok: true, selector };
                }
            } catch {
                try { await page.keyboard.up('Control'); } catch {}
            }
        }
    }

    throw new Error(`${label.toUpperCase().replace(/\s+/g, '_')}_NOT_TYPED`);
}

async function selectLikeUser(frameOrPage, selectors, value, label) {
    const expected = String(value);
    for (const selector of selectors) {
        let handles = [];
        try {
            handles = await frameOrPage.$$(selector);
        } catch {
            handles = [];
        }

        for (const handle of handles) {
            try {
                const visible = await handle.evaluate(el => {
                    if (!el || el.disabled) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
                });
                if (!visible) continue;

                await handle.select(expected);
                const verified = await handle.evaluate((el, val) => {
                    const ok = String(el.value) === String(val);
                    if (ok) {
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.blur();
                    }
                    return ok;
                }, expected);

                if (verified) {
                    console.log(`${label} selected like user: ${selector}`);
                    return { ok: true, selector };
                }
            } catch { /* try next */ }
        }
    }

    throw new Error(`${label.toUpperCase().replace(/\s+/g, '_')}_NOT_SELECTED`);
}

// ─────────────────────────────────────────────
// FILL HELPERS (cross-frame aware)
// ─────────────────────────────────────────────

async function fillCardNumberAcrossFrames(page, cardNumber, selectors, timeoutMs = 9000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        for (const frame of page.frames()) {
            for (const selector of selectors) {
                try {
                    await typeLikeUser(page, frame, [selector], cardNumber, 'Card number', { digitsOnly: true });
                    return { ok: true, mode: `type-user-frame:${selector}` };
                } catch { /* continue */ }

                try {
                    // Try React-aware setter first
                    const ok = await frame.evaluate((sel, val) => {
                        const input = document.querySelector(sel);
                        if (!input) return false;
                        const style = window.getComputedStyle(input);
                        const rect  = input.getBoundingClientRect();
                        if (style.display === 'none' || style.visibility === 'hidden' || !rect.width) return false;

                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (nativeSetter) nativeSetter.call(input, '');
                        else input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));

                        if (nativeSetter) nativeSetter.call(input, val);
                        else input.value = val;
                        input.dispatchEvent(new Event('input',  { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

                        return input.value.replace(/\D/g,'') === val.replace(/\D/g,'');
                    }, selector, cardNumber);

                    if (ok) return { ok: true, mode: `react-frame:${selector}` };
                } catch { /* continue */ }

                try {
                    // Fallback: type character by character
                    const handle = await frame.$(selector);
                    if (!handle) continue;
                    const visible = await handle.evaluate(el => {
                        const s = window.getComputedStyle(el);
                        const r = el.getBoundingClientRect();
                        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0;
                    });
                    if (!visible) continue;

                    await handle.click({ clickCount: 3 });
                    await page.keyboard.press('Backspace');
                    await page.keyboard.type(cardNumber, { delay: 30 });

                    const verified = await frame.evaluate((sel, val) => {
                        const el = document.querySelector(sel);
                        return el?.value?.replace(/\D/g,'') === val.replace(/\D/g,'');
                    }, selector, cardNumber);

                    if (verified) return { ok: true, mode: `type-frame:${selector}` };
                } catch { /* continue */ }
            }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return { ok: false, mode: 'not_found' };
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
        'input[aria-label*="security code" i]',
        'input[placeholder*="security code" i]',
    ];

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        for (const frame of page.frames()) {
            for (const selector of cvvSelectors) {
                try {
                    await typeLikeUser(page, frame, [selector], String(cvc), 'CVV', { digitsOnly: true });
                    return { ok: true, mode: `type-user:${selector}` };
                } catch { /* continue */ }

                try {
                    const ok = await frame.evaluate((sel, val) => {
                        const input = document.querySelector(sel);
                        if (!input) return false;
                        const style = window.getComputedStyle(input);
                        const rect  = input.getBoundingClientRect();
                        if (style.display === 'none' || style.visibility === 'hidden' || !rect.width) return false;

                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (nativeSetter) nativeSetter.call(input, '');
                        else input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));

                        if (nativeSetter) nativeSetter.call(input, val);
                        else input.value = val;
                        input.dispatchEvent(new Event('input',  { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

                        return input.value.replace(/\D/g,'') === val.replace(/\D/g,'');
                    }, selector, String(cvc));

                    if (ok) return { ok: true, mode: `react:${selector}` };
                } catch { /* continue */ }
            }

            // Heuristic fallback
            try {
                const result = await frame.evaluate((val) => {
                    const isVisible = el => {
                        if (!el || el.disabled || el.readOnly) return false;
                        const s = window.getComputedStyle(el);
                        const r = el.getBoundingClientRect();
                        return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0;
                    };
                    const score = el => {
                        if (!isVisible(el)) return -1;
                        const attrs = [el.autocomplete, el.name, el.id, el.getAttribute('aria-label'), el.placeholder, el.className]
                            .join(' ').toLowerCase();
                        let s = 0;
                        if (attrs.includes('cc-csc'))        s += 120;
                        if (attrs.includes('security code')) s += 110;
                        if (attrs.includes('verification'))  s += 100;
                        if (attrs.includes('cvv'))           s += 100;
                        if (attrs.includes('cvc'))           s += 100;
                        const ml = Number(el.getAttribute('maxlength') || 0);
                        if (ml === 3 || ml === 4) s += 30;
                        return s;
                    };
                    const best = [...document.querySelectorAll('input')]
                        .map(el => ({ el, s: score(el) }))
                        .sort((a, b) => b.s - a.s)[0];
                    if (!best || best.s < 30) return null;

                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                    if (nativeSetter) nativeSetter.call(best.el, val);
                    else best.el.value = val;
                    best.el.dispatchEvent(new Event('input',  { bubbles: true }));
                    best.el.dispatchEvent(new Event('change', { bubbles: true }));
                    best.el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                    return best.el.value.replace(/\D/g,'') === val.replace(/\D/g,'') ? { name: best.el.name, score: best.s } : null;
                }, String(cvc));
                if (result) return { ok: true, mode: 'heuristic' };
            } catch { /* continue */ }
        }
        await new Promise(r => setTimeout(r, 250));
    }
    return { ok: false, mode: 'not_found' };
}

// ─────────────────────────────────────────────
// ✅ FIX 2: Pre-submit field verification
// ─────────────────────────────────────────────
async function verifyFieldsBeforeSubmit(page) {
    const contexts = [page, ...page.frames()];
    for (const ctx of contexts) {
        try {
            const state = await ctx.evaluate(() => {
                const q = sel => document.querySelector(sel);
                const isVisible = (el) => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
                };
                const card  = q('input[name="addCreditCardNumber"]');
                const name  = q('input[name="ppw-accountHolderName"]');
                const month = q('select[name="ppw-expirationDate_month"]');
                const year  = q('select[name="ppw-expirationDate_year"]');
                const cvvCandidates = [
                    q('input[name="addCreditCardVerificationNumber"]'),
                    q('input[autocomplete="cc-csc"]'),
                    q('input[name*="cvv" i]'),
                    q('input[name*="cvc" i]'),
                    q('input[name*="verification" i]')
                ].filter(Boolean);
                const cvv = cvvCandidates.find(isVisible) || null;

                return {
                    card:  (card?.value  || '').replace(/\D/g,'').length,
                    name:  (name?.value  || '').trim().length,
                    month: (month?.value || ''),
                    year:  (year?.value  || ''),
                    cvv:   (cvv?.value   || '').replace(/\D/g,'').length,
                    cvvPresent: !!cvv,
                };
            });
            if (state.card > 10) return state; // found the right frame
        } catch { /* try next frame */ }
    }
    return { card: 0, name: 0, month: '', year: '', cvv: 0, cvvPresent: false };
}

async function hasVisibleCvvField(page) {
    const selectors = [
        'input[autocomplete="cc-csc"]',
        'input[name="addCreditCardVerificationNumber"]',
        'input[name*="Verification"]',
        'input[name*="verification"]',
        'input[name*="cvv" i]',
        'input[name*="cvc" i]',
        'input[name*="csc" i]',
        'input[id*="verification" i]',
        'input[id*="cvv" i]',
        'input[aria-label*="security code" i]',
        'input[placeholder*="security code" i]',
    ];

    for (const frame of page.frames()) {
        try {
            const found = await frame.evaluate((sels) => {
                const isVisible = (el) => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
                };
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (isVisible(el)) return true;
                }
                return false;
            }, selectors);
            if (found) return true;
        } catch { /* ignore */ }
    }
    return false;
}

// ─────────────────────────────────────────────
// SUBMIT HELPERS
// ─────────────────────────────────────────────

async function clickAddressConfirmationIfPresent(page) {
    const tryCtx = async ctx => {
        try {
            return await ctx.evaluate(() => {
                const isVisible = el => {
                    if (!el) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0;
                };
                for (const el of document.querySelectorAll('input[type="submit"], button, a, .a-button-input')) {
                    if (!isVisible(el)) continue;
                    const meta = [
                        el.value || '',
                        el.textContent || '',
                        el.getAttribute('aria-label') || '',
                        el.name || '',
                        el.id || '',
                        el.className || '',
                        el.closest('[class]')?.className || ''
                    ].join(' ').toLowerCase();
                    const isAddressAction =
                        meta.includes('use this address') ||
                        meta.includes('ship to this address') ||
                        meta.includes('selected-address') ||
                        meta.includes('use-selected-address') ||
                        meta.includes('pmts-use-selected-address');
                    if (isAddressAction) {
                        el.click();
                        return meta.slice(0, 80);
                    }
                }
                return null;
            });
        } catch { return null; }
    };
    const top = await tryCtx(page);
    if (top) return top;
    for (const frame of page.frames()) {
        const r = await tryCtx(frame);
        if (r) return r;
    }
    return null;
}

async function inspectCardSubmitState(page, last4) {
    const tryCtx = async ctx => {
        try {
            return await ctx.evaluate(cardLast4 => {
                const vis = el => {
                    if (!el) return '';
                    const s = window.getComputedStyle(el);
                    return s.visibility === 'hidden' || s.display === 'none' ? '' : (el.innerText || el.textContent || '').trim();
                };
                const body = vis(document.body).toLowerCase();
                const errorText = [
                    '.a-alert-error', '.a-form-error', '.pmts-error',
                    '[class*="error"] .a-alert-content', '[data-testid*="error"]'
                ].map(sel => [...document.querySelectorAll(sel)].map(vis).filter(Boolean).join(' '))
                 .filter(Boolean).join(' ').trim();

                const problemToken = ['there was a problem','invalid','declined','not accepted',
                    'please enter','please correct','expired','unable to add','cannot add']
                    .find(t => body.includes(t));

                const formVisible = !![
                    'form.apx-add-card-compact-form',
                    'input[name="addCreditCardNumber"]',
                    'input[name="ppw-accountHolderName"]'
                ].flatMap(sel => [...document.querySelectorAll(sel)]).find(el => {
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0;
                });

                return {
                    errorText: errorText || problemToken || '',
                    formVisible,
                    last4Visible: !!cardLast4 && (document.body.textContent || '').includes(cardLast4),
                    successTextVisible: body.includes('payment method has been added') ||
                                        body.includes('card has been added') ||
                                        body.includes('successfully added'),
                };
            }, last4);
        } catch { return null; }
    };

    const states = (await Promise.all([page, ...page.frames()].map(tryCtx))).filter(Boolean);
    return {
        errorText:          states.map(s => s.errorText).find(Boolean) || '',
        formVisible:        states.some(s => s.formVisible),
        last4Visible:       states.some(s => s.last4Visible),
        successTextVisible: states.some(s => s.successTextVisible),
    };
}

async function waitForCardSubmitResult(page, last4, timeoutMs = 18000) {
    const started = Date.now();
    let addressClicked = false;

    while (Date.now() - started < timeoutMs) {
        // ✅ FIX: Detect wallet URL redirect = card added successfully
        const currentUrl = page.url();
        if (
            currentUrl.includes('/cpe/yourpayments/wallet') ||
            currentUrl.includes('/cpe/managePayment')
        ) {
            // Wait a moment for page content to settle
            await new Promise(r => setTimeout(r, 1500));
            const walletState = await inspectCardSubmitState(page, last4);
            if (walletState.last4Visible || walletState.successTextVisible) {
                console.log(`✅ Card ***${last4} added successfully (wallet redirect)`);
                return { success: true };
            }
            // On wallet page but card not visible → may have been rejected silently
            if (walletState.errorText) {
                console.log(`❌ Card ***${last4} rejected: ${walletState.errorText}`);
                return { success: false, error: walletState.errorText };
            }
            // Still on wallet, no error, no last4 → wait more
        }

        const clicked = await clickAddressConfirmationIfPresent(page);
        if (clicked && !addressClicked) {
            addressClicked = true;
            console.log(`   Address confirmation clicked: ${clicked}`);
            await new Promise(r => setTimeout(r, 1500));
        }

        const state = await inspectCardSubmitState(page, last4);
        if (state.errorText) {
            console.log(`❌ Card ***${last4} error: ${state.errorText.slice(0, 100)}`);
            return { success: false, error: state.errorText.slice(0, 180) };
        }
        if (state.last4Visible || state.successTextVisible) {
            console.log(`✅ Card ***${last4} added successfully`);
            return { success: true };
        }

        await new Promise(r => setTimeout(r, 700));
    }

    // Timeout — do one final wallet check
    console.log(`⏱️ Timeout waiting for card ***${last4} — checking wallet...`);
    try {
        await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
            waitUntil: 'domcontentloaded', timeout: 8000
        });
        await new Promise(r => setTimeout(r, 2500));
        const walletState = await inspectCardSubmitState(page, last4);
        if (walletState.last4Visible || walletState.successTextVisible) {
            console.log(`✅ Card ***${last4} confirmed in wallet`);
            return { success: true };
        }
        if (walletState.errorText) return { success: false, error: walletState.errorText.slice(0, 180) };
    } catch { /* ignore */ }

    console.log(`❌ Card ***${last4} not confirmed after timeout`);
    return { success: false, error: 'CARD_NOT_CONFIRMED_IN_WALLET' };
}

// ─────────────────────────────────────────────
// CLICK SUBMIT — with pre-submit field verification
// ─────────────────────────────────────────────
async function clickFilledPaymentFormSubmit(page, cardInfo) {
    // ✅ FIX 2: Verify fields are actually filled before clicking submit
    const preCheck = await verifyFieldsBeforeSubmit(page);
    console.log(`Pre-submit field check: ${JSON.stringify(preCheck)}`);

    const missing = [];
    if (preCheck.card < 13)  missing.push('card');
    if (preCheck.name < 2)   missing.push('name');
    if (!preCheck.month)     missing.push('month');
    if (!preCheck.year)      missing.push('year');
    if (cardInfo.cvc && preCheck.cvvPresent && preCheck.cvv < 3) missing.push('cvv');

    if (missing.length > 0) {
        console.log(`⚠️ Fields empty before submit: ${missing.join(', ')} — aborting submit`);
        return false;
    }

    const contexts = [page, ...page.frames()];
    for (const ctx of contexts) {
        try {
            const result = await ctx.evaluate(info => {
                const isVisible = el => {
                    if (!el || el.disabled) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0;
                };

                const anchor = document.querySelector('input[name="addCreditCardNumber"]') ||
                               document.querySelector('input[name="ppw-accountHolderName"]');
                const form   = anchor?.closest('form') ||
                               document.querySelector('form.apx-add-card-compact-form') ||
                               document;

                const candidates = [...form.querySelectorAll(
                    'input[name="ppw-widgetEvent:AddCreditCardEvent"], input[type="submit"], ' +
                    'button[type="submit"], .a-button-primary input.a-button-input, .a-button-input'
                )].filter(isVisible);

                const submit = candidates.find(el => {
                    const label = `${el.value||''} ${el.textContent||''} ${el.getAttribute('aria-label')||''}`.toLowerCase();
                    return label.includes('add') || label.includes('continue') || label.includes('confirm') ||
                           el.name === 'ppw-widgetEvent:AddCreditCardEvent';
                }) || candidates[0];

                if (!submit) return { clicked: false };

                const submitSelector = submit.name ? `${submit.tagName.toLowerCase()}[name="${submit.name}"]`
                                     : submit.id   ? `#${submit.id}` : '';
                return { clicked: true, submitSelector };
            }, cardInfo);

            if (result?.clicked && result.submitSelector) {
                const handle = await ctx.$(result.submitSelector);
                if (handle) {
                    await handle.click();
                    console.log(`Payment form submit clicked — fields OK: ${JSON.stringify(preCheck)}`);
                    return true;
                }
            }
        } catch { /* try next context */ }
    }
    return false;
}

// ─────────────────────────────────────────────
// MAIN: addCard
// ─────────────────────────────────────────────
async function addCard(page, cardInfo, retryCount = 0) {
    const MAX_RETRIES = 3;
    if (retryCount >= MAX_RETRIES) {
        console.log(`❌ Max retries (${MAX_RETRIES}) reached`);
        return { success: false, error: 'MAX_RETRIES_EXCEEDED' };
    }

    try {
        const timeout = 15000;
        page.setDefaultTimeout(timeout);

        if (page.isClosed()) return { success: false, error: 'PAGE_CLOSED', shouldRetry: true };

        // ── Navigate to wallet ──────────────────────────────────────────
        try {
            console.log('🔄 Ensuring we are on payment page...');
            const url = page.url();
            if (!url.includes('yourpayments') || !url.includes('wallet')) {
                await page.goto('https://www.amazon.com/cpe/yourpayments/wallet', {
                    waitUntil: 'domcontentloaded', timeout: 30000
                });
                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (err) {
            console.log(`❌ Navigation error: ${err.message}`);
            return { success: false, error: 'NAVIGATION_ERROR', shouldRetry: true };
        }

        // ── Step 1: Click "Add a payment method" ───────────────────────
        try {
            console.log('📋 Step 1: Clicking Add Payment Method...');
            let clicked = false;

            for (let attempt = 1; attempt <= 5 && !clicked; attempt++) {
                console.log(`   Attempt ${attempt}/5`);

                try {
                    await puppeteer.Locator.race([
                        page.locator('::-p-aria(Add a payment method[role="link"])'),
                        page.locator('#pp-paEOaP-10'),
                    ]).setTimeout(8000).click();
                    clicked = true;
                    console.log('   ✅ Race locator worked');
                } catch { /* try next */ }

                if (!clicked) {
                    try {
                        const btn = await page.waitForSelector(
                            'a[href*="payment"], #pp-paEOaP-10, [data-testid*="add-payment"]',
                            { timeout: 5000 }
                        );
                        if (btn) { await btn.click(); clicked = true; }
                    } catch { /* try next */ }
                }

                if (!clicked) {
                    clicked = await page.evaluate(() => {
                        for (const el of [...document.querySelectorAll('a, button')]) {
                            const t = el.textContent.toLowerCase();
                            if (t.includes('add') && t.includes('payment')) { el.click(); return true; }
                        }
                        return false;
                    });
                }

                if (!clicked) {
                    await new Promise(r => setTimeout(r, 2000));
                    if (attempt === 3) {
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }
            }

            if (!clicked) throw new Error('ADD_PAYMENT_METHOD_NOT_CLICKED');
            console.log('✅ Step 1 completed');
        } catch (err) {
            return { success: false, error: err.message, step: 'add_payment_method', shouldRetry: true };
        }

        await new Promise(r => setTimeout(r, 2000));

        // ── Step 2: Select "Add a credit or debit card" ────────────────
        try {
            console.log('💳 Step 2: Selecting Credit/Debit Card...');
            let clicked = false;

            for (let attempt = 1; attempt <= 4 && !clicked; attempt++) {
                console.log(`   Attempt ${attempt}/4`);

                clicked = await page.evaluate(() => {
                    const byTestId = document.querySelector('#apx-add-credit-card-action-test-id input.a-button-input[type="submit"]');
                    if (byTestId) { byTestId.click(); return true; }
                    for (const row of document.querySelectorAll('div[data-pmts-component-id]')) {
                        if (!(row.textContent || '').toLowerCase().includes('add a credit or debit card')) continue;
                        const inp = row.querySelector('input.a-button-input[type="submit"]');
                        if (inp) { inp.click(); return true; }
                    }
                    return false;
                });
                console.log(clicked ? '   ✅ Clicked add credit card button' : '   ❌ Not found, retrying...');

                if (!clicked) await new Promise(r => setTimeout(r, 800));
            }

            if (!clicked) throw new Error('FAILED_CLICK_ADD_CREDIT_CARD_BUTTON');

            // ✅ FIX: Wait for iframe to fully load before proceeding
            try {
                await page.waitForSelector(
                    'iframe.apx-secure-iframe.pmts-portal-component, iframe[src*="payments"]',
                    { timeout: 10000 }
                );
                console.log('   ✅ Secure iframe detected');
            } catch { /* iframe may not appear on popup flow */ }

            // Extra wait for iframe content to render
            await new Promise(r => setTimeout(r, 3000));
            console.log('✅ Step 2 completed');
        } catch (err) {
            return { success: false, error: err.message, step: 'add_credit_card', shouldRetry: true };
        }

        await new Promise(r => setTimeout(r, 3000));

        // Detect if Amazon shows a popup form (no secure iframe)
        let usePopupForm = false;
        try {
            const popupInput = await page.$('input[name="addCreditCardNumber"]');
            if (popupInput) {
                usePopupForm = await page.evaluate(el => {
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0;
                }, popupInput);
            }
        } catch { /* ignore */ }

        const targetPage = page;
        targetPage.setDefaultTimeout(timeout);

        // Helper: get the working iframe (or page for popup flow)
        const getIframe = async () => {
            if (usePopupForm) return targetPage;
            const valid = await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component');
            if (!valid) throw new Error('IFRAME_INVALID');
            const el = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
            if (!el) throw new Error('IFRAME_NOT_FOUND');
            const frame = await el.contentFrame();
            if (!frame) throw new Error('IFRAME_CONTENT_FRAME_NULL');
            return frame;
        };

        // ── Step 3: Card number ────────────────────────────────────────
        try {
            console.log('💳 Step 3: Entering card number...');
            const numberSelectors = [
                'input[autocomplete="cc-number"]',
                'input[name="addCreditCardNumber"]',
                'input[name*="cardNumber"]',
                'input[data-testid*="card-number"]',
                'input[placeholder*="card number" i]',
                'input[aria-label*="card number" i]',
                'input[type="tel"][maxlength="19"]',
                'input[type="tel"][maxlength="16"]',
            ];

            // ✅ FIX: Wait until card field actually appears in any frame before filling
            console.log('   ⏳ Waiting for card number field to appear...');
            const fieldFound = await findFrameWithSelector(targetPage, numberSelectors, 15000);
            if (!fieldFound) {
                // Log available frames for debugging
                const frameUrls = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
                console.log(`   ⚠️ Card field not found. Frames: ${frameUrls.map(u => u.slice(0, 80)).join(' | ')}`);
                throw new Error('CARD_NUMBER_FIELD_NOT_FOUND');
            }
            console.log(`   🔍 Card field in frame: ${fieldFound.selector}`);

            const fill = await fillCardNumberAcrossFrames(targetPage, cardInfo.number, numberSelectors, 12000);
            if (!fill.ok) throw new Error('CARD_NUMBER_FIELD_NOT_FOUND');
            console.log(`✅ Card number filled: ${fill.mode}`);
        } catch (err) {
            if (err.message.includes('detached Frame') || err.message.includes('Session closed'))
                return { success: false, error: 'FRAME_DETACHED', step: 'enter_card_number' };
            return { success: false, error: err.message, step: 'enter_card_number' };
        }

        await new Promise(r => setTimeout(r, 800));

        // ── Step 4: Cardholder name ────────────────────────────────────
        try {
            console.log('👤 Step 4: Entering cardholder name...');
            const ctx = await getIframe();

            // ✅ FIX 1: Use React-aware setter
            const nameSelectors = [
                'input[name="ppw-accountHolderName"]',
                'input[autocomplete="cc-name"]',
                'input[aria-label*="name" i]',
            ];
            let filled = false;
            for (const sel of nameSelectors) {
                try {
                    await typeLikeUser(targetPage, ctx, [sel], cardInfo.name, 'Cardholder name');
                    filled = true;
                    console.log(`Name typed like user: ${sel}`);
                    break;
                } catch { /* try next */ }
            }
            for (const sel of nameSelectors) {
                if (filled) break;
                try {
                    const ok = await setReactInputValue(ctx, sel, cardInfo.name);
                    if (ok) { filled = true; console.log(`✅ Name filled: ${sel}`); break; }
                } catch { /* try next */ }
            }
            // Fallback: type
            if (!filled) {
                for (const sel of nameSelectors) {
                    try {
                        const handle = await ctx.$(sel);
                        if (!handle) continue;
                        await handle.click({ clickCount: 3 });
                        await handle.type(cardInfo.name, { delay: 30 });
                        filled = true;
                        console.log(`✅ Name typed: ${sel}`);
                        break;
                    } catch { /* try next */ }
                }
            }
            if (!filled) throw new Error('NAME_FIELD_NOT_FILLED');
        } catch (err) {
            if (err.message.includes('detached') || err.message === 'IFRAME_INVALID')
                return { success: false, error: 'FRAME_DETACHED', step: 'enter_cardholder_name' };
            return { success: false, error: err.message, step: 'enter_cardholder_name' };
        }

        await new Promise(r => setTimeout(r, 800));

        // ── Step 5: Expiry month ───────────────────────────────────────
        try {
            console.log('📅 Step 5: Selecting expiry month...');
            const ctx = await getIframe();
            const monthVal = String(Number(cardInfo.month));
            const monthSels = [
                'select[name="ppw-expirationDate_month"]',
                'select[name*="expirationDate_month"]',
                'select[aria-label*="month" i]',
            ];
            let selected = false;
            for (const sel of monthSels) {
                try {
                    // Uncheck "update everywhere" checkbox if present
                    const cb = await ctx.$('.a-checkbox.pmts-update-everywhere-checkbox input');
                    if (cb) {
                        const checked = await ctx.evaluate(el => el.checked, cb);
                        if (checked) await cb.click();
                    }
                    // ✅ FIX 1: React-aware select
                    await selectLikeUser(ctx, [sel], monthVal, 'Expiration month');
                    selected = true;
                    console.log(`Month selected like user: ${sel}`);
                    break;
                    if (ok) { selected = true; console.log(`✅ Month selected: ${sel}`); break; }
                } catch { /* try next */ }
            }
            if (!selected) {
                for (const sel of monthSels) {
                    try {
                        const ok = await setReactSelectValue(ctx, sel, monthVal);
                        if (ok) { selected = true; console.log(`Month selected with setter: ${sel}`); break; }
                    } catch { /* try next */ }
                }
            }
            if (!selected) throw new Error('MONTH_NOT_SELECTED');
        } catch (err) {
            if (err.message.includes('detached') || err.message === 'IFRAME_INVALID')
                return { success: false, error: 'FRAME_DETACHED', step: 'select_month' };
            return { success: false, error: err.message, step: 'select_month' };
        }

        await new Promise(r => setTimeout(r, 800));

        // ── Step 6: Expiry year ────────────────────────────────────────
        try {
            console.log('📅 Step 6: Selecting expiry year...');
            const ctx = await getIframe();
            const yearVal = String(cardInfo.year);
            const yearSels = [
                'select[name="ppw-expirationDate_year"]',
                'select[name*="expirationDate_year"]',
                'select[aria-label*="year" i]',
            ];
            let selected = false;

            // Strategy 1: React-aware select (native <select>)
            for (const sel of yearSels) {
                try {
                    await selectLikeUser(ctx, [sel], yearVal, 'Expiration year');
                    selected = true;
                    console.log(`Year selected like user: ${sel}`);
                    break;
                    if (ok) { selected = true; console.log(`✅ Year selected (native): ${sel}`); break; }
                } catch { /* try next */ }
            }

            if (!selected) {
                for (const sel of yearSels) {
                    try {
                        const ok = await setReactSelectValue(ctx, sel, yearVal);
                        if (ok) { selected = true; console.log(`Year selected with setter: ${sel}`); break; }
                    } catch { /* try next */ }
                }
            }

            // Strategy 2: Dropdown popup (Amazon sometimes replaces <select> with custom dropdown)
            if (!selected) {
                try {
                    await ctx.click('.a-button.a-button-dropdown.pmts-expiry-year .a-button-text.a-declarative');
                    await new Promise(r => setTimeout(r, 1500));
                    selected = await ctx.evaluate(target => {
                        const links = [...document.querySelectorAll('.a-popover[aria-hidden="false"] a')];
                        const link  = links.find(l => l.textContent.trim() === target);
                        if (link) { link.click(); return true; }
                        return false;
                    }, yearVal);
                    if (selected) console.log('✅ Year selected via dropdown popup');
                } catch { /* strategy 3 */ }
            }

            // Strategy 3: Keyboard navigation
            if (!selected) {
                try {
                    const diff = Number(yearVal) - new Date().getFullYear();
                    await ctx.evaluate(() => {
                        const el = document.querySelector('.a-button.a-button-dropdown.pmts-expiry-year');
                        if (el) el.focus();
                    });
                    const key = diff >= 0 ? 'ArrowDown' : 'ArrowUp';
                    for (let i = 0; i < Math.abs(diff); i++) {
                        await page.keyboard.press(key);
                        await new Promise(r => setTimeout(r, 150));
                    }
                    await page.keyboard.press('Enter');
                    selected = true;
                    console.log('✅ Year selected via keyboard');
                } catch { /* ignore */ }
            }

            if (!selected) throw new Error(`YEAR_NOT_SELECTED: ${yearVal}`);

            // CVV right after year (still in same iframe context)
            if (cardInfo.cvc) {
                const cvvRequired = await hasVisibleCvvField(targetPage);
                if (cvvRequired) {
                    const cvvFill = await fillCvvAcrossFrames(targetPage, cardInfo.cvc, 8000);
                    if (!cvvFill.ok) throw new Error('CVV_FIELD_NOT_FILLED');
                    console.log(`✅ CVV filled: ${cvvFill.mode}`);
                } else {
                    console.log('ℹ️ CVV field not present on this form, skipping CVV input');
                }
            }
        } catch (err) {
            if (err.message.includes('detached') || err.message === 'IFRAME_INVALID')
                return { success: false, error: 'FRAME_DETACHED', step: 'select_year' };
            return { success: false, error: err.message, step: 'select_year' };
        }

        await new Promise(r => setTimeout(r, 1500));

        // ── Step 7: Submit ─────────────────────────────────────────────
        try {
            console.log('🚀 Step 7: Submitting card form...');

            const submitted = await clickFilledPaymentFormSubmit(targetPage, cardInfo);

            if (!submitted) {
                // If verifyFieldsBeforeSubmit found empty fields, try refilling inline
                console.log('⚠️ Submit blocked — attempting inline refill...');
                const ctx = usePopupForm ? targetPage : await getIframe().catch(() => targetPage);

                // Refill text fields with real keyboard events first.
                await typeLikeUser(targetPage, ctx, ['input[name="addCreditCardNumber"]'], cardInfo.number, 'Card number', { digitsOnly: true })
                    .catch(() => setReactInputValue(ctx, 'input[name="addCreditCardNumber"]', cardInfo.number).catch(() => {}));
                await typeLikeUser(targetPage, ctx, ['input[name="ppw-accountHolderName"]'], cardInfo.name, 'Cardholder name')
                    .catch(() => setReactInputValue(ctx, 'input[name="ppw-accountHolderName"]', cardInfo.name).catch(() => {}));
                await selectLikeUser(ctx, ['select[name="ppw-expirationDate_month"]'], String(Number(cardInfo.month)), 'Expiration month')
                    .catch(() => setReactSelectValue(ctx, 'select[name="ppw-expirationDate_month"]', String(Number(cardInfo.month))).catch(() => {}));
                await selectLikeUser(ctx, ['select[name="ppw-expirationDate_year"]'], String(cardInfo.year), 'Expiration year')
                    .catch(() => setReactSelectValue(ctx, 'select[name="ppw-expirationDate_year"]', String(cardInfo.year)).catch(() => {}));
                if (cardInfo.cvc) await fillCvvAcrossFrames(targetPage, cardInfo.cvc, 5000);

                await new Promise(r => setTimeout(r, 500));

                const retried = await clickFilledPaymentFormSubmit(targetPage, cardInfo);
                if (!retried) throw new Error('SUBMIT_BUTTON_NOT_FOUND_AFTER_REFILL');
            }

            console.log('✅ Form submitted');
        } catch (err) {
            if (err.message.includes('detached') || err.message === 'IFRAME_INVALID')
                return { success: false, error: 'FRAME_DETACHED', step: 'submit_card' };
            return { success: false, error: err.message, step: 'submit_card' };
        }

        await new Promise(r => setTimeout(r, 1000));

        // ── Step 8: Address confirmation + result wait ─────────────────
        console.log('📍 Step 8: Waiting for card submit result...');

        const result = await waitForCardSubmitResult(page, cardInfo.number.slice(-4), 18000);
        if (!result.success) {
            return {
                success: false,
                error: result.error,
                step: 'verify_card_submit',
                shouldRetry: retryCount < MAX_RETRIES - 1,
            };
        }

        // ── Step 9: Immediate reload & status check ──
        console.log('⏳ Waiting 2s before reload...');
        await new Promise(r => setTimeout(r, 2000));
        
        console.log('🔄 Reloading page to verify card status...');
        try {
            await safePageReload(page, 30000);
            await new Promise(r => setTimeout(r, 3000));

            // Wait for scroller to be visible
            await page.waitForSelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical', { timeout: 15000 });

            const last4 = cardInfo.number.slice(-4);
            const imgUrl = await page.evaluate((last4Digits) => {
                const scroller = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
                if (!scroller) return null;
                const tabs = scroller.querySelectorAll('.apx-wallet-selectable-payment-method-tab');
                for (const tab of tabs) {
                    const text = tab.textContent || '';
                    if (text.includes(last4Digits)) {
                        const img = tab.querySelector('img.apx-wallet-selectable-image') || tab.querySelector('img');
                        if (img) return img.src;
                    }
                }
                return null;
            }, last4);

            if (imgUrl) {
                console.log(`🔍 Card ***${last4} image URL detected: ${imgUrl}`);
                const dieUrls = [
                    'https://m.media-amazon.com/images/I/41MGiaNMk5L._SL85_.png',
                    'https://m.media-amazon.com/images/I/81NBfFByidL._SL85_.png'
                ];
                if (dieUrls.includes(imgUrl)) {
                    console.log(`❌ Card ***${last4} is DIE (matches restricted image: ${imgUrl})`);
                    return { success: false, error: 'CARD_DIE', img: imgUrl };
                } else {
                    console.log(`✅ Card ***${last4} is LIVE (image: ${imgUrl})`);
                    return { success: true, img: imgUrl };
                }
            } else {
                console.log(`⚠️ Could not find card ***${last4} in wallet scroller after reload`);
            }
        } catch (err) {
            console.log(`⚠️ Error checking card status: ${err.message}`);
        }

        return { success: true };

    } catch (err) {
        console.error('Error in addCard:', err.message);

        if (err.message === 'FRAME_DETACHED' || err.message.includes('detached Frame') || err.message.includes('Session closed')) {
            return { success: false, error: 'FRAME_DETACHED', step: 'frame_detached', shouldRestart: true };
        }

        return {
            success: false,
            error: err.message,
            shouldRetry: retryCount < MAX_RETRIES - 1,
        };
    }
}

// async function addCard(page, cardInfo, retryCount = 0) {
//     // ✅ TEST THỦ CÔNG: Mở browser, điền card tay, nhấn Enter để tiếp tục
//     const readline = require('readline');
//     const rl = readline.createInterface({
//         input: process.stdin,
//         output: process.stdout
//     });

//     await new Promise(resolve => {
//         rl.question(
//             `\n👉 Card: ${cardInfo.number} | ${cardInfo.month}/${cardInfo.year} | CVV: ${cardInfo.cvc}\n` +
//             `   Điền card thủ công trên browser, xong nhấn ENTER...`,
//             () => { rl.close(); resolve(); }
//         );
//     });

//     // Sau khi nhấn Enter → chờ kết quả
//     const result = await waitForCardSubmitResult(page, cardInfo.number.slice(-4), 18000);
//     if (!result.success) {
//         return { success: false, error: result.error, step: 'manual_test' };
//     }
//     return { success: true };
// }

module.exports = addCard;
