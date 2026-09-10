const axios = require('axios');

async function run() {
  const tenderId = "100620293";
  const securityCode = "78af32d5-6c65-4c49-9140-a9a835b53b2a";
  const userId = 1003059;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Referer': 'https://www.tender247.com/'
  };

  try {
    console.log("1. GET user-login...");
    const loginRes = await axios.get(`https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/user-login/${userId}`, { headers });
    const loginData = loginRes.data?.Data?.[0];
    const token = loginData?.token;
    if (!token) {
      console.error("Failed to get token");
      return;
    }
    console.log("Token obtained.");

    // Add authorization header
    headers['Authorization'] = `Bearer ${token}`;

    console.log("2. POST users_subscription_details...");
    await axios.post(`https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/users_subscription_details/${userId}`, {}, { headers });

    console.log("3. POST user-login-query...");
    const queryRes = await axios.post(`https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/user-login-query`, {
      user_id: userId,
      company_service_id: 1,
      is_grace: false
    }, { headers });
    
    // Update token if returned
    const newToken = queryRes.data?.Data?.[0]?.token || token;
    headers['Authorization'] = `Bearer ${newToken}`;
    console.log("Sequence setup done.");

    console.log(`4. Fetching tender details for tender ${tenderId}...`);
    const detailRes = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/${tenderId}`,
      { guest_user_id: 0, security_code: securityCode, ip: "" },
      { headers }
    );
    console.log("Detail Response:", JSON.stringify(detailRes.data, null, 2));

    console.log(`5. Fetching document list for tender ${tenderId}...`);
    const docRes = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`,
      {},
      { headers }
    );
    console.log("Document List Response:", JSON.stringify(docRes.data, null, 2));

  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
