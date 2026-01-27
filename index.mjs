// scraper.js
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import xlsx from 'xlsx'
import dotenv from "dotenv";

dotenv.config();

// Add stealth plugin
chromium.use(stealth());

// ===== CONFIGURATION =====
const login_url = process.env.LOGIN_URL || "https://www.dataforthai.com/member/login";
const base_url = process.env.BASE_URL || "https://www.dataforthai.com/company/";
const start_index = process.env.START_INDEX;
const end_index =  process.env.END_INDEX;

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
    await page.goto(login_url, {
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

// ===== SCRAPING FUNCTION ======
async function scrapeCompaniesFromData(data, startIndex, endIndex, page) {

  for (const record of data) {
    try {
      console.info(`Running at Row ${record.__rowNum__}`)

      // Store to Data[record.__rowNum__]
      if (record.__rowNum__ > 0) {
        if (record.__rowNum__ >= startIndex && record.__rowNum__ <= endIndex) {
          data[record.__rowNum__].Account_ID = await AccountID_Reform(record.Account_ID);
          data[record.__rowNum__].Thai_Tax_ID = await TaxID_Reform(record.Thai_Tax_ID);
          data[record.__rowNum__].Account_Code = await ReZero_First(record.Account_Code);
          data[record.__rowNum__].Account_Group = await ReZero_First(record.Account_Group);

          let _companyPhone = await FindCompany_Phone(page, data[record.__rowNum__].Phone, data[record.__rowNum__].Thai_Tax_ID);
          if (_companyPhone !== 'N/A')
            data[record.__rowNum__].Phone = await ReZero_First(_companyPhone);
          else
            data[record.__rowNum__].Phone = await ReZero_First(data[record.__rowNum__].Phone);

          data[record.__rowNum__].Account_Group_Code = await ReZero_First(record.Account_Group_Code); // account_group_code;
          data[record.__rowNum__].Phone_1 = await ReZero_First(record.Phone_1);
          data[record.__rowNum__].Office_Phone = await ReZero_First(record.Office_Phone);
          data[record.__rowNum__].Factory_Phone = await ReZero_First(record.Factory_Phone);
          await sleep(3000);
        }
      }
    } catch (error) {
      console.error("❌ Error:", error.stack);
    }
  }
  return data
}

async function exportToExcel(data,, startIndex, endIndex, filename) {
  try {
    if (!Array.isArray(data)) {
      throw new Error("Data must be an array of objects");
    }

    const worksheet = xlsx.utils.json_to_sheet(data.slice(startIndex, endIndex));
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
    // fs.close();
    return data;

  } catch (error) {
    console.error(
      `❌ Error loading Excel file: ${error.message}\n${error.stack}`
    );
    return [];
  }
}

async function AccountID_Reform(DataRecord) {
  return String(DataRecord);
}

async function TaxID_Reform(DataRecord) {
  let taxId = String(DataRecord ?? '').replace(/\D/g, '');

  if (taxId.length === 12) taxId = '0' + taxId;
  if (taxId.length !== 13) {
    console.log("⚠️ Invalid Tax ID, skipping:", taxId);
  }
  return taxId;
}

async function ReZero_First(DataRecord) {
  try {
    if (DataRecord.toString()[0] === '-')
      return '0' + DataRecord.toString(); // DataRecord;
    else if (DataRecord.toString()[0] !== '0')
      return '0' + DataRecord.toString();
    else
      return DataRecord;
  } catch {
    return DataRecord;
  }
}

async function FindCompany_Phone(page, DataRecord, Thai_Tax_ID) {
  if (DataRecord.toString()[0] != '0' &&
    DataRecord.toString()[0] != '+' &&
    DataRecord.toString()[0] != '(') {
    const url = `${base_url}/${Thai_Tax_ID}`;
    console.log(`🔎 Opening ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

    const passed = await waitForCloudflare(page);
    if (!passed) {
      console.log("❌ Cloudflare not passed, skipping");
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
    // if (companyData.phone === 'N/A') { }

    let _data = `☎️ ${Thai_Tax_ID} → ${companyData.phone}\n`
    console.log(_data);

    await sleep(3000);
    return companyData.phone;
  } else {
    console.log("⚠️ Valid phone number, skipping:", Thai_Tax_ID);
    return "-";
  }
}

// ===== MAIN EXECUTION =====
async function main() {
  console.log("DataForThai Scraper with Stealth Plugin");
  console.log("=".repeat(60));

  // Load data from Excel
  const excelData = await loadFromExcel(process.env.EXCEL_FILENAME);

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
    
    const companies = await scrapeCompaniesFromData(excelData, start_index, end_index, page);
    const filename = process.env.SAVE_FILENAME;
    const exported_status = await exportToExcel(companies, start_index, end_index, filename);

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