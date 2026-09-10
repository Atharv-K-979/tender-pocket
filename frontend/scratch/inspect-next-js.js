const axios = require('axios');
const fs = require('fs');

async function run() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/app/tender/%5B...tenderParams%5D/page-85e755ccbff5a3f7.js";
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    console.log("Fetched JS chunk successfully. Length:", res.data.length);
    fs.writeFileSync('scratch/tender-page-chunk.js', res.data);
    
    // Search for keywords
    const keywords = ['download', 'zip', 'document', 'DownloadAll', 'Download All', 'all-document', 'apigateway'];
    keywords.forEach(kw => {
      let count = 0;
      let pos = res.data.indexOf(kw);
      while (pos !== -1) {
        count++;
        pos = res.data.indexOf(kw, pos + 1);
      }
      console.log(`Keyword '${kw}' matches: ${count}`);
    });
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
