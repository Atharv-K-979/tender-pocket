import axios from 'axios';

async function testHeader() {
  const key = "W0c04dLJGvPRHOQg0U2TJowR1J7x/bXH+Y0S4tSQznA=";
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Referer': 'https://www.tender247.com/'
  };

  const loginRes = await axios.post(
    "https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/login/user/key",
    { key },
    { headers }
  );

  const token = loginRes.data?.Data?.[0]?.token;
  const userId = loginRes.data?.Data?.[0]?.user_id || 1003059;

  if (!token) {
    console.error("No token returned!");
    return;
  }

  const candidates = [
    { name: 'Authorization Bearer', headers: { ...headers, 'Authorization': `Bearer ${token}` } },
    { name: 'Authorization Token', headers: { ...headers, 'Authorization': token } },
    { name: 'token header', headers: { ...headers, 'token': token } },
    { name: 'x-token header', headers: { ...headers, 'x-token': token } },
    { name: 'authorization lower-case', headers: { ...headers, 'authorization': token } }
  ];

  for (const cand of candidates) {
    console.log(`\nTesting: ${cand.name}...`);
    try {
      const res = await axios.post(
        "https://t247_api.tender247.com/apigateway/T247Tender/api/tender/auth/tender-user-count",
        { user_id: userId, status: 2 },
        { headers: cand.headers }
      );
      console.log(`--> SUCCESS! Status: ${res.status}`);
      console.log(`--> Data snippet:`, JSON.stringify(res.data).substring(0, 100));
    } catch (err: any) {
      if (err.response) {
        console.log(`--> FAILED. Status: ${err.response.status}, Error: ${JSON.stringify(err.response.data)}`);
      } else {
        console.log(`--> FAILED. Message: ${err.message}`);
      }
    }
  }
}

testHeader().catch(console.error);
