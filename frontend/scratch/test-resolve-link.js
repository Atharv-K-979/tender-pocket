const axios = require('axios');

async function run() {
  const url = "https://r.tenders.bidsnrfp.com/tr/cl/WKFTNohw_CGQlwVV218igNts2m-0FS0E7nLPBhIsq5-wcgpqkt1mJ7o8aCjWE8wzzwTgtjO50vYwXi7BmNSc6spGkCafX2ZKrifsXXqy361mzzSgBrN_JBHj6PTkPA6j63UtkEvVw1cOV4XtLYZ8A-z1RLNDol5BbAKMhW-u_sOfedefLOTFgDBqj60Y4WtYrrxi9JBxsBSUQbeLsc_l8XUKP5QfCwip0tWOAkDQsoKmcs3GjpM1RYNXTIoUA6t4ZJNzGumpUk7pSdlkqNeyBnVe94PxCSBspSw8TeHDwiPLw-zSaqMI4QTV2N0WWXAoxH183712G1xu4lw_hmxgghUEBePb2SA_l47acD8o";
  console.log("Resolving URL:", url);
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://www.tender247.com/'
      }
    });
    console.log("Response URL:", response.request.res.responseUrl);
  } catch (err) {
    console.error("Resolve failed:", err);
  }
}

run().catch(console.error);
