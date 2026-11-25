const puppeteer = require('puppeteer');
const path = require('path');
const timeout = 15000; // 15 seconds fast timeout to prevent hanging

// ✅ JAPAN (JP) FALLBACK ADDRESS DATA FOR AMAZON JAPAN
const JP_FALLBACK_ADDRESSES = [
    {
        fullName: "Saint David",
        postalCode: "100-0001",
        state: "東京都",
        stateEn: "Tokyo",
        city: "千代田区",
        buildingNo: "千代田1-1-1",
        phoneNumber: "08012345678",
        country: "JP"
    },
    {
        fullName: "Saint David",
        postalCode: "530-0001",
        state: "大阪府",
        stateEn: "Osaka",
        city: "大阪市北区",
        buildingNo: "梅田1-2-3",
        phoneNumber: "09087654321",
        country: "JP"
    },
    {
        fullName: "Saint David",
        postalCode: "460-0008",
        state: "愛知県",
        stateEn: "Aichi",
        city: "名古屋市中区",
        buildingNo: "栄2-3-4",
        phoneNumber: "07011223344",
        country: "JP"
    },
    {
        fullName: "Saint David",
        postalCode: "810-0001",
        state: "福岡県",
        stateEn: "Fukuoka",
        city: "福岡市中央区",
        buildingNo: "天神1-1-1",
        phoneNumber: "08055667788",
        country: "JP"
    },
    {
        fullName: "Saint David",
        postalCode: "060-0001",
        state: "北海道",
        stateEn: "Hokkaido",
        city: "札幌市中央区",
        buildingNo: "北1条西2-1",
        phoneNumber: "09044332211",
        country: "JP"
    }
];

async function gotoBook(page) {
    try {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('#glow-ingress-line2'),
            targetPage.locator('::-p-xpath(//*[@id=\\"glow-ingress-line2\\"])'),
            targetPage.locator(':scope >>> #glow-ingress-line2'),
            targetPage.locator('::-p-text(Update location)')
        ])
            .setTimeout(5000)
            .click({ offset: { x: 41, y: 11 } });
    } catch (_) {}

    try {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Manage address book)'),
            targetPage.locator('#GLUXManageAddressLink > a'),
            targetPage.locator('::-p-xpath(//*[@id=\\"GLUXManageAddressLink\\"]/a)'),
            targetPage.locator(':scope >>> #GLUXManageAddressLink > a'),
            targetPage.locator('::-p-text(Manage address)')
        ])
            .setTimeout(5000)
            .click({ offset: { x: 80, y: 5 } });
        
        await page.waitForNavigation({ timeout: 8000 }).catch(() => null);
    } catch (_) {}

    try {
        await page.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') resolve();
                else window.addEventListener('load', resolve, { once: true });
            });
        });
    } catch (_) {}
}

async function checkBook(page) {
    try {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('#ya-myab-display-address-block-0'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ya-myab-display-address-block-0\\"])'),
            targetPage.locator(':scope >>> #ya-myab-display-address-block-0')
        ])
            .setTimeout(1000)
            .click({ offset: { x: 126, y: 194 } });

        return true;
    } catch (_) {
        return false;
    }
}

function generateRandomJpAddress() {
    const randomIndex = Math.floor(Math.random() * JP_FALLBACK_ADDRESSES.length);
    const baseAddress = JP_FALLBACK_ADDRESSES[randomIndex];
    
    const randomBuildingNum = Math.floor(1 + Math.random() * 20);
    const randomChome = Math.floor(1 + Math.random() * 5);
    const randomBan = Math.floor(1 + Math.random() * 15);
    
    const prefixes = ['080', '090', '070'];
    const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const randomPhone = randomPrefix + String(Math.floor(10000000 + Math.random() * 90000000));

    return {
        fullName: baseAddress.fullName || "Saint David",
        postalCode: baseAddress.postalCode,
        state: baseAddress.state,
        stateEn: baseAddress.stateEn,
        city: baseAddress.city,
        buildingNo: `${baseAddress.city} ${randomChome}-${randomBan}-${randomBuildingNum}`,
        phoneNumber: randomPhone,
        country: "JP"
    };
}

async function getAddressData(maxRetries = 3) {
    console.log('Đang tạo dữ liệu địa chỉ Nhật Bản (JP)...');
    const jpAddress = generateRandomJpAddress();
    console.log('Đã tạo địa chỉ JP:', JSON.stringify(jpAddress, null, 2));
    return jpAddress;
}

async function addAddress(page, options = {}) {
    const apiRetries = Number.isInteger(options.apiRetries) ? options.apiRetries : 3;
    let addressData = await getAddressData(apiRetries);

    // Ensure we are on address form
    const alreadyOnAddressForm = await page.$('#address-ui-widgets-enterAddressPhoneNumber') || 
                                 await page.$('#address-ui-widgets-enterAddressLine1') ||
                                 await page.$('#address-ui-widgets-enterAddressPostalCode');
    if (!alreadyOnAddressForm) {
        try {
            await page.evaluate(() => {
                const btn = document.querySelector('#ya-myab-address-add-link') ||
                            document.querySelector('.first-desktop-address-tile') ||
                            document.querySelector('#ya-myab-plus-address-icon') ||
                            document.querySelector('.add-address-text');
                if (btn) btn.click();
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (_) {}
    }

    // ✅ KEEP COUNTRY AS JAPAN (JP) - DO NOT CHANGE TO US
    try {
        const countrySelector = await page.$('#address-ui-widgets-countryCode-dropdown-nativeId') ||
                                await page.$('select[name="address-ui-widgets-countryCode"]');
        if (countrySelector) {
            const currentCountry = await page.evaluate(el => el.value, countrySelector);
            console.log(`Quốc gia hiện tại trên form: ${currentCountry}`);
            if (currentCountry !== 'JP' && currentCountry !== 'JPN' && currentCountry !== 'Japan') {
                console.log('Đảm bảo quốc gia là Japan (JP)...');
                await page.select('#address-ui-widgets-countryCode-dropdown-nativeId', 'JP').catch(() =>
                    page.select('select[name="address-ui-widgets-countryCode"]', 'JP')
                );
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    } catch (countryErr) {
        console.log(`Kiểm tra quốc gia: ${countryErr.message}`);
    }

    // ✅ STEP 1: FILL FULL NAME (MANDATORY FIELD)
    const nameToFill = options.name || addressData.fullName || 'Saint David';
    try {
        const fullNameInput = await page.$('#address-ui-widgets-enterAddressFullName') ||
                              await page.$('input[name="address-ui-widgets-enterAddressFullName"]') ||
                              await page.$('input[autocomplete="name"]') ||
                              await page.$('input[id*="AddressFullName"]') ||
                              await page.$('input[aria-label*="Full name" i]') ||
                              await page.$('input[placeholder*="Full name" i]');
        if (fullNameInput) {
            await fullNameInput.click({ clickCount: 3 });
            await fullNameInput.type(nameToFill);
            console.log(`Đã nhập Họ tên: ${nameToFill}`);
        }
    } catch (nameErr) {
        console.log(`Lỗi khi nhập Họ tên: ${nameErr.message}`);
    }

    // ✅ STEP 2: FILL PHONE NUMBER (JP format: 080/090/070 xxxxxxxx)
    try {
        const phoneInput = await page.$('#address-ui-widgets-enterAddressPhoneNumber') ||
                           await page.$('input[name="address-ui-widgets-enterAddressPhoneNumber"]') ||
                           await page.$('input[autocomplete="tel"]') ||
                           await page.$('input[id*="AddressPhoneNumber"]') ||
                           await page.$('input[aria-label*="Phone number" i]') ||
                           await page.$('input[placeholder*="Phone number" i]');
        if (phoneInput) {
            await phoneInput.click({ clickCount: 3 });
            await phoneInput.type(addressData.phoneNumber);
            console.log(`Đã nhập số điện thoại JP: ${addressData.phoneNumber}`);
        }
    } catch (phoneErr) {
        console.log(`Lỗi khi nhập số điện thoại: ${phoneErr.message}`);
    }

    // ✅ STEP 3: FILL POSTAL CODE (JP format: 100-0001 or 1000001, handles single & 2-part inputs)
    try {
        const zip1 = await page.$('#address-ui-widgets-enterAddressPostalCodeOne');
        const zip2 = await page.$('#address-ui-widgets-enterAddressPostalCodeTwo');
        if (zip1 && zip2) {
            const cleanZip = String(addressData.postalCode || '100-0001').replace(/\D/g, '');
            const p1 = cleanZip.slice(0, 3) || '100';
            const p2 = cleanZip.slice(3) || '0001';
            await zip1.click({ clickCount: 3 });
            await zip1.type(p1);
            await zip2.click({ clickCount: 3 });
            await zip2.type(p2);
            console.log(`Đã nhập mã bưu điện 2 ô JP: ${p1}-${p2}`);
            await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
            const zipInput = await page.$('#address-ui-widgets-enterAddressPostalCode') ||
                             await page.$('input[name="address-ui-widgets-enterAddressPostalCode"]') ||
                             await page.$('input[autocomplete="postal-code"]') ||
                             await page.$('input[id*="AddressPostalCode"]') ||
                             await page.$('input[aria-label*="Zip" i]') ||
                             await page.$('input[placeholder*="Zip" i]');
            if (zipInput) {
                await zipInput.click({ clickCount: 3 });
                await zipInput.type(addressData.postalCode);
                console.log(`Đã nhập mã bưu điện JP: ${addressData.postalCode}`);
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
    } catch (zipErr) {
        console.log(`Lỗi khi nhập mã bưu điện: ${zipErr.message}`);
    }

    // ✅ STEP 4: FILL PREFECTURE / STATE (JP: 東京都, 大阪府, etc.)
    try {
        const stateSelect = await page.$('#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId') ||
                            await page.$('select[name="address-ui-widgets-enterAddressStateOrRegion"]') ||
                            await page.$('select[id*="AddressStateOrRegion"]');
        if (stateSelect) {
            const selected = await page.evaluate((stJp, stEn) => {
                const sel = document.querySelector('#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId') ||
                            document.querySelector('select[name="address-ui-widgets-enterAddressStateOrRegion"]') ||
                            document.querySelector('select[id*="AddressStateOrRegion"]');
                if (!sel) return false;
                const opts = Array.from(sel.options);
                const match = opts.find(o => o.text.includes(stJp) || o.value.includes(stJp) || o.text.includes(stEn) || o.value.includes(stEn));
                if (match) {
                    sel.value = match.value;
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                }
                return false;
            }, addressData.state, addressData.stateEn);

            if (!selected) {
                // Select Tokyo by default if not matched
                await page.select('#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId', '東京都').catch(() => null);
            }
            console.log(`Đã chọn Tỉnh/Thành JP: ${addressData.state}`);
        } else {
            const stateTextInput = await page.$('#address-ui-widgets-enterAddressStateOrRegion') ||
                                   await page.$('input[name="address-ui-widgets-enterAddressStateOrRegion"]') ||
                                   await page.$('input[id*="AddressStateOrRegion"]');
            if (stateTextInput) {
                await stateTextInput.click({ clickCount: 3 });
                await stateTextInput.type(addressData.state);
                console.log(`Đã nhập Tỉnh/Thành JP: ${addressData.state}`);
            }
        }
    } catch (stateErr) {
        console.log(`Lỗi khi chọn Tỉnh/Thành JP: ${stateErr.message}`);
    }

    // ✅ STEP 5: FILL CITY / WARD / TOWN AND ADDRESS LINE 1 & LINE 2
    try {
        const cityInput = await page.$('#address-ui-widgets-enterAddressCity') ||
                          await page.$('input[name="address-ui-widgets-enterAddressCity"]') ||
                          await page.$('input[id*="AddressCity"]') ||
                          await page.$('input[aria-label*="City" i]');
        if (cityInput) {
            await cityInput.click({ clickCount: 3 });
            await cityInput.type(addressData.city);
            console.log(`Đã nhập City/Ward/Town JP: ${addressData.city}`);
        }

        const addrInput = await page.$('#address-ui-widgets-enterAddressLine1') ||
                          await page.$('input[name="address-ui-widgets-enterAddressLine1"]') ||
                          await page.$('input[id*="AddressLine1"]') ||
                          await page.$('input[aria-label*="Address" i]');
        if (addrInput) {
            await addrInput.click({ clickCount: 3 });
            await addrInput.type(addressData.buildingNo);
            console.log(`Đã nhập Địa chỉ Line 1 JP: ${addressData.buildingNo}`);
        }
    } catch (addrErr) {
        console.log(`Lỗi khi nhập City/Địa chỉ: ${addrErr.message}`);
    }

    // ✅ STEP 6: OPTIONALLY CHECK "MAKE DEFAULT ADDRESS"
    try {
        const defaultCheckbox = await page.$('#address-ui-widgets-use-as-my-default') ||
                                 await page.$('input[name="address-ui-widgets-use-as-my-default"]');
        if (defaultCheckbox) {
            const isChecked = await page.evaluate(el => el.checked, defaultCheckbox);
            if (!isChecked) await defaultCheckbox.click();
        }
    } catch (_) {}

    // ✅ STEP 7: SUBMIT FORM WITH SAFE NAVIGATION (Supports AddAddressEvent & Use this address)
    try {
        const submitButton = await page.$('input[name="ppw-widgetEvent:AddAddressEvent"]') ||
                             await page.$('span.a-button-inner input[name="ppw-widgetEvent:AddAddressEvent"]') ||
                             await page.$('#address-ui-widgets-form-submit-button input.a-button-input') ||
                             await page.$('#address-ui-widgets-form-submit-button input') ||
                             await page.$('span#address-ui-widgets-form-submit-button') ||
                             await page.$('input[aria-labelledby*="submit"]') ||
                             await page.$('input[type="submit"]');

        if (submitButton) {
            console.log('Đang bấm nút Add Address (Use this address)...');
            await Promise.race([
                submitButton.click(),
                page.evaluate(el => el && el.click(), submitButton)
            ]).catch(() => null);
        } else {
            const clickedInDom = await page.evaluate(() => {
                const isVisible = el => {
                    if (!el) return false;
                    const s = window.getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0;
                };
                const targets = [...document.querySelectorAll('input[type="submit"], button, input[name="ppw-widgetEvent:AddAddressEvent"], .a-button-input')].filter(isVisible);
                for (const el of targets) {
                    const text = `${el.value || ''} ${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.name || ''}`.toLowerCase();
                    if (text.includes('use this address') || text.includes('addaddressevent') || text.includes('add address') || text.includes('save address') || text.includes('この住所を使用')) {
                        el.click();
                        return true;
                    }
                }
                if (targets.length > 0) {
                    targets[0].click();
                    return true;
                }
                return false;
            });
            console.log(clickedInDom ? 'Đã bấm nút submit địa chỉ trong DOM' : 'Không tìm thấy nút submit địa chỉ');
        }

        await Promise.race([
            page.waitForNavigation({ timeout: 12000 }).catch(() => null),
            new Promise(resolve => setTimeout(resolve, 3500))
        ]);
    } catch (submitErr) {
        console.log(`Lỗi khi bấm Submit địa chỉ: ${submitErr.message}`);
    }

    console.log('Đã hoàn tất tiến trình thêm địa chỉ Nhật Bản (JP)!');
}

module.exports = {
    gotoBook,
    checkBook,
    addAddress
};


