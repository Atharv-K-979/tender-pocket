const axios = require('axios');
const fs = require('fs');

async function run() {
  const url = "https://www.tender247.com/auth/tender/100620293/78af32d5-6c65-4c49-9140-a9a835b53b2a/1003059";
  console.log("Fetching HTML page for 100620293...");
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
    fs.writeFileSync('scratch/page-100620293.html', response.data);
    console.log("Saved page to scratch/page-100620293.html");
    
    // Look for document paths in the page source
    const regex = /download-document\/([A-Za-z0-9\-]+)/g;
    let match;
    const matches = [];
    while ((match = regex.exec(response.data)) !== null) {
      matches.push(match[0]);
    }
    console.log("Found matches for download-document:", matches);

    // Look for any self.__next_f or JSON or document references
    const hasNextData = response.data.includes('__NEXT_DATA__');
    console.log("Has __NEXT_DATA__:", hasNextData);
    
    // Search for self.__next_f lines
    const lines = response.data.split('\n');
    let nextLines = lines.filter(l => l.includes('self.__next_f.push'));
    console.log("Number of next_f lines:", nextLines.length);
    fs.writeFileSync('scratch/next_f_lines.txt', nextLines.join('\n'));
    console.log("Saved next_f lines to scratch/next_f_lines.txt");
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
