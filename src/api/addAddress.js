const puppeteer = require('puppeteer');
const path = require('path');
const timeout = 30 * 60 * 1000;

// ✅ THÊM FALLBACK ADDRESS DATA
const FALLBACK_ADDRESSES = [
    {
        buildingNo: "123 Main Street",
        street: "Main Street",
        city: "New York",
        state: "NY",
        zipCode: "10001",
        country: "USA"
    },
    {
        buildingNo: "456 Oak Avenue",
        street: "Oak Avenue", 
        city: "Los Angeles",
        state: "CA",
        zipCode: "90210",
        country: "USA"
    },
    {
        buildingNo: "789 Pine Road",
        street: "Pine Road",
        city: "Chicago", 
        state: "IL",
        zipCode: "60601",
        country: "USA"
    },
    {
        buildingNo: "321 Elm Street",
        street: "Elm Street",
        city: "Houston",
        state: "TX", 
        zipCode: "77001",
        country: "USA"
    },
    {
        buildingNo: "654 Maple Drive",
        street: "Maple Drive",
        city: "Phoenix",
        state: "AZ",
        zipCode: "85001",
        country: "USA"
    }
];

async function gotoBook(page) {
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('#glow-ingress-line2'),
            targetPage.locator('::-p-xpath(//*[@id=\\"glow-ingress-line2\\"])'),
            targetPage.locator(':scope >>> #glow-ingress-line2'),
            targetPage.locator('::-p-text(Update location)')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 41,
                    y: 11,
                },
            });
    }
    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Manage address book)'),
            targetPage.locator('#GLUXManageAddressLink > a'),
            targetPage.locator('::-p-xpath(//*[@id=\\"GLUXManageAddressLink\\"]/a)'),
            targetPage.locator(':scope >>> #GLUXManageAddressLink > a'),
            targetPage.locator('::-p-text(Manage address)')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 81.69999694824219,
                    y: 4.699981689453125,
                },
            });
        await Promise.all(promises);
    }

    {
        const targetPage = page;
        // Wait the page to load done
        await targetPage.evaluate(() => {
            return new Promise((resolve) => {
                if (document.readyState === 'complete') {
                    resolve();
                } else {
                    window.addEventListener('load', resolve);
                }
            });
        });
    }
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
            .click({
                offset: {
                    x: 126,
                    y: 194,
                },
            });

        return true;
    } catch (_) {
        return false;
    }
}

// ✅ THÊM FUNCTION GENERATE RANDOM ADDRESS AN TOÀN
function generateRandomAddress() {
    const randomIndex = Math.floor(Math.random() * FALLBACK_ADDRESSES.length);
    const baseAddress = FALLBACK_ADDRESSES[randomIndex];
    
    // Tạo biến thể để tránh trùng lặp
    const buildingNumber = Math.floor(100 + Math.random() * 9000); // 100-9999
    const streetVariants = ['Street', 'Avenue', 'Drive', 'Lane', 'Road', 'Boulevard', 'Way'];
    const streetNames = ['Main', 'Oak', 'Pine', 'Maple', 'Cedar', 'Elm', 'Park', 'First', 'Second', 'Third'];
    
    const randomStreet = streetNames[Math.floor(Math.random() * streetNames.length)];
    const randomVariant = streetVariants[Math.floor(Math.random() * streetVariants.length)];
    
    return {
        buildingNo: `${buildingNumber} ${randomStreet} ${randomVariant}`,
        street: `${randomStreet} ${randomVariant}`,
        city: baseAddress.city,
        state: baseAddress.state, 
        zipCode: baseAddress.zipCode,
        country: baseAddress.country
    };
}

// ✅ FUNCTION GET ADDRESS VỚI ERROR HANDLING
async function getAddressData(maxRetries = 3) {
    console.log('Đang lấy dữ liệu địa chỉ...');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Lần ${attempt}/${maxRetries} - gọi API địa chỉ...`);
            
            // ✅ TRY API FIRST
            const { getAddress } = await import('random-addresses-generator');
            const addressData = await getAddress(1, {
                country: 'USA',
                addressType: 'Resedential', 
                format: 'json'
            });

            // ✅ VALIDATE API RESPONSE
            if (Array.isArray(addressData) && addressData.length > 0) {
                const address = addressData[0];
                console.log('Phản hồi API địa chỉ:', JSON.stringify(address, null, 2));
                
                // Check if required fields exist and not undefined
                if (address && 
                    address.buildingNo && 
                    address.buildingNo !== 'undefined' && 
                    address.buildingNo.toString().trim() !== '') {
                    
                    console.log('Địa chỉ từ API hợp lệ:', address.buildingNo);
                    return address;
                } else {
                    console.log('API trả về buildingNo không hợp lệ:', address?.buildingNo);
                }
            } else {
                console.log('API trả về dữ liệu rỗng hoặc không hợp lệ:', addressData);
            }
            
        } catch (apiError) {
            console.log(`Lần gọi API ${attempt} thất bại:`, apiError.message);
        }
        
        // Wait before next attempt
        if (attempt < maxRetries) {
            console.log('Chờ 2 giây trước khi thử lại...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    // ✅ FALLBACK TO GENERATED ADDRESS
    console.log('API lỗi, dùng bộ tạo địa chỉ dự phòng...');
    const fallbackAddress = generateRandomAddress();
    console.log('Đã tạo địa chỉ dự phòng:', fallbackAddress.buildingNo);
    return fallbackAddress;
}

async function addAddress(page, options = {}) {
    // ✅ SỬ DỤNG FUNCTION MỚI VỚI ERROR HANDLING
    const apiRetries = Number.isInteger(options.apiRetries) ? options.apiRetries : 3;
    let addressData = await getAddressData(apiRetries);
    
    console.log('Dữ liệu địa chỉ cuối cùng:', JSON.stringify(addressData, null, 2));

    const alreadyOnAddressForm = await page.$('#address-ui-widgets-enterAddressPhoneNumber');
    if (!alreadyOnAddressForm) {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        };
        await puppeteer.Locator.race([
            targetPage.locator('div.a-color-tertiary'),
            targetPage.locator('::-p-xpath(//*[@id=\\"ya-myab-address-add-link\\"]/div/div/div[2])'),
            targetPage.locator(':scope >>> div.a-color-tertiary'),
            targetPage.locator('::-p-text(Add Address)')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 121.39999961853027,
                    y: 14.199981689453125,
                },
            });
        await Promise.all(promises);
    }

    // ✅ PHONE NUMBER GENERATION
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Phone number)'),
            targetPage.locator('#address-ui-widgets-enterAddressPhoneNumber'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressPhoneNumber\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-enterAddressPhoneNumber')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 43.599998474121094,
                    y: 13.399993896484375,
                },
            });
    }
    {
        const targetPage = page;
        // ✅ GENERATE REALISTIC PHONE NUMBER
        const phoneNumber = '541' + // Oregon area code
            String(Math.floor(200 + Math.random() * 800)) +
            String(Math.floor(1000 + Math.random() * 9000));
        
        console.log('Đã tạo số điện thoại:', phoneNumber);
        
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Phone number)'),
            targetPage.locator('#address-ui-widgets-enterAddressPhoneNumber'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressPhoneNumber\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-enterAddressPhoneNumber')
        ])
            .setTimeout(timeout)
            .fill(phoneNumber);
    }

    // ✅ ADDRESS INPUT WITH VALIDATION
    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Address)'),
            targetPage.locator('#address-ui-widgets-enterAddressLine1'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressLine1\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-enterAddressLine1')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 197.5999984741211,
                    y: 12.399993896484375,
                },
            });
    }

    // ✅ ADDRESS VALIDATION LOOP VỚI RETRY LOGIC
    let addressRetries = 0;
    const maxAddressRetries = 3;
    let filled = false;

    const stateMap = {
        alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
        connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
        illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
        maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
        missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
        'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
        'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
        'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
        texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
        'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC'
    };

    while (!filled && addressRetries < maxAddressRetries) {
        addressRetries++;
        if (!addressData || !addressData.buildingNo) {
            addressData = await getAddressData(apiRetries);
        }

        const addressToUse = String(addressData.buildingNo || '').trim();
        const cityToUse = String(addressData.city || '').trim();
        const zipToUse = String(addressData.zipCode || '').trim();
        let stateToUse = String(addressData.state || '').trim();
        const normalizedState = stateToUse.toLowerCase();
        if (stateToUse.length !== 2 && stateMap[normalizedState]) {
            stateToUse = stateMap[normalizedState];
        } else {
            stateToUse = stateToUse.toUpperCase();
        }

        console.log(`Lần ${addressRetries}/${maxAddressRetries} - dùng địa chỉ: ${addressToUse}`);

        try {
            await page.waitForSelector('#address-ui-widgets-enterAddressLine1', { timeout: 10000 });
            await page.locator('#address-ui-widgets-enterAddressLine1').fill(addressToUse);
            await page.locator('#address-ui-widgets-enterAddressCity').fill(cityToUse);
            await page.select('#address-ui-widgets-enterAddressStateOrRegion-dropdown-nativeId', stateToUse);
            await page.locator('#address-ui-widgets-enterAddressPostalCode').fill(zipToUse);
            filled = true;
        } catch (inputError) {
            console.log(`Nhập địa chỉ thất bại: ${inputError.message}`);
            addressData = await getAddressData(apiRetries);
        }
    }

    if (!filled) {
        throw new Error('Failed to fill address fields');
    }

    {
        const targetPage = page;
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Make this my default address)'),
            targetPage.locator('#address-ui-widgets-use-as-my-default'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-use-as-my-default\\"])'),
            targetPage.locator(':scope >>> #address-ui-widgets-use-as-my-default')
        ])
            .setTimeout(timeout)
            .click({
                offset: {
                    x: 4.599998474121094,
                    y: 7.79998779296875,
                },
            });
    }
    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
        await puppeteer.Locator.race([
            targetPage.locator('::-p-aria(Add address)'),
            targetPage.locator('#address-ui-widgets-form-submit-button input.a-button-input'),
            targetPage.locator('span:nth-of-type(3) input'),
            targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-form-submit-button\\"]/span/input)'),
            targetPage.locator(':scope >>> span:nth-of-type(3) input')
        ])
            .setTimeout(timeout)
            .on('action', () => startWaitingForEvents())
            .click({
                offset: {
                    x: 55.79999542236328,
                    y: 7,
                },
            });
        await Promise.all(promises);
    }
    
    console.log('Đã thêm địa chỉ thành công!');
}

module.exports = {
    gotoBook,
    checkBook,
    addAddress
};
