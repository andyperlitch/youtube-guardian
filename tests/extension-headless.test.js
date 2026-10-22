const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const EXTENSION_PATH = path.join(__dirname, "..", "extension");
const CHROME = "/usr/bin/google-chrome";

describe("headless Chrome extension", { skip: !fs.existsSync(CHROME) }, () => {
  let browser;
  let worker;
  let extensionId;

  before(async () => {
    let puppeteer;
    try {
      puppeteer = require("puppeteer-core");
    } catch {
      const { execSync } = require("node:child_process");
      execSync("npm install --no-save puppeteer-core@24", { stdio: "inherit" });
      puppeteer = require("puppeteer-core");
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ytg-chrome-"));
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      pipe: true,
      enableExtensions: [EXTENSION_PATH],
      userDataDir,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const targets = browser.targets();
      const sw = targets.find(
        (t) =>
          t.type() === "service_worker" &&
          t.url().includes("chrome-extension://")
      );
      if (sw) {
        worker = await sw.worker();
        extensionId = new URL(sw.url()).hostname;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!worker) {
      throw new Error("Extension service worker did not start");
    }
  });

  after(async () => {
    if (browser) await browser.close();
  });

  it("onboards a password, stores a hash, and unlocks", async () => {
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForSelector("#onboard-panel", { timeout: 5000 });
    const onboardHidden = await page.$eval("#onboard-panel", (el) => el.hidden);
    assert.equal(onboardHidden, false);

    await page.type("#onboard-password", "parentpass");
    await page.type("#onboard-confirm", "parentpass");
    await page.click("#onboard-form button[type=submit]");
    await page.waitForSelector("#editor:not([hidden])");

    const stored = await worker.evaluate(() => chrome.storage.local.get(["ytg.settings"]));
    assert.ok(stored["ytg.settings"]?.password?.hash);
    assert.equal(JSON.stringify(stored).includes("parentpass"), false);

    await page.click('button.tab[data-tab="shorts"]');
    const policy = await page.$eval("#list-policy", (el) => el.textContent);
    assert.match(policy, /Shorts allowlist/);

    await page.type("#channel-input", "@PBSKids");
    await page.click("#add-btn");
    await page.waitForFunction(() =>
      document.querySelector("#list li .entry-label")?.textContent.includes("pbskids")
    );

    const lists = await worker.evaluate(() =>
      chrome.storage.local.get(["ytg.channelAllowlist", "ytg.shortsAllowlist"])
    );
    assert.equal(lists["ytg.shortsAllowlist"][0].handle, "pbskids");
    assert.deepEqual(lists["ytg.channelAllowlist"] || [], []);
    await page.close();
  });
});
