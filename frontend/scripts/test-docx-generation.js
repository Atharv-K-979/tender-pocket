const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function runTest() {
  const tenderId = '100204425';
  const url = `http://localhost:3000/api/tenders/${tenderId}/generate-bid-docs`;

  console.log(`Sending POST request to generate bid documents: ${url}`);

  const mockPayload = {
    date: "07-06-2026",
    authorityName: "Director General Medical Services (Army)",
    authorityDept: "Department of Military Affairs, Indian Army Ministry of Defence",
    authorityAddress: "New Delhi – 110023",
    bidNumber: "GEM/2026/B/7431487",
    bidDate: "01-06-2026",
    productDescription: "Passive Blood Transportation Box Capacity 8 to 16 bags (MCBX-01), Passive Blood transportation Box Capacity 20 to 30 bags (MCBX-05), Active Blood transportation Box Capacity 20 to 30 bags (MACB-03)",
    companyName: "Mark Enterprises",
    companyAddress: "Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India",
    companyEmail: "info@markenworld.com",
    companyWebsite: "www.markenworld.com",
    companyContact: "09175559646 / 090111 04332",
    manufacturerName: "M/s. Mark Enterprises",
    manufacturerAddress: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
    signatoryName: "Korra Praveen Naik",
    signatoryDesignation: "Partner",
    signatoryAddress: "1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, District: Hyderabad, State: Andhra Pradesh, PIN Code: 500062",
    witnessDetails: "Mr. Shreedhar Shingare (Cell No.: 09011104332)",
    localContentPercentage: "100%",
    localContentLocation: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
    preferencePolicy: "PPP MII 2017",
    warrantyPeriod: "Five (5) years",
    serviceSupportPeriod: "Five (5) years",
    sparesAvailabilityPeriod: "Ten (10) years",
    place: "Nashik"
  };

  try {
    const response = await axios.post(url, mockPayload, { timeout: 15000 });
    console.log("Response Status:", response.status);
    console.log("Response Data:", response.data);

    if (response.data?.success) {
      console.log("\nSUCCESS: Bid Documents generated!");
      console.log("Download URL:", response.data.downloadUrl);
      console.log("New Status in DB:", response.data.status);
      
      const absolutePath = path.join(__dirname, '..', 'public', response.data.downloadUrl);
      if (fs.existsSync(absolutePath)) {
        const stats = fs.statSync(absolutePath);
        console.log(`Verified local file size: ${(stats.size / 1024).toFixed(1)} KB.`);
      } else {
        console.error("FAIL: File was not written to public documents folder!");
      }
    } else {
      console.error("FAIL: API returned failure response.");
    }
  } catch (error) {
    console.error("Error running test:", error.response?.data || error.message);
  }
}

runTest();
