const puppeteer = require('puppeteer');
const path = require('path');
const { type } = require('os');
const timeout = 30 * 60 * 1000;


async function continueLogin(page) {
  {
    const targetPage = page;
    const promises = [];
    const startWaitingForEvents = () => {
      promises.push(targetPage.waitForNavigation());
    }
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Yes, use current email) >>>> ::-p-aria([role=\\"generic\\"])'),
      targetPage.locator('#create-account-form span'),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"Primary.REGISTRATION_START_CREATE_ACCOUNT.create_shuma_account\\"]/span)'),
      targetPage.locator(':scope >>> #create-account-form span'),
      targetPage.locator('::-p-text(Yes, use current)')
    ])
      .setTimeout(timeout)
      .on('action', () => startWaitingForEvents())
      .click({
        offset: {
          x: 83.0374984741211,
          y: 8.98748779296875,
        },
      });

    await Promise.all(promises);
  }
}

async function fillInfo(page) {
  // const { getAddress } = await import("random-addresses-generator");

  // const addressData = await getAddress(1, {
  //   country: 'USA',
  //   states: ['AL'],
  //   addressType: 'Resedential',
  //   format: 'json'
  // });

  {
    const targetPage = page;
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Business phone)'),
      targetPage.locator("[data-testid='voice-test-id']"),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"voice-test-id\\"])'),
      targetPage.locator(":scope >>> [data-testid='voice-test-id']")
    ])
      .setTimeout(timeout)
      .click({
        offset: {
          x: 34.09999084472656,
          y: 17.837493896484375,
        },
      });
  }
  {
    const targetPage = page;
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Business phone)'),
      targetPage.locator("[data-testid='voice-test-id']"),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"voice-test-id\\"])'),
      targetPage.locator(":scope >>> [data-testid='voice-test-id']")
    ])
      .setTimeout(timeout)
      //.fill(addressData.phone.replace(/[\+1\(\)\s-]/g, ''));
      .fill(String(541) +
        String(Math.floor(200 + Math.random() * 800)) +
        String(Math.floor(1000 + Math.random() * 9000)))
  }
  {
    const targetPage = page;
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Business name)'),
      targetPage.locator("[data-testid='businessName-test-id']"),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"businessName-test-id\\"])'),
      targetPage.locator(":scope >>> [data-testid='businessName-test-id']")
    ])
      .setTimeout(timeout)
      .click({
        offset: {
          x: 106.09999084472656,
          y: 26.98748779296875,
        },
      });
  }
  {
    const targetPage = page;
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Business name)'),
      targetPage.locator("[data-testid='businessName-test-id']"),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"businessName-test-id\\"])'),
      targetPage.locator(":scope >>> [data-testid='businessName-test-id']")
    ])
      .setTimeout(timeout)
      .fill("Business Name " + String(Math.floor(1000 + Math.random() * 9000)));
  }
  {
    const targetPage = page;
    await puppeteer.Locator.race([
      targetPage.locator('div:nth-of-type(2) > label'),
      targetPage.locator('::-p-xpath(//*[@id=\\"businessInfoFormId\\"]/fieldset[4]/div[2]/label)'),
      targetPage.locator(':scope >>> div:nth-of-type(2) > label')
    ])
      .setTimeout(timeout)
      .click({
        offset: {
          x: 9.099990844726562,
          y: 13.98748779296875,
        },
      });
  }

  try {
    const targetPage = page;
    await puppeteer.Locator.race([
      targetPage.locator('span:nth-of-type(2) span'),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"select-address_label\\"]/span)'),
      targetPage.locator(':scope >>> span:nth-of-type(2) span')
    ])
      .setTimeout(2000)
      .click({
        offset: {
          x: 162.5,
          y: 9.137481689453125,
        },
      });

    await puppeteer.Locator.race([
      targetPage.locator('.b-clickable.b-text-carbon.b-text-truncate.b-ph-small'),
      targetPage.locator('::-p-xpath(//*[contains(@class, "b-clickable") and contains(@class, "b-text-carbon") and contains(@class, "b-text-truncate") and contains(@class, "b-ph-small")])'),
      targetPage.locator(':scope >>> .b-clickable.b-text-carbon.b-text-truncate.b-ph-small')
    ])
      .setTimeout(timeout)
      .click({
        offset: {
          x: 51.30000305175781,
          y: 2.337493896484375,
        },
      });

    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Create business account) >>>> ::-p-aria([role=\\"generic\\"])'),
      targetPage.locator('#businessInfoFormId > span span'),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"business-info-page-submit\\"]/span)'),
      targetPage.locator(':scope >>> #businessInfoFormId > span span'),
      targetPage.locator('::-p-text(Create business)')
    ])
      .setTimeout(timeout)
      .click({
        offset: {
          x: 67.33749389648438,
          y: 0.73748779296875,
        },
      });
  }

  // Wait for the address input to be available
  catch (_) {
    const targetPage = page;
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Street address)'),
      targetPage.locator('#address1-field-id'),
      targetPage.locator('::-p-xpath(//*[@id=\\"address1-field-id\\"])'),
      targetPage.locator(':scope >>> #address1-field-id')
    ])
      .setTimeout(timeout)
      .click({
        offset: {
          x: 147.09999084472656,
          y: 20.25,
        },
      });

    const { getAddress } = await import('random-addresses-generator');

    let check = false;
    while (!check) {
      const addressData = JSON.parse(await getAddress(1, {
        country: 'USA',
        addressType: 'Resedential',
        format: 'json'
      }));
      const address = addressData[0];

      if (!address ||
        !address.buildingNo ||
        address.buildingNo + '' == 'undefined' ||
        address.buildingNo.toString().trim() == '') {
        check = false;
        continue;
      }
      try {
        const targetPage = page;
        await puppeteer.Locator.race([
          targetPage.locator('::-p-aria(Street address)'),
          targetPage.locator('#address1-field-id'),
          targetPage.locator('::-p-xpath(//*[@id=\\"address1-field-id\\"])'),
          targetPage.locator(':scope >>> #address1-field-id')
        ])
          .setTimeout(timeout)
          .fill(address.buildingNo.toString().trim());

        await new Promise(resolve => setTimeout(resolve, 3000));
        await puppeteer.Locator.race([
          targetPage.locator('div.ABRegistrationLayout-module__body_gf4hxEXnQudT3paoXKE5 li:nth-of-type(1) > span'),
          targetPage.locator('::-p-xpath(//*[@data-testid=\\"address1-field-id\\"]/div/fieldset/button[2]/div/ul/li[1]/span)'),
          targetPage.locator(':scope >>> div.ABRegistrationLayout-module__body_gf4hxEXnQudT3paoXKE5 li:nth-of-type(1) > span')
        ])
          .setTimeout(3000)
          .click({
            offset: {
              x: 107.30000305175781,
              y: 9.449981689453125,
            },
          });
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (_) {
        continue;
      }
      check = true;
    }

    {
      const targetPage = page;
      await puppeteer.Locator.race([
        targetPage.locator('::-p-aria(Street address)'),
        targetPage.locator('#address1-field-id'),
        targetPage.locator('::-p-xpath(//*[@id=\\"address1-field-id\\"])'),
        targetPage.locator(':scope >>> #address1-field-id')
      ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 147.09999084472656,
            y: 20.25,
          },
        });
      await targetPage.keyboard.down('T');
      await targetPage.keyboard.up('T');
      await targetPage.keyboard.down('Backspace');
      await targetPage.keyboard.up('Backspace');
    }

    const promises = [];
    const startWaitingForEvents = () => {
      promises.push(targetPage.waitForNavigation());
    }
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Create business account) >>>> ::-p-aria([role=\\"generic\\"])'),
      targetPage.locator('span span'),
      targetPage.locator('::-p-xpath(//*[@data-testid=\\"business-info-page-submit\\"]/span)'),
      targetPage.locator(':scope >>> span span'),
      targetPage.locator('::-p-text(Create business)')
    ])
      .setTimeout(timeout)
      .on('action', () => startWaitingForEvents())
      .click({
        offset: {
          x: 12.337493896484375,
          y: 10.25,
        },
      });
    await Promise.all(promises);
  }
}

async function finalSetup(page) {
  {
    const targetPage = page;
    const promises = [];
    const startWaitingForEvents = () => {
      promises.push(targetPage.waitForNavigation());
    }
    await puppeteer.Locator.race([
      targetPage.locator('::-p-aria(Skip this step) >>>> ::-p-aria([role=\\"generic\\"])'),
      targetPage.locator('p.b-text-center span'),
      targetPage.locator('::-p-xpath(//*[@id=\\"skip-optional-inputs-link\\"]/span)'),
      targetPage.locator(':scope >>> p.b-text-center span'),
      targetPage.locator('::-p-text(Skip this step)')
    ])
      .setTimeout(timeout)
      .on('action', () => startWaitingForEvents())
      .click({
        offset: {
          x: 52.100006103515625,
          y: 13.625,
        },
      });
    await Promise.all(promises);
  }

  let check = false;
  while (!check) {
    console.log('Waiting for the skip upsell button to appear...');
    try {
      const targetPage = page;
      const promises = [];
      const startWaitingForEvents = () => {
        const navigationPromise = targetPage.waitForNavigation({ timeout: 5000 }).catch(err => {});
        promises.push(navigationPromise);
      }
      try {
        await puppeteer.Locator.race([
          targetPage.locator('::-p-aria(Skip this step) >>>> ::-p-aria([role=\\"generic\\"])'),
          targetPage.locator('p span'),
          targetPage.locator('::-p-xpath(//*[@id=\\"skip-data-copy\\"]/span)'),
          targetPage.locator(':scope >>> p span'),
          targetPage.locator('::-p-text(Skip this step)')
        ])
          .setTimeout(5000)
          .on('action', () => startWaitingForEvents())
          .click({
            offset: {
              x: 52.100006103515625,
              y: 14.23748779296875,
            },
          });
        await Promise.all(promises);
      } catch (_) { }

      let frame = targetPage.mainFrame();
      frame = frame.childFrames()[0];

      await puppeteer.Locator.race([
        frame.locator('::-p-aria(No, thanks)'),
        frame.locator('#skip-upsell input'),
        frame.locator('::-p-xpath(//*[@id=\\"a-autoid-1\\"]/span/input)'),
        frame.locator(':scope >>> #skip-upsell input')
      ])
        .setTimeout(5000)
        .on('action', () => startWaitingForEvents())
        .click({
          offset: {
            x: 35.350006103515625,
            y: 5.824951171875,
          },
        });
    } catch (_) {
      continue;
    }
    check = true;
  }

  console.log('Skip upsell button clicked, waiting for the next page...');
  console.log('Final setup completed.');
}
module.exports = {
  continueLogin,
  fillInfo,
  finalSetup
};