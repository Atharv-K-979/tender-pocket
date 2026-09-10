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
    const userId = loginData?.user_id || 1003059;
    const queryId = loginData?.user_query_id || 313652;
    
    if (!token) {
      console.error("Login failed:", loginRes.data);
      return;
    }
    console.log(`Token obtained. User ID: ${userId}, Query ID: ${queryId}`);

    // Add authorization header
    headers['Authorization'] = `Bearer ${token}`;

    const variations = [
      { name: "empty body", body: {} },
      { name: "user_id only", body: { user_id: userId } },
      { name: "guest_user_id only", body: { guest_user_id: userId } },
      { name: "user_id and query_id", body: { user_id: userId, user_email_service_query_id: queryId } },
      { name: "security_code and guest_user_id", body: { guest_user_id: 0, security_code: securityCode, ip: "" } },
      { name: "security_code, guest_user_id, and user_id", body: { guest_user_id: userId, security_code: securityCode, ip: "" } }
    ];

    for (const v of variations) {
      console.log(`\nTesting variation: ${v.name}...`);
      try {
        const res = await axios.post(
          `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`,
          v.body,
          { headers }
        );
        console.log(`--> Success! TotalRecord: ${res.data.TotalRecord || (res.data.Data ? res.data.Data.length : 0)}`);
        console.log(`--> Data snippet:`, JSON.stringify(res.data).substring(0, 200));
      } catch (e) {
        console.log(`--> Failed: ${e.message}`);
      }
    }

  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run().catch(console.error);
