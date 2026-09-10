const axios = require('axios');

async function run() {
  const tenderId = "100204425";
  const securityCode = "d0bbf468-6440-4ea0-a617-1fed82e7b10c";
  const userId = "1003059";
  
  const apiHeaders = {
    'Referer': 'https://www.tender247.com/',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  try {
    console.log(`Fetching documents for tender ${tenderId}...`);
    const docRes = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`,
      { guest_user_id: Number(userId), security_code: securityCode, ip: "" },
      { headers: apiHeaders }
    );
    console.log("Documents Found:", docRes.data);
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
