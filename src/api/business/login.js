const puppeteer = require('puppeteer');
const path = require('path');

async function login(page, { email, pass, code, proxy }) {
    console.log("Gọi hàm login business với email:", email, "và password:", pass);
    console.app("Gọi hàm login business với email:", email, "và password:", pass);

    const timeout = 30000; // 30 seconds timeout to fail fast on errors
    page.setDefaultTimeout(timeout);
    
    // Set navigation timeout separately
    page.setDefaultNavigationTimeout(30000); // 30 seconds navigation timeout

    if (proxy && proxy.username && proxy.password) {
        await page.authenticate({ username: proxy.username, password: proxy.password });
    }    {
        const targetPage = page;
        await targetPage.setViewport({
            width: 700,
            height: 700
        })
    }
    
    // Handle CAPTCHA if present
    if (global.data.parentAcc.geminiKey && global.data.parentAcc.geminiKey != "")
        await handleCapcha(page, timeout);
    
    {
        const targetPage = page;
        await targetPage.goto('https://www.amazon.com/business/register/org/landing?ref_=ab_reg_signinsignup'); 

        await new Promise(resolve => setTimeout(resolve, 300));
        await targetPage.reload({ waitUntil: 'domcontentloaded', timeout: 8000 });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Enter an email. Work email preferred.)'),
            targetPage.locator("[data-testid='businessEmail-test-id']"),
            targetPage.locator('::-p-xpath(//*[@data-testid=\\"businessEmail-test-id\\"])'),
            targetPage.locator(":scope >>> [data-testid='businessEmail-test-id']")
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 124.20000076293945,
                y: 11.800003051757812,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Enter an email. Work email preferred.)'),
            targetPage.locator("[data-testid='businessEmail-test-id']"),
            targetPage.locator('::-p-xpath(//*[@data-testid=\\"businessEmail-test-id\\"])'),
            targetPage.locator(":scope >>> [data-testid='businessEmail-test-id']")        ])
            .setTimeout(timeout)
            .fill(email);
    }
    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation({ timeout: 8000 }).catch(() => null));
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Get started)'),
            targetPage.locator("[data-testid='submit-email']"),
            targetPage.locator('::-p-xpath(//*[@data-testid=\\"submit-email\\"])'),
            targetPage.locator(":scope >>> [data-testid='submit-email']")
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 250.20000076293945,
                y: 16.79998779296875,
              },
            });
        await Promise.all(promises);
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Password)'),
            targetPage.locator('#ap_password'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ap_password\\"])'),
            targetPage.locator(':scope >>> #ap_password')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 154.19998168945312,
                y: 20,
              },
            });
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Password)'),
            targetPage.locator('#ap_password'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ap_password\\"])'),
            targetPage.locator(':scope >>> #ap_password')        ])
            .setTimeout(timeout)
            .fill(pass);
    }
    try {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation({ timeout: 8000 }).catch(() => null));
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Sign in)'),
            targetPage.locator('#signInSubmit'),
            targetPage.locator('::-p-xpath(//*[@id=\\"signInSubmit\\"])'),
            targetPage.locator(':scope >>> #signInSubmit')
        ])
            .setTimeout(2000)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 153.39999389648438,
                y: 13.199981689453125,
              },
            });
        await Promise.all(promises);
    } catch (_) {
        throw new Error("ACCOUNT_NOT_FOUND");
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Enter OTP:)'),
            targetPage.locator('#auth-mfa-otpcode'),
            targetPage.locator('::-p-xpath(//*[@id=\\"auth-mfa-otpcode\\"])'),
            targetPage.locator(':scope >>> #auth-mfa-otpcode')
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 242.1999969482422,
                y: 22.199996948242188,
              },
            });
    }    {
        const targetPage = page;
        // Generate 2FA token if code is provided
        let otpCode = '816598'; // Default fallback
        if (code) {
            try {
                let twofactor = require("node-2fa");
                otpCode = twofactor.generateToken(code).token;
                console.log("Đã tạo mã 2FA:", otpCode);
                console.app("Đã tạo mã 2FA:", otpCode);
            } catch (error) {
                console.log("Lỗi khi tạo mã 2FA, dùng mã được cung cấp:", code);
                console.app("Lỗi khi tạo mã 2FA, dùng mã được cung cấp:", code);
                otpCode = code;
            }
        }
        
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Enter OTP:)'),
            targetPage.locator('#auth-mfa-otpcode'),
            targetPage.locator('::-p-xpath(//*[@id=\\"auth-mfa-otpcode\\"])'),
            targetPage.locator(':scope >>> #auth-mfa-otpcode')
        ])
            .setTimeout(timeout)
            .fill(otpCode);
    }
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('#authportal-center-section div.a-spacing-medium span'),
            targetPage.locator('::-p-xpath(//*[@id=\\"auth-mfa-form\\"]/div/div/div[2]/div/label/span)'),
            targetPage.locator(':scope >>> #authportal-center-section div.a-spacing-medium span'),
            targetPage.locator("::-p-text(Don\\'t require)")
        ])
            .setTimeout(timeout)
            .click({
              offset: {
                x: 164.19998168945312,
                y: 5.199981689453125,
              },
            });
    }
    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation({ timeout: 8000 }).catch(() => null));
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Sign in)'),
            targetPage.locator('#auth-signin-button'),
            targetPage.locator('::-p-xpath(//*[@id=\\"auth-signin-button\\"])'),
            targetPage.locator(':scope >>> #auth-signin-button')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 159.39999389648438,
                y: 12.399993896484375,
              },
            });
        await Promise.all(promises);
    }
}

// CAPTCHA handling function (similar to api/login.js)
async function handleCapcha(page, timeout) {
    let captchaResolved = false;
    
    while (!captchaResolved) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        
        let captchaForm;
        try {
            captchaForm = await page.$('form[action="/errors/validateCaptcha"] img');
        } catch (_) { }
        
        if (!captchaForm) {
            console.log("Không phát hiện form CAPTCHA, tiếp tục...");
            captchaResolved = true;
            return;
        }
        
        console.log("Phát hiện CAPTCHA, đang thử giải...");
        const captchaSrc = await page.evaluate(() => {
            const captchaImage = document.querySelector('form[action="/errors/validateCaptcha"] img');
            return captchaImage ? captchaImage.src : null;
        });
        
        console.log("Nguồn ảnh CAPTCHA:", captchaSrc);
        const resCapcha = await require(path.join(__dirname, "..", "capcha.js"))(captchaSrc);
        
        if (!resCapcha || !resCapcha.success) {
            console.log("Giải CAPTCHA thất bại, thử lại...");
            console.app("Giải CAPTCHA thất bại, thử lại...");
            continue;
        }
        
        console.log("Kết quả CAPTCHA:", resCapcha);
        console.app("Kết quả CAPTCHA:", resCapcha.captchaCode);
        
        // Fill in the captcha field
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
        
        await puppeteer.Locator.race([
            page.locator('::-p-aria(Type characters)'),
            page.locator('#captchacharacters'),
            page.locator('::-p-xpath(//*[@id=\\"captchacharacters\\"])'),
            page.locator(':scope >>> #captchacharacters')
        ])
            .setTimeout(timeout)
            .fill(resCapcha.captchaCode);
        
        // Submit the captcha
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(
                page.waitForNavigation({ timeout: 8000 })
                    .catch(err => {
                        console.log("Chờ chuyển trang sau khi submit CAPTCHA bị timeout, vẫn tiếp tục");
                        console.app("Chờ chuyển trang sau khi submit CAPTCHA bị timeout, vẫn tiếp tục");
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
        
        // Check if captcha is still present after submission
        try {
            captchaForm = await page.$('form[action="/errors/validateCaptcha"] img');
            if (captchaForm) {
                console.log("CAPTCHA vẫn còn sau khi submit, thử lại...");
                console.app("CAPTCHA vẫn còn sau khi submit, thử lại...");
            } else {
                console.log("Đã vượt CAPTCHA thành công!");
                console.app("Đã vượt CAPTCHA thành công!");
                captchaResolved = true;
            }
        } catch (e) {
            console.log("Lỗi khi kiểm tra form CAPTCHA:", e);
            captchaResolved = true;
        }
    }
}

module.exports = login;
