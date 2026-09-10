const axios = require('axios');

async function run() {
  const tenderId = "100620293";
  const securityCode = "78af32d5-6c65-4c49-9140-a9a835b53b2a";
  const guestUserId = "1003059";
  const year = "2026";

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

    // Test Archive Detail
    const detailUrl = `https://t247_api.tender247.com/apigateway/T247ArchiveTenders/api/${year}/tender-detail/${tenderId}`;
    console.log(`\n2. Querying Archive Detail: ${detailUrl}...`);
    const detailRes = await axios.post(
      detailUrl,
      { guest_user_id: 0, security_code: securityCode, ip: "", fullViewTender: true },
      { headers: apiHeaders }
    );
    console.log("Detail Response:", JSON.stringify(detailRes.data, null, 2));

    // Test Archive Document List
    const docUrl = `https://t247_api.tender247.com/apigateway/T247ArchiveTenders/api/${year}/tender-document-list/${tenderId}`;
    console.log(`\n3. Querying Archive Document List: ${docUrl}...`);
    const docRes = await axios.post(
      docUrl,
      { guest_user_id: Number(guestUserId), security_code: securityCode, ip: "" },
      { headers: apiHeaders }
    );
    console.log("Document List Response:", JSON.stringify(docRes.data, null, 2));

  } catch (err) {
    console.error("Failed:", err.message);
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
    }
  }
}

run();
