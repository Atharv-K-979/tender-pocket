import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function testDownload() {
  const docPath = "5A533109C6B20E46662E0470EF92DFE0509685549F8B2176B10B21CADBF45B2F8DC443F57C5599E69FC5E4B91F944E93";
  const downloadUrl = `https://documents.tender247.com/tender/download-document/${docPath}`;

  console.log("Downloading document from:", downloadUrl);
  try {
    const response = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tender247.com/'
      }
    });

    console.log("Response status:", response.status);
    console.log("Content-Type:", response.headers['content-type']);
    console.log("Content-Length:", response.headers['content-length']);

    const outputPath = path.join(__dirname, 'test-downloaded-doc.pdf');
    fs.writeFileSync(outputPath, response.data);
    console.log(`Document saved successfully to ${outputPath}`);
  } catch (err: any) {
    console.error("Download failed:", err.message);
  }
}

testDownload().catch(console.error);
