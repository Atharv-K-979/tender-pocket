const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function run() {
  const url = "https://www.tender247.com/auth/tender/100620293/78af32d5-6c65-4c49-9140-a9a835b53b2a/1003059";
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.tender247.com/',
    'Cache-Control': 'max-age=0'
  };

  try {
    console.log("Fetching HTML from guest URL...");
    const res = await axios.get(url, { headers, timeout: 15000 });
    console.log("Status:", res.status);
    console.log("Headers:", res.headers);
    const outputPath = path.join(__dirname, 'tender-guest-page.html');
    fs.writeFileSync(outputPath, res.data);
    console.log("HTML saved to:", outputPath);
    console.log("HTML length:", res.data.length);
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
