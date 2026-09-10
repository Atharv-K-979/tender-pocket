const axios = require('axios');

async function run() {
  const userId = "1003059";
  const url = `https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/user-login/${userId}`;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://www.tender247.com/'
  };

  try {
    console.log(`Sending GET request to user-login endpoint: ${url}...`);
    const res = await axios.get(url, { headers });
    console.log("Status:", res.status);
    console.log("Response Data:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
