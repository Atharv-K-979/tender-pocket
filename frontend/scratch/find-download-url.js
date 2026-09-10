const fs = require('fs');

const chunks = [
  'scratch/tender-page-chunk.js',
  'scratch/1158-0ccb7ce97387ac88.js'
];

// Let's download Chunk 1158-0ccb7ce97387ac88.js first if we haven't already.
// Wait! Let's download it.
const axios = require('axios');

async function downloadChunk() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/1158-0ccb7ce97387ac88.js";
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    fs.writeFileSync('scratch/1158-0ccb7ce97387ac88.js', res.data);
    console.log("Downloaded 1158-0ccb7ce97387ac88.js");
  } catch (err) {
    console.error("Failed to download chunk:", err.message);
  }
}

async function run() {
  await downloadChunk();
  
  for (const chunk of chunks) {
    if (!fs.existsSync(chunk)) continue;
    const content = fs.readFileSync(chunk, 'utf8');
    console.log(`\n=== Searching ${chunk} ===`);
    
    // Look for download, document, pdf, or URL templates
    const searchTerms = ['download-document', 'documents.tender247.com', 'downloadDocument', 'downloadAllDocument', 'download-all-document', 'download/'];
    searchTerms.forEach(term => {
      let idx = 0;
      while ((idx = content.indexOf(term, idx)) !== -1) {
        console.log(`Found "${term}" at ${idx}:`);
        console.log(content.slice(idx - 100, idx + 200));
        idx += term.length;
      }
    });
  }
}

run();
