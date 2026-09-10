const axios = require('axios');

async function run() {
  const tenderId = "100620293";
  const securityCode = "78af32d5-6c65-4c49-9140-a9a835b53b2a";
  const apiHeaders = {
    'Referer': 'https://www.tender247.com/',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  try {
    const res = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/${tenderId}`,
      { guest_user_id: 0, security_code: securityCode, ip: "" },
      { headers: apiHeaders }
    );
    console.log("Tender Detail Data:");
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

run();
