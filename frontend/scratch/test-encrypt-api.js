const axios = require('axios');

async function run() {
  const guestUserId = "1003059";
  const uncPath = "\\\\192.168.7.10\\CrawlingData\\MSRTC_TENDER_DATA_1\\auction_report_581493.pdf";

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
    console.log("Token obtained.");
    apiHeaders['Authorization'] = `Bearer ${token}`;

    const encryptUrl = "https://t247_api.tender247.com/apigateway/T247ApiTender/api/tender/auth/encrypt-data";
    
    // Variations of request bodies
    const variations = [
      { name: "text", body: { text: uncPath } },
      { name: "data", body: { data: uncPath } },
      { name: "value", body: { value: uncPath } },
      { name: "path", body: { path: uncPath } },
      { name: "doc_path", body: { doc_path: uncPath } },
      { name: "document_path", body: { document_path: uncPath } },
      { name: "tender_path", body: { tender_path: uncPath } }
    ];

    for (const v of variations) {
      console.log(`\nTesting variation "${v.name}"...`);
      try {
        const res = await axios.post(encryptUrl, v.body, { headers: apiHeaders });
        console.log("Response Status:", res.status);
        console.log("Response Data:", JSON.stringify(res.data, null, 2));
      } catch (err) {
        console.error("Failed:", err.message);
      }
    }

  } catch (err) {
    console.error("Failed general:", err.message);
  }
}

run();
