const axios = require('axios');
const fs = require('fs');

async function run() {
  const chunk = '1158-0ccb7ce97387ac88.js';
  const url = `https://www.tender247.com/auth/_next/static/chunks/${chunk}`;
  console.log("Downloading:", url);
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });
    console.log("Success! Length:", res.data.length);
    fs.writeFileSync('scratch/chunk_1158.js', res.data);
    console.log("Saved to scratch/chunk_1158.js");
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
