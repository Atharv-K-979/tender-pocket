import puppeteer from 'puppeteer';

async function trace() {
  const url = "https://www.tender247.com/auth/tender/100575724/b9447510-de95-46e0-b8cb-01ffd815155e/1003059";
  
  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Set User-Agent to standard browser
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
  
  console.log("Setting up network request logging...");
  const requests: any[] = [];
  
  page.on('request', request => {
    const url = request.url();
    const method = request.method();
    requests.push({
      url,
      method,
      headers: request.headers()
    });
    
    if (url.includes('t247_api.tender247.com') && method === 'POST') {
      console.log(`\n[POST REQUEST] ${url}`);
      console.log(`Headers:`, JSON.stringify(request.headers(), null, 2));
      console.log(`Post Data:`, request.postData());
    }
  });

  page.on('response', async response => {
    const req = response.request();
    const contentType = response.headers()['content-type'] || '';
    const isDocOrApi = contentType.includes('json') || 
                       contentType.includes('javascript') || 
                       req.url().includes('api') ||
                       req.url().includes('tender');
                       
    if (isDocOrApi && response.status() === 200) {
      try {
        const text = await response.text();
        if (text.includes("Raipur") || text.includes("hvac") || text.includes("100575724")) {
          console.log(`\n[DATA MATCH] Response from ${req.url()} (Status: ${response.status()}) contains target data!`);
          console.log(`Content type: ${contentType}`);
          console.log(`Data snippet: ${text.substring(0, 1000)}`);
        }
      } catch (e) {
        // ignore body read errors
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
  
  console.log("\nList of all network requests:");
  requests.forEach((r, idx) => {
    console.log(`${idx + 1}: [${r.method}] ${r.url.substring(0, 120)}...`);
  });
  
  await browser.close();
}

trace().catch(console.error);
