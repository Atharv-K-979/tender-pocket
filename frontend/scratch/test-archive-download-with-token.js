const axios = require('axios');
const fs = require('fs');

async function run() {
  const tenderId = "100620293";
  const securityCode = "78af32d5-6c65-4c49-9140-a9a835b53b2a";
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

    // Test paths
    const docPath1 = "\\\\192.168.7.10\\CrawlingData\\MSRTC_TENDER_DATA_1\\auction_report_581493.pdf";
    const docPath2 = "3b2ab3e8-4bcd-483f-8449-333dfab19e30.html";

    const downloadHeaders = {
      'User-Agent': apiHeaders['User-Agent'],
      'Referer': apiHeaders.Referer,
      'Authorization': `Bearer ${token}`
    };

    // Test download-document-all (Download All)
    // Wait, let's see which path works for Download All. Is it the document_path of the first or second?
    // In function s(e,t,a): s(e, e.doc_path, t) -> it passes e.doc_path (which is the document_path/doc_path of the first document)
    // So let's try download-document-all with docPath1
    const urlAll = `https://documents.tender247.com/tender/download-document-all/${encodeURIComponent(docPath1)}`;
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
      if (err.response) {
        console.error("Response Status:", err.response.status);
        console.error("Response Data:", err.response.data.toString());
      }
    }

    // Test download-document (Individual) for docPath1
    const urlInd1 = `https://documents.tender247.com/tender/download-document/${encodeURIComponent(docPath1)}`;
    console.log(`\n3. Downloading individual doc 1 from: ${urlInd1}...`);
    try {
      const resInd1 = await axios.get(urlInd1, {
        responseType: 'arraybuffer',
        headers: downloadHeaders
      });
      console.log("Success! Status:", resInd1.status, "Length:", resInd1.data.length);
      fs.writeFileSync('scratch/downloaded-doc1.pdf', resInd1.data);
      console.log("Saved to scratch/downloaded-doc1.pdf");
    } catch (err) {
      console.error("Failed download-document (docPath1):", err.message);
    }

    // Test download-document (Individual) for docPath2
    const urlInd2 = `https://documents.tender247.com/tender/download-document/${encodeURIComponent(docPath2)}`;
    console.log(`\n4. Downloading individual doc 2 from: ${urlInd2}...`);
    try {
      const resInd2 = await axios.get(urlInd2, {
        responseType: 'arraybuffer',
        headers: downloadHeaders
      });
      console.log("Success! Status:", resInd2.status, "Length:", resInd2.data.length);
      fs.writeFileSync('scratch/downloaded-doc2.html', resInd2.data);
      console.log("Saved to scratch/downloaded-doc2.html");
    } catch (err) {
      console.error("Failed download-document (docPath2):", err.message);
    }

  } catch (err) {
    console.error("Failed general:", err.message);
  }
}

run();
