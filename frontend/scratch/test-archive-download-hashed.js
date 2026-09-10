const axios = require('axios');
const fs = require('fs');

async function run() {
  const docPath = "1E84E154F7750EA429AD1D63F84694675216BE120F66773F155445D51AF07433";
  const guestUserId = "1003059";

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

    const downloadHeaders = {
      'User-Agent': apiHeaders['User-Agent'],
      'Referer': apiHeaders.Referer,
      'Authorization': `Bearer ${token}`
    };

    // Test download-document-all
    const urlAll = `https://documents.tender247.com/tender/download-document-all/${docPath}`;
    console.log(`\n2. Downloading all documents from: ${urlAll}...`);
    try {
      const resAll = await axios.get(urlAll, {
        responseType: 'arraybuffer',
        headers: downloadHeaders
      });
      console.log("Success! Status:", resAll.status, "Length:", resAll.data.length);
      fs.writeFileSync('scratch/downloaded-all-docs.zip', resAll.data);
      console.log("Saved to scratch/downloaded-all-docs.zip");
    } catch (err) {
      console.error("Failed download-document-all:", err.message);
    }

    // Test download-document (Individual)
    const urlInd = `https://documents.tender247.com/tender/download-document/${docPath}`;
    console.log(`\n3. Downloading individual doc from: ${urlInd}...`);
    try {
      const resInd = await axios.get(urlInd, {
        responseType: 'arraybuffer',
        headers: downloadHeaders
      });
      console.log("Success! Status:", resInd.status, "Length:", resInd.data.length);
      fs.writeFileSync('scratch/downloaded-doc.zip', resInd.data);
      console.log("Saved to scratch/downloaded-doc.zip");
    } catch (err) {
      console.error("Failed download-document:", err.message);
    }

  } catch (err) {
    console.error("Failed general:", err.message);
  }
}

run();
