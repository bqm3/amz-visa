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

function getCheckAfterDelayMs() {
    const rawValue = global.data?.settings?.checkAfter;
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.max(parsed, 1000);
    }
    return 10000;
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

async function isCardFormVisible(page) {
    const cardSelectors = [
        'input[data-testid="card-text-input"]',
        '#card-number-input input',
        'input[autocomplete="cc-number"]',
        'input[name="addCreditCardNumber"]',
        'input[name*="cardNumber"]',
        'input[name*="addCreditCard"]',
        'input[id*="cardNumber"]',
        'input[type="tel"][maxlength="19"]',
        'input[type="tel"][maxlength="16"]'
    ];
    for (const ctx of [page, ...page.frames()]) {
        try {
            const found = await ctx.evaluate((sels) => {
                const isVisible = (el) => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
                };
                return sels.some(sel => Array.from(document.querySelectorAll(sel)).some(isVisible));
            }, cardSelectors);
            if (found) return true;
        } catch { }
    }
    return false;
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
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: val.slice(-1) }));
        input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: val.slice(-1) }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: val.slice(-1) }));
        input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

        return input.value === val || input.value.replace(/\D/g, '') === val.replace(/\D/g, '');
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

        select.dispatchEvent(new Event('input', { bubbles: true }));
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
                    console.log(`${label} đã nhập theo kiểu người dùng: ${selector}`);
                    return { ok: true, selector };
                }
            } catch {
                try { await page.keyboard.up('Control'); } catch { }
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

                // Smart select matching: works for 1 vs 01, 2026 vs 26
                const selectedVal = await handle.evaluate((el, targetVal) => {
                    const targetNum = Number(targetVal);
                    const targetStr = String(targetVal || '').trim();
                    const opts = Array.from(el.options || []);
                    const match = opts.find(o => {
                        const v = String(o.value || '').trim();
                        const t = String(o.text || '').trim();
                        if (v === targetStr || t === targetStr) return true;
                        if (Number.isFinite(targetNum) && Number(v) === targetNum) return true;
                        if (targetStr.length === 2 && v.slice(-2) === targetStr) return true;
                        if (targetStr.length === 4 && v === targetStr.slice(-2)) return true;
                        return false;
                    });
                    if (match) {
                        el.value = match.value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.blur();
                        return match.value;
                    }
                    return null;
                }, expected);

                if (selectedVal) {
                    console.log(`${label} đã chọn theo kiểu người dùng: ${selector} (${selectedVal})`);
                    return { ok: true, selector, value: selectedVal };
                }

                await handle.select(expected);
                const verified = await handle.evaluate((el, val) => {
                    const ok = String(el.value) === String(val) || String(el.value).slice(-2) === String(val).slice(-2);
                    if (ok) {
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.blur();
                    }
                    return ok;
                }, expected);

                if (verified) {
                    console.log(`${label} đã chọn theo kiểu người dùng: ${selector}`);
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
                        const rect = input.getBoundingClientRect();
                        if (style.display === 'none' || style.visibility === 'hidden' || !rect.width) return false;

                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (nativeSetter) nativeSetter.call(input, '');
                        else input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));

                        if (nativeSetter) nativeSetter.call(input, val);
                        else input.value = val;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

                        return input.value.replace(/\D/g, '') === val.replace(/\D/g, '');
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
                        return el?.value?.replace(/\D/g, '') === val.replace(/\D/g, '');
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
        'input[data-testid="cvv-text-input"]',
        '#cvv-input input',
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
                        const rect = input.getBoundingClientRect();
                        if (style.display === 'none' || style.visibility === 'hidden' || !rect.width) return false;

                        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                        if (nativeSetter) nativeSetter.call(input, '');
                        else input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));

                        if (nativeSetter) nativeSetter.call(input, val);
                        else input.value = val;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
                        input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

                        return input.value.replace(/\D/g, '') === val.replace(/\D/g, '');
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
                        if (attrs.includes('cc-csc')) s += 120;
                        if (attrs.includes('security code')) s += 110;
                        if (attrs.includes('verification')) s += 100;
                        if (attrs.includes('cvv')) s += 100;
                        if (attrs.includes('cvc')) s += 100;
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
                    best.el.dispatchEvent(new Event('input', { bubbles: true }));
                    best.el.dispatchEvent(new Event('change', { bubbles: true }));
                    best.el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                    return best.el.value.replace(/\D/g, '') === val.replace(/\D/g, '') ? { name: best.el.name, score: best.s } : null;
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
                const isVisible = (el) => {
                    if (!el || el.disabled || el.readOnly) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
                };
                const q = sel => {
                    const els = document.querySelectorAll(sel);
                    return Array.from(els).find(isVisible);
                };

                const card = q('input[data-testid="card-text-input"]') ||
                             q('#card-number-input input') ||
                             q('input[autocomplete="cc-number"]') ||
                             q('input[name="addCreditCardNumber"]') ||
                             q('input[name*="cardNumber"]');

                const name = q('input[data-testid="input-text-input"]') ||
                             q('#account-holder-name-input input') ||
                             q('input[autocomplete="cc-name"]') ||
                             q('input[name="ppw-accountHolderName"]');

                const expSingle = q('input[data-testid="date-expiration-text-input"]') ||
                                  q('#expiration-date-input input') ||
                                  q('input[autocomplete="cc-exp"]');

                const month = q('select[name="ppw-expirationDate_month"]') || q('select[name*="expirationDate_month"]');
                const year = q('select[name="ppw-expirationDate_year"]') || q('select[name*="expirationDate_year"]');

                const cvvCandidates = [
                    q('input[data-testid="cvv-text-input"]'),
                    q('#cvv-input input'),
                    q('input[autocomplete="cc-csc"]'),
                    q('input[name="addCreditCardVerificationNumber"]'),
                    q('input[name*="cvv" i]'),
                    q('input[name*="cvc" i]'),
                    q('input[name*="verification" i]')
                ].filter(Boolean);
                const cvv = cvvCandidates.find(isVisible) || null;

                const hasMonth = expSingle ? (expSingle.value || '').trim().length >= 4 : !!(month?.value);
                const hasYear = expSingle ? (expSingle.value || '').trim().length >= 4 : !!(year?.value);

                return {
                    card: (card?.value || '').replace(/\D/g, '').length,
                    name: (name?.value || '').trim().length,
                    month: hasMonth ? 'OK' : '',
                    year: hasYear ? 'OK' : '',
                    cvv: (cvv?.value || '').replace(/\D/g, '').length,
                    cvvPresent: !!cvv,
                };
            });
            if (state.card >= 12) return state; // found filled form in context
        } catch { /* try next frame */ }
    }
    return { card: 0, name: 0, month: '', year: '', cvv: 0, cvvPresent: false };
}

async function hasVisibleCvvField(page) {
    const selectors = [
        'input[data-testid="cvv-text-input"]',
        '#cvv-input input',
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

    for (const frame of [page, ...page.frames()]) {
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

                // 1. Direct query for SelectAddressEvent & pmts-use-selected-address elements
                const selectAddressSelectors = [
                    'input[name="ppw-widgetEvent:SelectAddressEvent"]',
                    'input[name*="SelectAddressEvent"]',
                    '.pmts-use-selected-address input',
                    '.pmts-use-selected-address button',
                    '.pmts-use-selected-address',
                    'span.pmts-use-selected-address input[type="submit"]',
                    '#apx-add-address-button-id ~ span.pmts-use-selected-address input'
                ];

                for (const sel of selectAddressSelectors) {
                    const elements = [...document.querySelectorAll(sel)].filter(isVisible);
                    for (const el of elements) {
                        const radio = document.querySelector('input[name="ppw-addressSelection"]');
                        if (radio && !radio.checked) {
                            try { radio.click(); } catch (_) { }
                        }

                        const clickable = el.closest('.a-button') || el.closest('span.a-button-inner') || el;
                        try {
                            clickable.click();
                            return `SelectAddressEvent (${sel})`;
                        } catch (_) {
                            try {
                                el.click();
                                return `SelectAddressEvent:direct (${sel})`;
                            } catch (_) { }
                        }
                    }
                }

                // 2. Comprehensive check for buttons matching address selection text/metadata
                for (const el of document.querySelectorAll('input[type="submit"], button, a, .a-button-input, span.a-button')) {
                    if (!isVisible(el)) continue;

                    const ariaLabelledBy = el.getAttribute('aria-labelledby')
                        ? (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || '')
                        : '';
                    const parentText = el.parentElement ? (el.parentElement.textContent || '') : '';
                    const grandParentText = el.parentElement?.parentElement ? (el.parentElement.parentElement.textContent || '') : '';
                    const containerClass = [
                        el.className || '',
                        el.parentElement?.className || '',
                        el.parentElement?.parentElement?.className || '',
                        el.closest('.a-button')?.className || '',
                        el.closest('[class*="address"]')?.className || ''
                    ].join(' ');

                    const meta = [
                        el.value || '',
                        el.textContent || '',
                        el.getAttribute('aria-label') || '',
                        el.name || '',
                        el.id || '',
                        containerClass,
                        ariaLabelledBy,
                        parentText,
                        grandParentText
                    ].join(' ').toLowerCase();

                    const isAddressAction =
                        meta.includes('selectaddressevent') ||
                        meta.includes('use this address') ||
                        meta.includes('ship to this address') ||
                        meta.includes('selected-address') ||
                        meta.includes('use-selected-address') ||
                        meta.includes('pmts-use-selected-address') ||
                        meta.includes('この住所を使用') ||
                        meta.includes('この住所を使う');

                    if (isAddressAction) {
                        const clickable = el.closest('.a-button') || el.closest('span.a-button-inner') || el;
                        try {
                            clickable.click();
                            return meta.slice(0, 80);
                        } catch (_) {
                            el.click();
                            return meta.slice(0, 80);
                        }
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

async function handleEmbeddedBillingAddressForm(page, cardInfo = null, waitMs = 10000) {
    const path = require('path');
    const addressApi = require(path.join(__dirname, 'addAddress.js'));
    const start = Date.now();

    while (Date.now() - start < waitMs) {
        // 1. Search for explicit iframe#billingAddressEmbeddedView or src containing manage-address
        for (const frame of page.frames()) {
            try {
                const iframeEl = await frame.$('#billingAddressEmbeddedView') ||
                                 await frame.$('iframe[src*="manage-address"]') ||
                                 await frame.$('iframe[id*="billingAddress"]');
                if (iframeEl) {
                    const embeddedFrame = await iframeEl.contentFrame();
                    if (embeddedFrame) {
                        const hasFormContainer = await embeddedFrame.$('#address-ui-widgets-enterAddressFormContainer') ||
                                                 await embeddedFrame.$('form[action*="manage-address"]') ||
                                                 await embeddedFrame.$('input[name="ppw-widgetEvent:AddAddressEvent"]') ||
                                                 await embeddedFrame.$('#address-ui-widgets-enterAddressFullName') ||
                                                 await embeddedFrame.$('input[name="address-ui-widgets-enterAddressFullName"]');
                        if (hasFormContainer) {
                            console.log('   Phát hiện iframe#billingAddressEmbeddedView, đang tự động điền địa chỉ...');
                            await addressApi.addAddress(embeddedFrame, { name: cardInfo?.name, apiRetries: 1 });
                            return true;
                        }
                    }
                }
            } catch { }
        }

        // 2. Search across all frames and page context directly
        const contexts = [page, ...page.frames()];
        for (const ctx of contexts) {
            try {
                const hasFormContainer = await ctx.$('#address-ui-widgets-enterAddressFormContainer') ||
                                         await ctx.$('form[action*="manage-address"]') ||
                                         await ctx.$('input[name="ppw-widgetEvent:AddAddressEvent"]') ||
                                         await ctx.$('#address-ui-widgets-enterAddressFullName') ||
                                         await ctx.$('input[name="address-ui-widgets-enterAddressFullName"]');
                if (hasFormContainer) {
                    console.log('   Phát hiện form Địa chỉ Billing trong context, đang tự động điền...');
                    await addressApi.addAddress(ctx, { name: cardInfo?.name, apiRetries: 1 });
                    return true;
                }
            } catch { }
        }
        await new Promise(r => setTimeout(r, 400));
    }
    return false;
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

                const problemToken = ['there was a problem', 'invalid', 'declined', 'not accepted',
                    'please enter', 'please correct', 'expired', 'unable to add', 'cannot add']
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
        errorText: states.map(s => s.errorText).find(Boolean) || '',
        formVisible: states.some(s => s.formVisible),
        last4Visible: states.some(s => s.last4Visible),
        successTextVisible: states.some(s => s.successTextVisible),
    };
}

async function waitForCardSubmitResult(page, last4, timeoutMs = 18000, cardInfo = null) {
    const started = Date.now();
    let addressClicked = false;

    while (Date.now() - started < timeoutMs) {
        const currentUrl = page.url();

        // ✅ Check 1: Redirected to homepage or away from payment wallet
        if (
            currentUrl === 'https://www.amazon.co.jp/' ||
            currentUrl === 'https://www.amazon.co.jp' ||
            currentUrl.startsWith('https://www.amazon.co.jp/?') ||
            currentUrl.includes('/ref=') ||
            currentUrl.includes('/gp/css/homepage')
        ) {
            console.log(`Phát hiện bị điều hướng về trang chủ (${currentUrl}), tự động chuyển về trang wallet để kiểm tra thẻ ***${last4}...`);
            try {
                await page.goto('https://www.amazon.co.jp/cpe/yourpayments/wallet', {
                    waitUntil: 'domcontentloaded', timeout: 15000
                });
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                console.log(`Lỗi khi chuyển về trang wallet: ${err.message}`);
            }
        }

        // ✅ Check 2: Detect wallet URL redirect = card added successfully
        if (
            currentUrl.includes('/cpe/yourpayments/wallet') ||
            currentUrl.includes('/cpe/managePayment')
        ) {
            // Wait a moment for page content to settle
            await new Promise(r => setTimeout(r, 1500));
            const walletState = await inspectCardSubmitState(page, last4);
            if (walletState.last4Visible || walletState.successTextVisible) {
                console.log(`Thẻ ***${last4} đã thêm thành công (redirect về ví)`);
                return { success: true };
            }
            // On wallet page but card not visible → may have been rejected silently
            if (walletState.errorText) {
                console.log(`Thẻ ***${last4} bị từ chối: ${walletState.errorText}`);
                return { success: false, error: walletState.errorText };
            }
            // Still on wallet, no error, no last4 → wait more
        }

        const clicked = await clickAddressConfirmationIfPresent(page);
        if (clicked && !addressClicked) {
            addressClicked = true;
            console.log(`   Đã bấm xác nhận địa chỉ ('Use this address'): ${clicked}`);
            await new Promise(r => setTimeout(r, 1500));
        } else if (!addressClicked) {
            const handledAddr = await handleEmbeddedBillingAddressForm(page, cardInfo, 2000);
            if (handledAddr) {
                addressClicked = true;
                console.log('   Đã điền và submit form địa chỉ Billing thành công!');
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        const state = await inspectCardSubmitState(page, last4);
        if (state.errorText) {
            console.log(`Thẻ ***${last4} lỗi: ${state.errorText.slice(0, 100)}`);
            return { success: false, error: state.errorText.slice(0, 180) };
        }
        if (state.last4Visible || state.successTextVisible) {
            console.log(`Thẻ ***${last4} đã thêm thành công`);
            return { success: true };
        }

        await new Promise(r => setTimeout(r, 700));
    }

    // Timeout — do one final wallet check
    console.log(`Timeout khi chờ thẻ ***${last4} - chuyển sang kiểm tra ví...`);
    try {
        await page.goto('https://www.amazon.co.jp/cpe/yourpayments/wallet', {
            waitUntil: 'domcontentloaded', timeout: 8000
        });
        await new Promise(r => setTimeout(r, 2500));
        const walletState = await inspectCardSubmitState(page, last4);
        if (walletState.last4Visible || walletState.successTextVisible) {
            console.log(`Thẻ ***${last4} đã được xác nhận trong ví`);
            return { success: true };
        }
        if (walletState.errorText) return { success: false, error: walletState.errorText.slice(0, 180) };
    } catch { /* ignore */ }

    console.log(`Thẻ ***${last4} chưa được xác nhận sau timeout`);
    return { success: false, error: 'CARD_NOT_CONFIRMED_IN_WALLET' };
}

// ─────────────────────────────────────────────
// CLICK SUBMIT — with pre-submit field verification
// ─────────────────────────────────────────────
async function clickFilledPaymentFormSubmit(page, cardInfo) {
    // ✅ FIX 2: Verify fields are actually filled before clicking submit
    const preCheck = await verifyFieldsBeforeSubmit(page);
    console.log(`Kiểm tra field trước khi submit: ${JSON.stringify(preCheck)}`);

    const missing = [];
    if (preCheck.card < 13) missing.push('card');
    if (preCheck.name < 2) missing.push('name');
    if (!preCheck.month) missing.push('month');
    if (!preCheck.year) missing.push('year');
    if (cardInfo.cvc && preCheck.cvvPresent && preCheck.cvv < 3) missing.push('cvv');

    if (missing.length > 0) {
        console.log(`Field còn trống trước khi submit: ${missing.join(', ')} - hủy submit`);
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

                const isCancelOrClose = el => {
                    const meta = `${el.getAttribute('aria-label') || ''} ${el.value || ''} ${el.textContent || ''} ${el.className || ''} ${el.id || ''}`.toLowerCase();
                    return meta.includes('close') || meta.includes('cancel') || meta.includes('閉じる') || meta.includes('キャンセル') || meta.includes('back');
                };

                const candidates = [...document.querySelectorAll(
                    'button[aria-label="Add and continue"], button[aria-label*="Add and continue" i], ' +
                    '[data-testid="button"] button, input[name="ppw-widgetEvent:AddCreditCardEvent"], ' +
                    'input[type="submit"], button[type="submit"], button[type="button"], .a-button-primary input.a-button-input'
                )].filter(isVisible).filter(el => !isCancelOrClose(el));

                const submit = candidates.find(el => {
                    const label = `${el.getAttribute('aria-label') || ''} ${el.value || ''} ${el.textContent || ''}`.toLowerCase();
                    return label.includes('add and continue') ||
                        label.includes('add credit card') ||
                        label.includes('add card') ||
                        label.includes('カードを追加') ||
                        label.includes('追加して次へ') ||
                        el.name === 'ppw-widgetEvent:AddCreditCardEvent';
                }) || candidates.find(el => {
                    const label = `${el.getAttribute('aria-label') || ''} ${el.value || ''} ${el.textContent || ''}`.toLowerCase();
                    return label.includes('add') || label.includes('continue') || label.includes('confirm') || label.includes('追加');
                });

                if (!submit) return { clicked: false };

                try {
                    submit.click();
                    return { clicked: true };
                } catch (_) {
                    const submitSelector = submit.name ? `${submit.tagName.toLowerCase()}[name="${submit.name}"]`
                        : submit.id ? `#${submit.id}` : '';
                    return { clicked: false, submitSelector };
                }
            }, cardInfo);

            if (result?.clicked) {
                console.log(`Đã bấm submit form thanh toán - field OK: ${JSON.stringify(preCheck)}`);
                return true;
            } else if (result?.submitSelector) {
                const handle = await ctx.$(result.submitSelector);
                if (handle) {
                    await handle.click();
                    console.log(`Đã bấm submit form thanh toán bằng handle - field OK: ${JSON.stringify(preCheck)}`);
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
async function addCard(page, cardInfo, retryCount = 0, shouldVerify = true) {
    const MAX_RETRIES = 3;
    if (retryCount >= MAX_RETRIES) {
        console.log(`Đã đạt giới hạn thử lại (${MAX_RETRIES})`);
        return { success: false, error: 'MAX_RETRIES_EXCEEDED' };
    }

    try {
        const timeout = 15000;
        page.setDefaultTimeout(timeout);

        if (page.isClosed()) return { success: false, error: 'PAGE_CLOSED', shouldRetry: true };

        // ── Navigate to wallet ──────────────────────────────────────────
        try {
            console.log('Đang đảm bảo đã ở trang thanh toán...');
            const url = page.url();
            if (!url.includes('yourpayments') || !url.includes('wallet')) {
                await page.goto('https://www.amazon.co.jp/cpe/yourpayments/wallet', {
                    waitUntil: 'domcontentloaded', timeout: 30000
                });
                await new Promise(r => setTimeout(r, 3000));
            }
        } catch (err) {
            console.log(`Lỗi điều hướng: ${err.message}`);
            return { success: false, error: 'NAVIGATION_ERROR', shouldRetry: true };
        }

        // ── Step 1: Click "Add a payment method" or "Add new" ──────────────
        try {
            console.log('Bước 1: bấm Add Payment Method...');
            let clicked = false;

            // Check if card form is already open
            if (await isCardFormVisible(page)) {
                console.log('   Form/Popup/Sleeve nhập thẻ đã mở sẵn, bỏ qua Bước 1 & 2');
                clicked = true;
            }

            for (let attempt = 1; attempt <= 5 && !clicked; attempt++) {
                console.log(`   Attempt ${attempt}/5`);

                // Check across all frames / page for trigger elements
                for (const ctx of [page, ...page.frames()]) {
                    try {
                        clicked = await ctx.evaluate(() => {
                            const isVisible = el => {
                                if (!el) return false;
                                const s = window.getComputedStyle(el);
                                const r = el.getBoundingClientRect();
                                return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
                            };

                            const spans = [...document.querySelectorAll('[data-testid="text"], span, a, button, [role="button"]')].filter(isVisible);
                            const addNew = spans.find(el => {
                                const t = (el.textContent || '').trim().toLowerCase();
                                return t === 'add new' || t === 'add a payment method' || t.includes('お支払い方法を追加') || t.includes('支払い方法を追加') || t === 'お支払い方法の追加';
                            });
                            if (addNew) {
                                const clickable = addNew.closest('a, button, [role="button"]') || addNew;
                                clickable.click();
                                return true;
                            }
                            return false;
                        });
                        if (clicked) break;
                    } catch { }
                }

                if (!clicked) {
                    try {
                        await puppeteer.Locator.race([
                            page.locator('::-p-aria(Add a payment method[role="link"])'),
                            page.locator('#pp-paEOaP-10'),
                        ]).setTimeout(4000).click();
                        clicked = true;
                        console.log('   Locator race đã hoạt động');
                    } catch { /* try next */ }
                }

                if (!clicked) {
                    try {
                        const btn = await page.waitForSelector(
                            '#pp-paEOaP-10, [data-testid*="add-payment"]',
                            { timeout: 3000 }
                        );
                        if (btn) { await btn.click(); clicked = true; }
                    } catch { /* try next */ }
                }

                if (!clicked) {
                    for (const ctx of [page, ...page.frames()]) {
                        try {
                            clicked = await ctx.evaluate(() => {
                                for (const el of [...document.querySelectorAll('a, button, [role="button"], input[type="submit"]')]) {
                                    const t = (el.textContent || el.value || '').toLowerCase();
                                    const href = (el.getAttribute('href') || '').toLowerCase();
                                    if (href.includes('browse.html') || href.includes('adsystem') || href.includes('amazon-ad')) continue;
                                    if ((t.includes('add') && (t.includes('payment') || t.includes('new'))) || t.includes('お支払い方法を追加')) {
                                        el.click(); return true;
                                    }
                                }
                                return false;
                            });
                            if (clicked) break;
                        } catch { }
                    }
                }

                if (await isCardFormVisible(page)) {
                    console.log('   Form/Popup/Sleeve nhập thẻ đã xuất hiện sau khi bấm!');
                    clicked = true;
                }

                if (!clicked) {
                    await new Promise(r => setTimeout(r, 1500));
                    if (attempt === 3) {
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 });
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }
            }

            if (!clicked) throw new Error('ADD_PAYMENT_METHOD_NOT_CLICKED');
            console.log('Bước 1 hoàn tất');
        } catch (err) {
            return { success: false, error: err.message, step: 'add_payment_method', shouldRetry: true };
        }

        await new Promise(r => setTimeout(r, 1500));

        // ── Guard check: Did page navigate away to ad / promo page? ─────────
        if (!page.url().includes('yourpayments') && !page.url().includes('wallet')) {
            console.log(`Phát hiện bị điều hướng khỏi trang wallet (${page.url()}), quay lại wallet...`);
            await page.goto('https://www.amazon.co.jp/cpe/yourpayments/wallet', { waitUntil: 'domcontentloaded', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
        }

        // ── Step 2: Select "Add a credit or debit card" ────────────────
        try {
            console.log('Bước 2: chọn Credit/Debit Card...');
            let clicked = false;

            // Check if card form is already open
            if (await isCardFormVisible(page)) {
                console.log('   Form/Popup/Sleeve nhập thẻ đã hiển thị, bỏ qua Bước 2');
                clicked = true;
            }

            for (let attempt = 1; attempt <= 5 && !clicked; attempt++) {
                console.log(`   Attempt ${attempt}/5`);

                for (const ctx of [page, ...page.frames()]) {
                    try {
                        clicked = await ctx.evaluate(() => {
                            const isVisible = el => {
                                if (!el) return false;
                                const s = window.getComputedStyle(el);
                                const r = el.getBoundingClientRect();
                                return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
                            };

                            const sleeveCard = document.querySelector('a[data-testid="creatable-sleeve-Card"]') ||
                                               document.querySelector('[data-testid="creatable-sleeve-Card-content-wrapper"]') ||
                                               document.querySelector('[data-testid="creatable-sleeve-Card"]');
                            if (sleeveCard && isVisible(sleeveCard)) {
                                const clickable = sleeveCard.closest('a, button, [role="button"]') || sleeveCard;
                                try { clickable.click(); } catch (_) { sleeveCard.click(); }
                                return true;
                            }

                            const byTestId = document.querySelector('#apx-add-credit-card-action-test-id input.a-button-input[type="submit"]');
                            if (byTestId && isVisible(byTestId)) { byTestId.click(); return true; }

                            const clickables = [
                                ...document.querySelectorAll(
                                    'input.a-button-input[type="submit"], button, a, [role="button"], ' +
                                    '.a-popover input, .a-popover button, .a-popover a, ' +
                                    '[role="dialog"] input, [role="dialog"] button, [role="dialog"] a, ' +
                                    'div[data-pmts-component-id], div[data-testid]'
                                )
                            ].filter(isVisible);

                            for (const el of clickables) {
                                const text = `${el.textContent || ''} ${el.value || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
                                const href = (el.getAttribute('href') || '').toLowerCase();
                                if (href.includes('browse.html') || href.includes('adsystem') || href.includes('amazon-ad') || href.includes('/gp/browse')) continue;

                                const isCardOption =
                                    text.includes('add a credit or debit card') ||
                                    text.includes('add a credit card') ||
                                    text.includes('credit or debit card') ||
                                    text.includes('credit card') ||
                                    text.includes('debit card') ||
                                    text.includes('クレジットカード') ||
                                    text.includes('デビットカード') ||
                                    text.includes('カードを追加');

                                if (isCardOption) {
                                    const clickable = el.closest('a, button, [role="button"], input.a-button-input') || el;
                                    clickable.click();
                                    return true;
                                }
                            }

                            return false;
                        });
                        if (clicked) break;
                    } catch { }
                }

                console.log(clicked ? '   Đã bấm nút thêm thẻ' : '   Không tìm thấy, thử lại...');

                if (await isCardFormVisible(page)) {
                    console.log('   Form/Popup/Sleeve nhập thẻ đã xuất hiện!');
                    clicked = true;
                }

                if (!clicked) await new Promise(r => setTimeout(r, 1000));
            }

            if (!clicked) throw new Error('FAILED_CLICK_ADD_CREDIT_CARD_BUTTON');

            await new Promise(r => setTimeout(r, 300));
            console.log('Bước 2 hoàn tất');
        } catch (err) {
            return { success: false, error: err.message, step: 'add_credit_card', shouldRetry: true };
        }

        // ── Guard check: Did page navigate away after Step 2? ─────────
        if (!page.url().includes('yourpayments') && !page.url().includes('wallet')) {
            console.log(`Phát hiện bị điều hướng khỏi trang wallet sau Bước 2 (${page.url()}), quay lại wallet...`);
            await page.goto('https://www.amazon.co.jp/cpe/yourpayments/wallet', { waitUntil: 'domcontentloaded', timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
        }

        let usePopupForm = false;
        try {
            usePopupForm = await isCardFormVisible(page);
        } catch { /* ignore */ }

        const targetPage = page;
        targetPage.setDefaultTimeout(timeout);
        let workingFrame = null;

        const getIframe = async () => {
            if (workingFrame) return workingFrame;
            if (usePopupForm) return targetPage;
            const valid = await isIframeValid(targetPage, 'iframe.apx-secure-iframe.pmts-portal-component');
            if (!valid) return targetPage;
            const el = await targetPage.$('iframe.apx-secure-iframe.pmts-portal-component');
            if (!el) return targetPage;
            const frame = await el.contentFrame();
            if (!frame) return targetPage;
            return frame;
        };

        // ── Step 3: Card number ────────────────────────────────────────
        try {
            console.log('Bước 3: nhập số thẻ...');
            const numberSelectors = [
                'input[data-testid="card-text-input"]',
                '#card-number-input input',
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
            console.log('   Đang chờ field số thẻ xuất hiện...');
            const fieldFound = await findFrameWithSelector(targetPage, numberSelectors, 15000);
            if (!fieldFound) {
                // Log available frames for debugging
                const frameUrls = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
                console.log(`   Không tìm thấy field số thẻ. Frames: ${frameUrls.map(u => u.slice(0, 80)).join(' | ')}`);
                throw new Error('CARD_NUMBER_FIELD_NOT_FOUND');
            }
            workingFrame = fieldFound.frame;
            console.log(`   Field số thẻ nằm trong frame: ${fieldFound.selector}`);

            const fill = await fillCardNumberAcrossFrames(targetPage, cardInfo.number, numberSelectors, 15000);
            if (!fill.ok) throw new Error('CARD_NUMBER_FIELD_NOT_FOUND');
            console.log(`Đã nhập số thẻ: ${fill.mode}`);
        } catch (err) {
            if (err.message.includes('detached Frame') || err.message.includes('Session closed'))
                return { success: false, error: 'FRAME_DETACHED', step: 'enter_card_number' };
            return { success: false, error: err.message, step: 'enter_card_number' };
        }

        await new Promise(r => setTimeout(r, 800));

        // ── Step 4: Cardholder name ────────────────────────────────────
        try {
            console.log('Bước 4: nhập tên chủ thẻ...');
            const ctx = await getIframe();

            // ✅ FIX 1: Use React-aware setter
            const nameSelectors = [
                'input[data-testid="input-text-input"]',
                '#account-holder-name-input input',
                'input[autocomplete="cc-name"]',
                'input[name="ppw-accountHolderName"]',
                'input[aria-label*="name" i]',
            ];
            let filled = false;
            for (const sel of nameSelectors) {
                try {
                    await typeLikeUser(targetPage, ctx, [sel], cardInfo.name, 'Cardholder name');
                    filled = true;
                    console.log(`Tên đã nhập theo kiểu người dùng: ${sel}`);
                    break;
                } catch { /* try next */ }
            }
            for (const sel of nameSelectors) {
                if (filled) break;
                try {
                    const ok = await setReactInputValue(ctx, sel, cardInfo.name);
                    if (ok) { filled = true; console.log(`Đã nhập tên: ${sel}`); break; }
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
                        console.log(`Đã nhập tên: ${sel}`);
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

        // ── Step 5 & 6: Expiry Date (Single MM/YY input or Month/Year Selects) ────────
        try {
            console.log('Bước 5: nhập hạn sử dụng thẻ...');
            const ctx = await getIframe();

            // Check if form has a single expiration date text input (e.g. data-testid="date-expiration-text-input")
            const singleExpSelectors = [
                'input[data-testid="date-expiration-text-input"]',
                '#expiration-date-input input',
                'input[autocomplete="cc-exp"]',
                'input[aria-label*="expiration" i]',
                'input[placeholder*="expiration" i]'
            ];

            const mm = String(cardInfo.month).padStart(2, '0');
            const yy = String(cardInfo.year).slice(-2);
            const digitsVal = `${mm}${yy}`;
            const expVal = `${mm}/${yy}`;

            let expSingleFilled = false;

            // Strategy A: type raw digits (0126) with digitsOnly true (masked input auto-formats to 01/26)
            for (const sel of singleExpSelectors) {
                try {
                    await typeLikeUser(targetPage, ctx, [sel], digitsVal, 'Expiration date (MM/YY)', { digitsOnly: true });
                    expSingleFilled = true;
                    console.log(`Hạn dùng (MM/YY) đã nhập theo kiểu người dùng (digits): ${sel}`);
                    break;
                } catch { /* try next */ }
            }

            // Strategy B: type formatted string (01/26)
            if (!expSingleFilled) {
                for (const sel of singleExpSelectors) {
                    try {
                        await typeLikeUser(targetPage, ctx, [sel], expVal, 'Expiration date (MM/YY)');
                        expSingleFilled = true;
                        console.log(`Hạn dùng (MM/YY) đã nhập theo kiểu người dùng: ${sel}`);
                        break;
                    } catch { /* try next */ }
                }
            }

            // Strategy C: React-aware setter with slash
            if (!expSingleFilled) {
                for (const sel of singleExpSelectors) {
                    try {
                        const ok = await setReactInputValue(ctx, sel, expVal);
                        if (ok) { expSingleFilled = true; console.log(`Hạn dùng (MM/YY) đã nhập bằng setter: ${sel}`); break; }
                    } catch { /* try next */ }
                }
            }

            // Strategy D: React-aware setter with digits
            if (!expSingleFilled) {
                for (const sel of singleExpSelectors) {
                    try {
                        const ok = await setReactInputValue(ctx, sel, digitsVal);
                        if (ok) { expSingleFilled = true; console.log(`Hạn dùng (MM/YY) đã nhập bằng setter (digits): ${sel}`); break; }
                    } catch { /* try next */ }
                }
            }

            if (!expSingleFilled) {
                // Legacy Month / Year selects
                console.log('Không thấy ô hạn dùng MM/YY, thử chọn Month/Year select...');
                const monthVal = String(cardInfo.month).trim();
                const monthSels = [
                    'select[name="ppw-expirationDate_month"]',
                    'select[name*="expirationDate_month"]',
                    'select[aria-label*="month" i]',
                ];
                let monthSelected = false;
                for (const sel of monthSels) {
                    try {
                        await selectLikeUser(ctx, [sel], monthVal, 'Expiration month');
                        monthSelected = true;
                        break;
                    } catch { /* try next */ }
                }
                if (!monthSelected) throw new Error('MONTH_NOT_SELECTED');
            }
        } catch (err) {
            if (err.message.includes('detached') || err.message === 'IFRAME_INVALID')
                return { success: false, error: 'FRAME_DETACHED', step: 'select_month' };
            return { success: false, error: err.message, step: 'select_month' };
        }

        await new Promise(r => setTimeout(r, 800));

        // ── Step 6: Expiry year ────────────────────────────────────────
        try {
            console.log('Bước 6: chọn năm hết hạn...');
            const ctx = await getIframe();
            const yearVal = String(cardInfo.year).trim();
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
                    console.log(`Năm đã chọn theo kiểu người dùng: ${sel}`);
                    break;
                } catch { /* try next */ }
            }

            if (!selected) {
                for (const sel of yearSels) {
                    try {
                        const ok = await setReactSelectValue(ctx, sel, yearVal);
                        if (ok) { selected = true; console.log(`Đã chọn năm bằng setter: ${sel}`); break; }
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
                        const link = links.find(l => l.textContent.trim() === target);
                        if (link) { link.click(); return true; }
                        return false;
                    }, yearVal);
                    if (selected) console.log('Đã chọn năm bằng dropdown popup');
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
                    console.log('Đã chọn năm bằng bàn phím');
                } catch { /* ignore */ }
            }

            if (!selected) throw new Error(`YEAR_NOT_SELECTED: ${yearVal}`);

            // CVV right after year (still in same iframe context)
            if (cardInfo.cvc) {
                const cvvRequired = await hasVisibleCvvField(targetPage);
                if (cvvRequired) {
                    const cvvFill = await fillCvvAcrossFrames(targetPage, cardInfo.cvc, 8000);
                    if (!cvvFill.ok) throw new Error('CVV_FIELD_NOT_FILLED');
                    console.log(`Đã nhập CVV: ${cvvFill.mode}`);
                } else {
                    console.log('Form này không có field CVV, bỏ qua nhập CVV');
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
            console.log('Bước 7: submit form thẻ...');

            const submitted = await clickFilledPaymentFormSubmit(targetPage, cardInfo);

            if (!submitted) {
                // If verifyFieldsBeforeSubmit found empty fields, try refilling inline
                console.log('Submit bị chặn - thử điền lại inline...');
                const ctx = usePopupForm ? targetPage : await getIframe().catch(() => targetPage);

                // Refill text fields with real keyboard events first.
                await typeLikeUser(targetPage, ctx, ['input[name="addCreditCardNumber"]'], cardInfo.number, 'Card number', { digitsOnly: true })
                    .catch(() => setReactInputValue(ctx, 'input[name="addCreditCardNumber"]', cardInfo.number).catch(() => { }));
                await typeLikeUser(targetPage, ctx, ['input[name="ppw-accountHolderName"]'], cardInfo.name, 'Cardholder name')
                    .catch(() => setReactInputValue(ctx, 'input[name="ppw-accountHolderName"]', cardInfo.name).catch(() => { }));
                await selectLikeUser(ctx, ['select[name="ppw-expirationDate_month"]'], String(Number(cardInfo.month)), 'Expiration month')
                    .catch(() => setReactSelectValue(ctx, 'select[name="ppw-expirationDate_month"]', String(Number(cardInfo.month))).catch(() => { }));
                await selectLikeUser(ctx, ['select[name="ppw-expirationDate_year"]'], String(cardInfo.year), 'Expiration year')
                    .catch(() => setReactSelectValue(ctx, 'select[name="ppw-expirationDate_year"]', String(cardInfo.year)).catch(() => { }));
                if (cardInfo.cvc) await fillCvvAcrossFrames(targetPage, cardInfo.cvc, 5000);

                await new Promise(r => setTimeout(r, 500));

                const retried = await clickFilledPaymentFormSubmit(targetPage, cardInfo);
                if (!retried) throw new Error('SUBMIT_BUTTON_NOT_FOUND_AFTER_REFILL');
            }

            console.log('Đã submit form');
        } catch (err) {
            if (err.message.includes('detached') || err.message === 'IFRAME_INVALID')
                return { success: false, error: 'FRAME_DETACHED', step: 'submit_card' };
            return { success: false, error: err.message, step: 'submit_card' };
        }

        await new Promise(r => setTimeout(r, 1000));

        // ── Step 8: Address confirmation + result wait ─────────────────
        console.log('Bước 8: chờ kết quả submit thẻ...');

        const result = await waitForCardSubmitResult(page, cardInfo.number.slice(-4), 30000, cardInfo);
        if (!result.success) {
            return {
                success: false,
                error: result.error,
                step: 'verify_card_submit',
                shouldRetry: retryCount < MAX_RETRIES - 1,
            };
        }

        // ── Step 9: Immediate reload & status check ──
        if (!shouldVerify) {
            return { success: true };
        }

        const checkAfterDelayMs = getCheckAfterDelayMs();
        console.log(`Chờ ${Math.max(Math.round(checkAfterDelayMs / 1000), 1)} giây trước khi reload...`);
        await new Promise(r => setTimeout(r, checkAfterDelayMs));

        console.log('Đang reload trang để xác minh trạng thái thẻ...');
        try {
            await safePageReload(page, 5000);
            // await new Promise(r => setTimeout(r, 2000));

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
                console.log(`Phát hiện URL ảnh của thẻ ***${last4}: ${imgUrl}`);
                const dieUrls = [
                    'https://m.media-amazon.com/images/I/41MGiaNMk5L._SL85_.png',
                    'https://m.media-amazon.com/images/I/81NBfFByidL._SL85_.png',
                    'https://m.media-amazon.com/images/G/01/payments-portal/r1/credit-card-image-blank._CB645132923_.png',
                    'https://m.media-amazon.com/images/G/09/payments-portal/r1/credit-card-image-blank._CB647740938_.png'
                ];
                if (dieUrls.includes(imgUrl)) {
                    console.log(`Thẻ ***${last4} là DIE (khớp ảnh bị hạn chế: ${imgUrl})`);
                    return { success: false, error: 'CARD_DIE', img: imgUrl };
                } else {
                    console.log(`Thẻ ***${last4} là LIVE (ảnh: ${imgUrl})`);
                    return { success: true, img: imgUrl };
                }
            } else {
                console.log(`Không tìm thấy thẻ ***${last4} trong ví sau khi reload`);
            }
        } catch (err) {
            console.log(`Lỗi khi kiểm tra trạng thái thẻ: ${err.message}`);
        }

        return { success: true };

    } catch (err) {
        console.error('Lỗi trong addCard:', err.message);

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

async function verifyCardsBatch(page, cardsBatch) {
    const checkAfterDelayMs = getCheckAfterDelayMs();
    console.log(`Chờ ${Math.max(Math.round(checkAfterDelayMs / 1000), 1)} giây trước khi reload để check batch...`);
    await new Promise(r => setTimeout(r, checkAfterDelayMs));

    console.log(`Đang reload trang để xác minh trạng thái của ${cardsBatch.length} thẻ...`);
    const results = {};
    try {
        await safePageReload(page, 15000);
        await page.waitForSelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical', { timeout: 15000 });

        const last4List = cardsBatch.map(c => c.number.slice(-4));
        const walletImages = await page.evaluate((last4s) => {
            const scroller = document.querySelector('.a-scroller.apx-wallet-desktop-payment-method-selectable-tab-css.a-scroller-vertical');
            if (!scroller) return {};
            const tabs = scroller.querySelectorAll('.apx-wallet-selectable-payment-method-tab');
            const map = {};
            for (const tab of tabs) {
                const text = tab.textContent || '';
                for (const last4 of last4s) {
                    if (text.includes(last4)) {
                        const img = tab.querySelector('img.apx-wallet-selectable-image') || tab.querySelector('img');
                        if (img) {
                            map[last4] = img.src;
                        }
                    }
                }
            }
            return map;
        }, last4List);

        const dieUrls = [
            'https://m.media-amazon.com/images/I/41MGiaNMk5L._SL85_.png',
            'https://m.media-amazon.com/images/I/81NBfFByidL._SL85_.png'
        ];

        for (const card of cardsBatch) {
            const last4 = card.number.slice(-4);
            const imgUrl = walletImages[last4];
            if (imgUrl) {
                console.log(`Phát hiện URL ảnh của thẻ ***${last4}: ${imgUrl}`);
                if (dieUrls.includes(imgUrl)) {
                    console.log(`Thẻ ***${last4} là DIE (khớp ảnh bị hạn chế: ${imgUrl})`);
                    results[card.number] = { success: false, error: 'CARD_DIE', img: imgUrl };
                } else {
                    console.log(`Thẻ ***${last4} là LIVE (ảnh: ${imgUrl})`);
                    results[card.number] = { success: true, img: imgUrl };
                }
            } else {
                console.log(`Không tìm thấy thẻ ***${last4} trong ví sau khi reload batch`);
                results[card.number] = { success: false, error: 'CARD_NOT_FOUND_IN_WALLET' };
            }
        }
    } catch (err) {
        console.log(`Lỗi khi kiểm tra trạng thái batch thẻ: ${err.message}`);
        for (const card of cardsBatch) {
            results[card.number] = { success: false, error: `VERIFY_ERROR: ${err.message}` };
        }
    }
    return results;
}

addCard.verifyCardsBatch = verifyCardsBatch;
module.exports = addCard;
