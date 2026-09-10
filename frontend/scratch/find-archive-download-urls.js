const axios = require('axios');
const fs = require('fs');

async function run() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/1158-0ccb7ce97387ac88.js";
  console.log("Downloading chunk 1158...");
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    console.log("Success! Length:", res.data.length);
    fs.writeFileSync('scratch/chunk_1158.js', res.data);
    
    // Search for download url paths
    const terms = ['/download', 'download-document', 'documents.tender247.com', 'downloadDocument', 'downloadAllDocument', 'download-all-document', 'download/'];
    terms.forEach(term => {
      let idx = 0;
      while ((idx = res.data.indexOf(term, idx)) !== -1) {
        console.log(`Found "${term}" at ${idx}:`);
        console.log(res.data.slice(idx - 100, idx + 200));
        idx += term.length;
      }
    });

    // Let's print out all RouteUrls keys/values inside this chunk
    const idxRoute = res.data.indexOf('RouteUrls');
    if (idxRoute !== -1) {
      console.log("\nRouteUrls definition context:");
      console.log(res.data.slice(idxRoute, idxRoute + 2000));
    }
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
