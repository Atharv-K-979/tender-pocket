const axios = require('axios');

async function run() {
  const key = "l0bojs ejxR2Sk cm3rfllj90yGzuSVse0LXErK0ej4=";
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Referer': 'https://www.tender247.com/'
  };

  try {
    console.log("1. Authenticating with key...");
    const loginRes = await axios.post(
      "https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/login/user/key",
      { key },
      { headers }
    );

    console.log("Response Status:", loginRes.status);
    console.log("Response Headers:", loginRes.headers);
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run().catch(console.error);
