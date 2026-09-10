const axios = require('axios');
const cheerio = require('cheerio');

async function getCredentials() {
  const mainUrl = "https://bidplus.gem.gov.in/all-bids";
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.google.com/'
  };
  const mainPageRes = await axios.get(mainUrl, { headers, timeout: 10000 });
  const cookies = mainPageRes.headers['set-cookie'] || [];
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
  return cookieHeader;
}

async function testUrls() {
  try {
    const cookies = await getCredentials();
    console.log("Cookies Negotiated.");

    // RA ID from EXAMINATION TABLE tender
    const raId = "9490839";
    const urls = [
      `https://bidplus.gem.gov.in/showraDocument/${raId}`,
      `https://bidplus.gem.gov.in/showradocument/${raId}`,
      `https://bidplus.gem.gov.in/showRaDocument/${raId}`,
      `https://bidplus.gem.gov.in/showRadocument/${raId}`,
      `https://bidplus.gem.gov.in/showbidDocument/${raId}`,
      `https://bidplus.gem.gov.in/showBidDocument/${raId}`,
      `https://bidplus.gem.gov.in/showra/${raId}`,
      `https://bidplus.gem.gov.in/showRa/${raId}`,
      `https://bidplus.gem.gov.in/showraDocument/9492783`,
      `https://bidplus.gem.gov.in/showradocument/9492783`
    ];

    for (const url of urls) {
      try {
        const res = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Cookie': cookies
          },
          timeout: 5000
        });
        console.log(`URL: ${url} -> Status: ${res.status}, Length: ${res.data ? res.data.length : 0}, Content-Type: ${res.headers['content-type']}`);
      } catch (err) {
        console.log(`URL: ${url} -> Failed: ${err.message} (Status: ${err.response ? err.response.status : 'None'})`);
      }
    }
  } catch (err) {
    console.error("General error:", err.message);
  }
}

testUrls();
