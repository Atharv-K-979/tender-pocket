const axios = require('axios');
const fs = require('fs');

async function testDownload() {
  const docPath = "3b2ab3e8-4bcd-483f-8449-333dfab19e30.html";
  const url = `https://documents.tender247.com/tender/download-document/${encodeURIComponent(docPath)}`;
  
  console.log(`Downloading document from: ${url}`);
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tender247.com/'
      }
    });
    console.log("Status:", res.status);
    console.log("Length:", res.data.length);
    fs.writeFileSync('scratch/downloaded-test-archive-doc.html', res.data);
    console.log("Saved to scratch/downloaded-test-archive-doc.html");
  } catch (err) {
    console.error("Failed:", err.message);
  }

  // Also test the first path (UNC path)
  const uncPath = "\\\\192.168.7.10\\CrawlingData\\MSRTC_TENDER_DATA_1\\auction_report_581493.pdf";
  const url2 = `https://documents.tender247.com/tender/download-document/${encodeURIComponent(uncPath)}`;
  console.log(`\nDownloading unc document from: ${url2}`);
  try {
    const res2 = await axios.get(url2, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tender247.com/'
      }
    });
    console.log("Status:", res2.status);
    console.log("Length:", res2.data.length);
    fs.writeFileSync('scratch/downloaded-test-archive-doc.pdf', res2.data);
    console.log("Saved to scratch/downloaded-test-archive-doc.pdf");
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

testDownload();
