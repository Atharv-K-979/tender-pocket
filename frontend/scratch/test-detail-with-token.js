const axios = require('axios');

async function run() {
  const key = "l0bojs ejxR2Sk cm3rfllj90yGzuSVse0LXErK0ej4=";
  const tenderId = "100204425";
  const securityCode = "d0bbf468-6440-4ea0-a617-1fed82e7b10c";
  
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

    const loginData = loginRes.data?.Data?.[0];
    const token = loginData?.token;
    if (!token) {
      console.error("Login failed:", loginRes.data);
      return;
    }
    console.log("Token obtained successfully.");

    // Add authorization header
    headers['Authorization'] = `Bearer ${token}`;

    console.log(`2. Fetching tender-detail with Authorization header for tender ${tenderId}...`);
    const detailRes = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/${tenderId}`,
      { guest_user_id: 0, security_code: securityCode, ip: "" },
      { headers }
    );
    console.log("Detail API Response:");
    console.log(JSON.stringify(detailRes.data, null, 2));

  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run().catch(console.error);
