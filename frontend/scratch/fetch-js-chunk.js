const axios = require('axios');
const fs = require('fs');

async function run() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/app/tender/%5B...tenderParams%5D/page-85e755ccbff5a3f7.js";
  console.log("Downloading Next.js JS chunk...");
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    console.log("Successfully downloaded. Length:", res.data.length);
    fs.writeFileSync('scratch/tender-page-chunk.js', res.data);
    console.log("Saved to scratch/tender-page-chunk.js");

    // Search for keywords
    const keywords = ['document', 'download', 'api', 'tender-document-list', 'apigateway', 'documents.tender247.com'];
    keywords.forEach(kw => {
      const idx = res.data.indexOf(kw);
      console.log(`Keyword "${kw}" found: ${idx !== -1} (first index: ${idx})`);
    });
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
