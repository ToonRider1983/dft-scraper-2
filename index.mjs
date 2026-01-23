// scraper.js
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import xlsx from 'xlsx'
import dotenv from "dotenv";
import guid from 'js-guid'

dotenv.config();

// Add stealth plugin
chromium.use(stealth());

// ===== CONFIGURATION =====
const LOGIN_URL = process.env.LOGIN_URL || "https://www.dataforthai.com/member/login";
const BASE_URL = process.env.BASE_URL || "https://www.dataforthai.com/company/";

// YOUR CREDENTIALS HERE
const USERNAME = "freeman112002@hotmail.com";
const PASSWORD = "Tritg0hk1"

const START_PAGE = 1;
const END_PAGE = 3;

// ===== SETUP =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForCloudflare(page, timeout = 60000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const content = await page.content();
    if (
      !content.includes('Verify you are human') &&
      !content.includes('Just a moment') &&
      !content.includes('Checking your browser')
    ) {
      return true;
    }
    console.log("⏳ Waiting for Cloudflare...");
    await sleep(6000);
  }
  return false;
}


// ===== LOGIN FUNCTION =====
async function login(page) {
  console.log("Navigating to login page...");

  try {
    await page.goto(LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 10000
    });

    console.log("Waiting for Cloudflare...");
    await sleep(10000); // Wait for Cloudflare to complete

    // Check if still on challenge
    let pageContent = await page.content();
    if (pageContent.includes('Verify you are human') || pageContent.includes('Just a moment') || pageContent.includes('Checking your browser')) {
      console.log("⚠️ Cloudflare challenge detected.");
      console.log("👉 Please solve the CAPTCHA manually in the browser window.");
      console.log("⏳ Waiting 60 seconds for you to complete it...");

      await sleep(60000);

      pageContent = await page.content();
      if (pageContent.includes('Verify you are human')) {
        console.log("❌ Still blocked. Please try again.");
        return false;
      }
    }

    console.log("✅ Cloudflare passed! Looking for login form...");
    await sleep(3000);

    // Take screenshot
    await page.screenshot({ path: path.join(__dirname, 'login_page.png'), fullPage: true });
    console.log("📸 Login page screenshot saved");

    // Find and fill email
    const emailInput = await page.waitForSelector('input[type="email"], input[name="email"], input[type="text"]', { timeout: 5000 });
    await emailInput.click();
    await emailInput.fill(USERNAME);
    console.log("✅ Email filled");

    // Find and fill password
    const passwordInput = await page.waitForSelector('input[type="password"], input[name="password"]', { timeout: 5000 });
    await passwordInput.click();
    await passwordInput.fill(PASSWORD);
    console.log("✅ Password filled");

    await sleep(1000);

    // Find and click submit
    // const submitButton = await page.waitForSelector('button[type="submit"], input[type="submit"]', { timeout: 10000 });
    const submitButton = await page.waitForSelector('#btn-login', { timeout: 10000 });
    console.log("Clicking submit...");

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => { }),
      submitButton.click(),
    ]);

    await sleep(5000);

    // Take screenshot after login
    // await page.screenshot({ path: path.join(__dirname, 'after_login.png'), fullPage: true });
    // console.log("📸 After login screenshot saved");

    // Verify login
    const content = await page.content();
    if (content.includes(USERNAME) || content.includes(" ออกจากระบบ") || content.includes("logout")) {
      console.log("✅ Login successful!");
      return true;
    } else {
      console.log("⚠️ Login verification unclear. Check screenshot.");
      return true; // Proceed anyway
    }

  } catch (error) {
    console.error("Login error:", error.message);
    await page.screenshot({ path: path.join(__dirname, 'login_error.png'), fullPage: true });
    return false;
  }
}

// ===== SCRAPING FUNCTION =====
async function scrapeCompanies(page) {
  const allCompanies = [];

  for (let pageNum = START_PAGE; pageNum <= END_PAGE; pageNum++) {
    const url = pageNum === 1 ? BASE_URL : `${BASE_URL}?page=${pageNum}`;

    console.log("\n" + "=".repeat(60));
    console.log(`Fetching page ${pageNum}: ${url}`);

    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90000
      });

      console.log("Waiting for Cloudflare and page to load...");
      await sleep(8000);

      // Check for Cloudflare
      let pageContent = await page.content();
      if (pageContent.includes('Verify you are human') || pageContent.includes('Just a moment')) {
        console.log("⚠️ Cloudflare on this page. Waiting...");
        await sleep(20000);
      }

      // Wait for table
      try {
        await page.waitForSelector('table tbody tr, .clickable-row', { timeout: 15000 });
        console.log("✅ Table loaded");
      } catch (e) {
        console.log("⚠️ Table not found, proceeding anyway");
      }

      await sleep(3000);

      // Extract data
      const companies = await page.evaluate((currentPage) => {
        const results = [];
        const rows = document.querySelectorAll('.clickable-row, table tbody tr, tbody tr');

        console.log(`Found ${rows.length} rows`);

        rows.forEach((row, index) => {
          const cells = row.querySelectorAll('td');

          if (cells.length >= 3) {
            const cellTexts = Array.from(cells).map(c => c.innerText?.trim() || '');

            // Skip header rows or empty rows
            if (cellTexts[0] && !cellTexts[0].includes('ชื่อ') && cellTexts[0].length > 3) {
              const company = {
                rowIndex: index + 1,
                name: cellTexts[0] || '',
                registrationNumber: cellTexts[1] || '',
                capital: cellTexts[2] || '',
                location: cellTexts[3] || '',
                status: cellTexts[4] || '',
                year: cellTexts[5] || '',
                page: currentPage,
                allCells: cellTexts,
              };

              const link = row.getAttribute('data-href') || row.querySelector('a')?.href;
              if (link) {
                company.url = link.startsWith('http') ? link : `https://www.dataforthai.com${link}`;
              }

              if (company.name.length > 0) {
                results.push(company);
              }
            }
          }
        });

        return results;
      }, pageNum);

      console.log(`Extracted ${companies.length} companies from page ${pageNum}`);

      if (companies.length > 0) {
        companies.slice(0, 3).forEach((c, i) => {
          console.log(`  [${i + 1}] ${c.name} - ${c.capital}`);
        });
      } else {
        console.log("⚠️ No companies extracted!");
      }

      allCompanies.push(...companies);

      // Save screenshot
      await page.screenshot({
        path: path.join(__dirname, `screenshot_page${pageNum}.png`),
        fullPage: true
      });
      console.log(`📸 Screenshot saved`);

      // Save HTML
      const html = await page.content();
      fs.writeFileSync(path.join(__dirname, `debug_page${pageNum}.html`), html, "utf-8");
      console.log(`📄 HTML saved`);

      // Delay
      const delay = 4000 + Math.random() * 2000;
      console.log(`Waiting ${Math.round(delay)}ms...`);
      await sleep(delay);

    } catch (error) {
      console.error(`Error on page ${pageNum}:`, error.message);
      try {
        await page.screenshot({ path: path.join(__dirname, `error_page${pageNum}.png`) });
      } catch (e) { }
    }
  }

  return allCompanies;
}

async function scrapeCompaniesFromData(data, page) {
  let _data_log = ''
  let output_date = []
  for (const record of data) {
    try {
      console.info(`Running at Row ${record.__rowNum__ + 1}`)
      let taxId = String(record.Thai_Tax_ID ?? '').replace(/\D/g, '');

      if (taxId.length === 12) taxId = '0' + taxId;
      if (taxId.length !== 13) {
        console.log("⚠️ Invalid Tax ID, skipping:", taxId);
        continue;
      }

      if (data[record.__rowNum__].Phone.toString()[0] != '0' &&
        data[record.__rowNum__].Phone.toString()[0] != '+' &&
        data[record.__rowNum__].Phone.toString()[0] != '(') {
        const url = `${process.env.BASE_URL}/${taxId}`;
        console.log(`🔎 Opening ${url}`);

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

        const passed = await waitForCloudflare(page);
        if (!passed) {
          console.log("❌ Cloudflare not passed, skipping");
          continue;
        }

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
        }, { timeout: 10000 }).catch(() => { });

        const companyData = await page.evaluate(() => {
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
            phone: getPhones(), // Call the multi-phone extractor
          };
        });
        if (companyData.phone === 'N/A')
          continue;

        let _data = ''
        _data_log += _data = `☎️ ${taxId} → ${companyData.phone}\n`
        console.log(_data);

        // Store to Data[record.__rowNum__]
        data[record.__rowNum__].Phone = companyData.phone

        // Dump verbose
        fs.writeFileSync('scraping.log', _data_log, "utf-8")
        await sleep(3000);
      } else {
        console.log("⚠️ Valid phone number, skipping:", taxId);
        continue;
      }

      await sleep(3000);
    } catch (error) {
      console.error("❌ Error:", error.stack);
    }
  }
  output_date = data
  return output_date
}

async function exportToExcel(data, filename) {
  try {
    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Companies");
    xlsx.writeFile(workbook, filename);
    console.log(`✅ Data exported to Excel: ${filename}`);
    return true;
  } catch (error) {
    console.error(`❌ Error exporting to Excel: ${error.message}`);
    return false;
  }
}

async function loadFromExcel(filename) {
  try {
    if (!fs.existsSync(filename)) {
      console.log(`⚠️ File not found: ${filename}`);
      return [];
    }

    const workbook = xlsx.readFile(filename);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // 1️⃣ ดึงทุก cell ออกมาแบบไม่สน header
    const data = xlsx.utils.sheet_to_json(worksheet, {
      // header: 1,
      header: [
        "Account_ID", "Account_Name", "Account_Name_English", "Account_Code", "Account_Group", "Account_Group_Code",
        "Account_Status", "Customer_Class", "Sales_Area", "Phone", "Phone_1", "Office_Phone", "Factory_Phone", "Website",
        "Facebook", "Billing_City", "Billing_Province", "Billing_Country", "Shipping_City", "Shipping_Province",
        "Shipping_Country", "Thai_Tax_ID", "Register_Capital", "Created_Time", "Modified_Time", "Last_Activity_Time",
        "Owner", "Tags", "Industry", "Org_Type", "TSIC_ID", "Billing_Street", "Vol_FIBC_Per_Years", "FIBC_Sling_Usage_Year"
      ],
      defval: null  // ช่องว่าง = null
    });

    console.log(`✅ Data loaded from Excel: ${filename}`);
    console.log(`✅ Records: ${data.length}`);

    return data;

  } catch (error) {
    console.error(
      `❌ Error loading Excel file: ${error.message}\n${error.stack}`
    );
    return [];
  }
}

// ===== MAIN EXECUTION =====
async function main() {
  console.log("DataForThai Scraper with Stealth Plugin");
  console.log("=".repeat(60));

  // Load data from Excel
  const excelData = await loadFromExcel(process.env.EXCEL_FILENAME);
  fs.writeFileSync("zoho-excel.json", JSON.stringify(excelData, null, 2), "utf-8");

  if (excelData.length > 0) {
    console.log(`Loaded ${excelData.length} records from Excel.`);
  }

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    extraHTTPHeaders: {
      'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);    // 60 sec

  try {
    const loggedIn = await login(page);
    if (!loggedIn) {
      console.log("⚠️ Login failed, but continuing anyway...");
    }

    await sleep(3000);

    console.log("\nStarting to scrape companies...");
    const companies = await scrapeCompaniesFromData(excelData, page);


    const filename = `zoho-crm-${guid.toString()}.csv`

    const exported_status = await exportToExcel(companies, filename)
    
    if (exported_status) {
      console.log(`✅ Scraping complete!`);
      console.log(`Saved to: ${filename}`);
    } else {
      console.log(`😔 Sorry, Scraping incomplete!`);
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  } finally {
    console.log("\n👉 Press Ctrl+C to close the browser");
    // Keep browser open for inspection
    await sleep(300000); // 5 minutes
    await browser.close();
  }
}

main().catch(error => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});