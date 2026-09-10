import axios from 'axios';

async function run() {
  const tenderId = "100647036";
  const securityCode = "7EF013AF-68EB-489B-BF9E-B773AE6A7BC7";
  
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
