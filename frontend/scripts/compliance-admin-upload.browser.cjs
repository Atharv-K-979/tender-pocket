// Run from frontend after installing Playwright in target/compliance-browser.
const { chromium } = require("../target/compliance-browser/node_modules/playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const heading of ["Technical Specification Review", "Technical Specification Clearance"]) {
      const page = await browser.newPage();
      let uploads = 0;
      await page.addInitScript(() => {
        localStorage.setItem("currentUser", JSON.stringify({ username: "admin", role: "Admin" }));
      });
      await page.route("http://compliance.test/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname === "/compliance-progress.js") return route.fulfill({
          contentType: "text/javascript",
          body: fs.readFileSync(path.join(__dirname, "../../backend/src/main/resources/static/compliance-progress.js"), "utf8")
        });
        if (url.pathname.endsWith("tech-spec-progress")) return route.fulfill({
          json: { status: "NOT_STARTED", events: [] }
        });
        if (url.pathname.endsWith("upload-tech-spec")) {
          uploads++;
          return route.fulfill({ json: { success: true, generated: false, products: [],
            message: "No products found with applicable compliance requirements." } });
        }
        return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>
          <section><div><h4>1. ${heading}</h4></div></section>
          <script src="/compliance-progress.js"></script></body></html>` });
      });
      await page.goto("http://compliance.test/tenders/123");
      const form = page.locator("#compliance-admin-upload");
      await form.waitFor();
      assert.equal(await form.count(), 1);
      await form.locator('input[type="file"]').setInputFiles({
        name: "specification.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-fixture")
      });
      await form.getByRole("button", { name: "Generate compliance sheets" }).click();
      await page.waitForFunction(() => document.querySelector(".cp-message")?.textContent ===
        "No products found with applicable compliance requirements.");
      assert.equal(uploads, 1);
      await page.evaluate(() => document.body.appendChild(document.createElement("span")));
      assert.equal(await form.count(), 1, "Mutation observers must not duplicate upload controls");
      await page.close();
      console.log(`PASS Admin upload under ${heading}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
