const axios = require('axios');
const fs = require('fs');

async function run() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/9320-e00cd7a11fcf345b.js";
  console.log("Downloading chunk 9320...");
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    console.log("Success! Length:", res.data.length);
    
    const index = res.data.indexOf('41614:');
    if (index !== -1) {
      console.log("Found 41614 at", index);
      // Let's find the end of the module. Typically next module starts like "41615:" or similar,
      // or we can print 10000 characters.
      fs.writeFileSync('scratch/module_41614.js', res.data.slice(index, index + 10000));
      console.log("Saved to scratch/module_41614.js");
    }
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
