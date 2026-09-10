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
    console.log("Downloaded chunk 9320. Length:", res.data.length);
    fs.writeFileSync('scratch/chunk_9320.js', res.data);

    // Let's find occurrences of defaults.
    let idx = 0;
    while ((idx = res.data.indexOf('defaults.', idx)) !== -1) {
      console.log(`Found "defaults." at ${idx}:`);
      console.log(res.data.slice(idx - 50, idx + 150));
      idx += 9;
    }
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
