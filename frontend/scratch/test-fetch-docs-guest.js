const axios = require('axios');

async function run() {
  const tenderId = "100620293";
  const guestUserId = "1003059";
  const securityCode = "78af32d5-6c65-4c49-9140-a9a835b53b2a";

  const apiHeaders = {
    'Referer': 'https://www.tender247.com/',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  try {
    console.log(`1. Fetching guest login token...`);
    const loginRes = await axios.get(
      `https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/user-login/${guestUserId}`,
      { headers: { 'User-Agent': apiHeaders['User-Agent'], 'Referer': apiHeaders.Referer, 'Accept': 'application/json' } }
    );
    const token = loginRes.data?.Data?.[0]?.token;
    if (!token) {
      console.error("Failed to get token:", loginRes.data);
      return;
    }
    console.log("Token obtained:", token.substring(0, 30) + "...");
    apiHeaders['Authorization'] = `Bearer ${token}`;

    const postBody = {
      guest_user_id: Number(guestUserId),
      security_code: securityCode,
      ip: ""
    };

    console.log(`2. Fetching document list with Bearer token for tender ${tenderId}...`);
    const docRes = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`,
      postBody,
      { headers: apiHeaders }
    );

    console.log("Response:", JSON.stringify(docRes.data, null, 2));

  } catch (err) {
    console.error("Failed:", err.message);
    if (err.response) {
      console.error("Response status:", err.response.status);
      console.error("Response data:", err.response.data);
    }
  }
}

run();
