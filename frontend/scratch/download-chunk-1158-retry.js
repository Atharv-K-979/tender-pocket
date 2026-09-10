const axios = require('axios');
const fs = require('fs');

async function run() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/1158-0ccb7ce97387ac88.js";
  console.log("Downloading chunk 1158 from:", url);
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.tender247.com/auth/tender/100620293/78af32d5-6c65-4c49-9140-a9a835b53b2a/1003059'
      }
    });
    console.log("Success! Length:", res.data.length);
    fs.writeFileSync('scratch/chunk_1158_ok.js', res.data);
  } catch (err) {
    console.error("Error Message:", err.message);
    if (err.response) {
      console.error("Response Status:", err.response.status);
      console.error("Response Headers:", err.response.headers);
    }
  }
}

run();
