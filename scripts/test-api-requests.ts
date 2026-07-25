import axios from 'axios';

async function testApi() {
  const tenderId = "100575724";
  const securityCode = "b9447510-de95-46e0-b8cb-01ffd815155e";

  const headers = {
    'Referer': 'https://www.tender247.com/',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  console.log("--- Testing tender-detail ---");
  try {
    const res = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/${tenderId}`,
      {
        guest_user_id: 0,
        security_code: securityCode,
        ip: ""
      },
      { headers }
    );
    console.log("Status:", res.status);
    console.log("Success:", res.data?.Success);
    console.log("Data:", JSON.stringify(res.data?.Data, null, 2));
  } catch (err: any) {
    console.error("tender-detail error:", err.message);
  }

  console.log("\n--- Testing tender-sitelocation ---");
  try {
    const res = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-sitelocation/${tenderId}`,
      {},
      { headers }
    );
    console.log("Status:", res.status);
    console.log("Success:", res.data?.Success);
    console.log("Data:", JSON.stringify(res.data?.Data, null, 2));
  } catch (err: any) {
    console.error("tender-sitelocation error:", err.message);
  }

  console.log("\n--- Testing tender-document-list ---");
  try {
    const res = await axios.post(
      `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`,
      {},
      { headers }
    );
    console.log("Status:", res.status);
    console.log("Success:", res.data?.Success);
    console.log("Data:", JSON.stringify(res.data?.Data, null, 2));
  } catch (err: any) {
    console.error("tender-document-list error:", err.message);
  }
}

testApi().catch(console.error);
