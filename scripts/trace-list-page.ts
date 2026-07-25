import puppeteer from 'puppeteer';

async function trace() {
  const url = "https://www.tender247.com/mailtenders?key=W0c04dLJGvPRHOQg0U2TJowR1J7x%2FbXH+Y0S4tSQznA%3D";
  
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  
  console.log("Setting up network request logging...");
  const apiCalls: any[] = [];
  
  page.on('response', async response => {
    const req = response.request();
    const reqUrl = req.url();
    const method = req.method();
    
    if (reqUrl.includes('api') || reqUrl.includes('apigateway')) {
      console.log(`\n[API CALL] ${method} ${reqUrl} (Status: ${response.status()})`);
      if (method === 'POST') {
        console.log(`- Post Data:`, req.postData());
      }
      
      if (response.status() === 200) {
        try {
          const text = await response.text();
          console.log(`- Response Snippet (200 chars):`, text.substring(0, 200));
          apiCalls.push({
            url: reqUrl,
            method,
            postData: req.postData(),
            responseLength: text.length,
            responseText: text
          });
        } catch (e: any) {
          console.log(`- Could not read response body:`, e.message);
        }
      }
    }
  });

  console.log("Navigating to URL:", url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  console.log("Waiting 5 seconds for SPA to load data...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const title = await page.title();
  console.log("\nPage Loaded! Title:", title);
  
  const textContent = await page.evaluate(() => document.body.innerText);
  console.log("Page text snippet (first 500 chars):");
  console.log(textContent.substring(0, 500));

  // Let's see if there are tables, items or other structures in the DOM
  const listItemsCount = await page.evaluate(() => {
    // Look for links or listing items
    return document.querySelectorAll('a[href*="/auth/tender/"]').length;
  });
  console.log(`Found ${listItemsCount} tender details links on page.`);
  
  await browser.close();
}

trace().catch(console.error);
