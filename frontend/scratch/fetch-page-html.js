const axios = require('axios');
const fs = require('fs');

async function run() {
  const url = "https://www.tender247.com/auth/tender/100204425/d0bbf468-6440-4ea0-a617-1fed82e7b10c/1003059";
  console.log("Fetching HTML page:", url);
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://www.tender247.com/'
      }
    });
    console.log("Status:", response.status);
    console.log("HTML length:", response.data.length);
    fs.writeFileSync('scratch/page.html', response.data);
    console.log("Saved page to scratch/page.html");
    
    // Look for document paths in the page source
    const regex = /download-document\/([A-Za-z0-9]+)/g;
    let match;
    const matches = [];
    while ((match = regex.exec(response.data)) !== null) {
      matches.push(match[0]);
    }
    console.log("Found matches for download-document:", matches);
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run().catch(console.error);
