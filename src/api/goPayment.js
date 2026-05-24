const puppeteer = require('puppeteer'); // v23.0.0 or later

async function go(page) {
    const timeout = 30 * 60 * 1000;
    page.setDefaultTimeout(timeout);

    try {
        const targetPage = page;
        await targetPage.setViewport({
            width: 684,
            height: 684
        });
    } catch (error) {
        console.log("Error setting viewport:", error.message);
    }
    
    try {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('#nav-link-yourAccount > span.nav-line-1'),
            targetPage.locator('::-p-xpath(//*[@id=\\"nav-link-yourAccount\\"]/span[1])'),
            targetPage.locator(':scope >>> #nav-link-yourAccount > span.nav-line-1')
        ])
            .setTimeout(15000) // Reduced timeout
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 62.4375,
                    y: 1,
                },
            });
        await Promise.all(promises);
    } catch (error) {
        console.log("Error clicking Your Account, trying alternative navigation...");
        // Try direct URL navigation as fallback
        try {
            await page.goto('https://www.amazon.com/gp/css/homepage.html', { waitUntil: 'networkidle0' });
        } catch (navError) {
            return { error: 'Failed to navigate to Your Account page' };
        }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    {
        const targetPage = page;
        // await targetPage.waitForNavigation();
        const elementExists = await targetPage.$('[data-card-identifier="PrimeBusiness"]') !== null;
        if (!elementExists) {
            return {
                error: 'The account has not participated in Amazon Business!'
            };
        }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Your Payments)'),
            targetPage.locator('#link-view > div:nth-of-type(1) > div:nth-of-type(4) h2'),
            targetPage.locator('::-p-xpath(//*[@id=\\"link-view\\"]/div[1]/div[4]/a/article/div/div/h2)'),
            targetPage.locator(':scope >>> #link-view > div:nth-of-type(1) > div:nth-of-type(4) h2')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
              offset: {
                x: 129.79998779296875,
                y: 13.36248779296875,
              },
            });
        await Promise.all(promises);
    }
    return {};
}

module.exports = go;