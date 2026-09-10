import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

async function testEndpoint() {
  const emlPath = path.join(__dirname, 'test-email.eml');
  const emlString = fs.readFileSync(emlPath, 'utf8');

  console.log("Sending EML payload to local API endpoint /api/process-email...");
  try {
    const res = await axios.post('http://localhost:3000/api/process-email', {
      emlString
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log("Status Code:", res.status);
    console.log("Response Body:", JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error("API Call failed!");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Error data:", err.response.data);
    } else {
      console.error("Message:", err.message);
    }
  }
}

testEndpoint().catch(console.error);
