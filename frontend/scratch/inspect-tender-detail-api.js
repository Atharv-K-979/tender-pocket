const axios = require('axios');

async function run() {
  const tenderId = "100204425";
  const securityCode = "d0bbf468-6440-4ea0-a617-1fed82e7b10c";
  
  const apiHeaders = {
    'Referer': 'https://www.tender247.com/',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  try {
    const detailRes = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/${tenderId}`,
      { guest_user_id: 0, security_code: securityCode, ip: "" },
      { headers: apiHeaders }
    );
    console.log("Detail API Response Data:");
    console.log(JSON.stringify(detailRes.data, null, 2));
  } catch (err) {
    console.error("API Call Failed:", err);
  }
}

run().catch(console.error);
