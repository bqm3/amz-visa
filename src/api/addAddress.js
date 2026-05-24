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
    console.log('🏠 Attempting to get address data...');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📍 Attempt ${attempt}/${maxRetries} - Using API...`);
            
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
                console.log('📍 API Response:', JSON.stringify(address, null, 2));
                
                // Check if required fields exist and not undefined
                if (address && 
                    address.buildingNo && 
                    address.buildingNo !== 'undefined' && 
                    address.buildingNo.toString().trim() !== '') {
                    
                    console.log('✅ API address valid:', address.buildingNo);
                    return address;
                } else {
                    console.log('⚠️ API returned invalid buildingNo:', address?.buildingNo);
                }
            } else {
                console.log('⚠️ API returned empty or invalid data:', addressData);
            }
            
        } catch (apiError) {
            console.log(`❌ API attempt ${attempt} failed:`, apiError.message);
        }
        
        // Wait before next attempt
        if (attempt < maxRetries) {
            console.log('⏳ Waiting 2 seconds before next attempt...');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    // ✅ FALLBACK TO GENERATED ADDRESS
    console.log('🔄 API failed, using fallback address generator...');
    const fallbackAddress = generateRandomAddress();
    console.log('✅ Generated fallback address:', fallbackAddress.buildingNo);
    return fallbackAddress;
}

async function addAddress(page) {
    // ✅ SỬ DỤNG FUNCTION MỚI VỚI ERROR HANDLING
    let addressData = await getAddressData();
    
    console.log('🏠 Final address data:', JSON.stringify(addressData, null, 2));

    {
        const targetPage = page;
        const promises = [];
        const startWaitingForEvents = () => {
            promises.push(targetPage.waitForNavigation());
        }
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
        
        console.log('📱 Generated phone number:', phoneNumber);
        
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
    let checked = false;
    let addressRetries = 0;
    const maxAddressRetries = 5;

    while (!checked && addressRetries < maxAddressRetries) {
        addressRetries++;
        
        // ✅ ENSURE ADDRESS IS NOT UNDEFINED
        if (!addressData || !addressData.buildingNo || addressData.buildingNo === 'undefined') {
            console.log(`⚠️ Address undefined on retry ${addressRetries}, generating new one...`);
            addressData = await getAddressData();
        }
        
        const addressToUse = String(addressData.buildingNo).trim();
        console.log(`🏠 Attempt ${addressRetries}/${maxAddressRetries} - Using address:`, addressToUse);
        
        const targetPage = page;
        
        try {
            // Clear field first
            await targetPage.evaluate(() => {
                const field = document.querySelector('#address-ui-widgets-enterAddressLine1');
                if (field) {
                    field.value = '';
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                }
            });
            
            await puppeteer.Locator.race([
                targetPage.locator('::-p-aria(Address)'),
                targetPage.locator('#address-ui-widgets-enterAddressLine1'),
                targetPage.locator('::-p-xpath(//*[@id=\\"address-ui-widgets-enterAddressLine1\\"])'),
                targetPage.locator(':scope >>> #address-ui-widgets-enterAddressLine1')
            ])
                .setTimeout(timeout)
                .fill(addressToUse);

            // Wait for suggestions to appear
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Try to click suggestion
            try {    
                await puppeteer.Locator.race([
                    targetPage.locator('#awz-address-suggestion-0'),
                    targetPage.locator('::-p-xpath(//*[@id=\\"awz-address-suggestion-0\\"])'),
                    targetPage.locator(':scope >>> #awz-address-suggestion-0')
                ])
                    .setTimeout(3000)
                    .click({
                        offset: {
                            x: 328.7999954223633,
                            y: 13.600006103515625,
                        },
                    });
                
                console.log('✅ Address suggestion accepted:', addressToUse);
                checked = true;
            } catch (suggestionError) {
                console.log(`❌ Address suggestion failed for: ${addressToUse}`);
                console.log('Error:', suggestionError.message);
                
                // Generate new address for next attempt
                addressData = await getAddressData();
            }
        } catch (inputError) {
            console.log(`❌ Address input failed:`, inputError.message);
            addressData = await getAddressData();
        }
    }

    if (!checked) {
        throw new Error('Failed to add address after maximum retries');
    }

    // ✅ CONTINUE WITH REST OF THE PROCESS
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
    
    console.log('✅ Address added successfully!');
}

module.exports = {
    gotoBook,
    checkBook,
    addAddress
};