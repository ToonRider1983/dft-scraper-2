import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

const stealth = stealthPlugin();
chromium.use(stealth);

// --- HELPER: RANDOM SLEEP ---
const randomSleep = (min, max) => {
    const sleepTime = Math.floor(Math.random() * (max - min + 1) + min);
    console.log(`😴 Sleeping for ${sleepTime}ms...`);
    return new Promise(resolve => setTimeout(resolve, sleepTime));
};

async function runScraper() {
    const targets = fs.readFileSync('targets.txt', 'utf-8').split('\n').filter(Boolean);

    // --- SET YOUR CREDENTIALS HERE ---
    const MY_EMAIL = 'freeman112002@hotmail.com'; 
    const MY_PASSWORD = 'Tritg0hk1';

    const userDataDir = './dataforthai_profile';

    console.log('🚀 Launching browser...');
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false, 
        viewport: { width: 1280, height: 800 },
        args: ['--disable-blink-features=AutomationControlled']
    });

    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(60000);

    try {
        // --- STEP 1: LOGIN PROCESS ---
        console.log('Checking login status...');
        await page.goto('https://www.dataforthai.com/login', { waitUntil: 'domcontentloaded' });

        // Detection check: If page title is "Access Denied"
        if (await page.title() === "Access Denied") {
            console.error('❌ IP Blocked by Cloudflare. Use a VPN or Proxy.');
            return;
        }

        const emailField = page.locator('input[name="email"]');
        if (await emailField.isVisible()) {
            console.log('Auto-filling credentials...');
            await emailField.fill(MY_EMAIL);
            await page.locator('input[name="password"]').fill(MY_PASSWORD);
            await page.click('button[type="submit"]');

            console.log('Waiting for manual Captcha solve or redirect...');
            await page.waitForURL('**/business**', { timeout: 0 }); 
            console.log('✅ Login Successful!');
        } else {
            console.log('✅ Already logged in via saved session.');
        }

        // --- STEP 2: SCRAPE LOOP ---
        for (let target of targets) {
            if (page.isClosed()) break;

            const id = target.trim();
            const url = `https://www.dataforthai.com/company/${id}/`;
            console.log(`\n🔍 Scraping: ${url}`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });

                // --- REFRESH PAGE ---
                console.log('Refreshing page...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                await randomSleep(1500, 3000);

                // --- TRIGGER REVEAL ---
                await page.evaluate(() => {
                    const btns = document.querySelectorAll('button[onclick*="show_contact_click"]');
                    btns.forEach(btn => btn.click());
                });

                // --- WAIT FOR PHONE PATTERN ---
                await page.waitForFunction(() => {
                    // Looks for any cell containing at least one digit after the button click
                    const tds = Array.from(document.querySelectorAll('td'));
                    const phoneTd = tds.find(td => td.innerText.trim() === 'โทร');
                    return phoneTd && phoneTd.nextElementSibling && /\d/.test(phoneTd.nextElementSibling.innerText);
                }, { timeout: 15000 }).catch(() => {});

                const companyData = await page.evaluate((currentId) => {
                    const allTds = Array.from(document.querySelectorAll('td'));

                    // NEW: Helper to extract ALL phone numbers found in the target cell
                    const getPhones = () => {
                        const targetLabel = allTds.find(td => td.innerText.trim() === 'โทร');
                        if (!targetLabel || !targetLabel.nextElementSibling) return "N/A";

                        const rawText = targetLabel.nextElementSibling.innerText;
                        // Regex to find multiple Thai phone formats: 02-xxx-xxxx, 08x-xxx-xxxx, 0-xxxx-xxxx
                        const phoneRegex = /(0-\d{4}-\d{4}|0\d-\d{4}-\d{4}|0\d{1}-\d{3}-\d{4}|02-\d{3}-\d{4})/g;
                        const matches = rawText.match(phoneRegex);

                        return matches ? matches.join(', ') : rawText.trim();
                    };

                    const getVal = (label) => {
                        const target = allTds.find(td => td.innerText.trim() === label);
                        return target ? target.nextElementSibling?.innerText.trim() : "N/A";
                    };

                    return {
                        id: currentId,
                        name: document.querySelector('h1')?.innerText.trim() || document.title,
                        phone: getPhones(), // Call the multi-phone extractor
                        address: document.querySelector('a[href*="maps/search"]')?.innerText.trim() || "N/A",
                        regId: getVal('ทะเบียน'),
                        status: getVal('สถานะ')
                    };
                }, id);

                console.log(`✨ Result: ${companyData.name}`);
                console.log(`📞 Phone(s): ${companyData.phone}`);

                fs.appendFileSync('marketing_leads.jsonl', JSON.stringify(companyData) + '\n');

            } catch (err) {
                console.error(`❌ Error on ${url}: ${err.message}`);
            }

            // --- RANDOM DELAY BETWEEN TARGETS ---
            await randomSleep(4000, 9000);
        }

    } catch (fatalError) {
        console.error('💥 Fatal error:', fatalError);
    } finally {
        console.log('\n🏁 Process finished.');
        await context.close();
    }
}

runScraper();