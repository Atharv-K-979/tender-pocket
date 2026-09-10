const puppeteer = require('puppeteer');

async function trace() {
  const url = "https://www.tender247.com/auth/tender/100620293/78af32d5-6c65-4c49-9140-a9a835b53b2a/1003059";
  
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  
  console.log("Setting up network request logging...");
  const requests = [];
  
  page.on('request', request => {
    const u = request.url();
    const method = request.method();
    
    if (u.includes('t247_api.tender247.com') || u.includes('tender')) {
      console.log(`\n[REQUEST] [${method}] ${u}`);
      console.log(`Headers:`, JSON.stringify(request.headers(), null, 2));
      if (method === 'POST') {
        console.log(`Post Data:`, request.postData());
      }
    }
  });

  page.on('response', async response => {
    const req = response.request();
    const u = req.url();
    
    if (u.includes('t247_api.tender247.com') || u.includes('tender')) {
      console.log(`\n[RESPONSE] ${u} (Status: ${response.status()})`);
      try {
        const text = await response.text();
        console.log(`Data snippet: ${text.substring(0, 1000)}`);
      } catch (e) {
        console.log(`Failed to read response body: ${e.message}`);
      }
    }
  });

  console.log("Navigating to URL:", url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  console.log("Waiting 5 seconds for page to mount and load...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const title = await page.title();
  console.log("\nPage Loaded!");
  console.log("Document Title:", title);
  
  const textContent = await page.evaluate(() => document.body.innerText);
  console.log("Text length:", textContent.length);
  console.log("\nPage text snippet (first 1000 chars):");
  console.log(textContent.substring(0, 1000));
  
  await browser.close();
}

trace().catch(console.error);
