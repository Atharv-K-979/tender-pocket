import axios from 'axios';

async function testSearch() {
  const url = "https://r.tenders.bidsnrfp.com/tr/cl/DTsRQOZJfkCjz7IdvjnE7k9aBY3lLo3dq_Rxm-Hk3sgghdKeiEjuzgvCzmrHyNrmURdmyqWBI9WTuAEf1vvvEJe3T_ykoTkTwrlgNEpjOupE7E4elhocEmrmh9VGC3hksYOkXRnXoc_nJZk5LcXY2JKGaTTzKmNcFpRrmUjiSKkNPIZSgx1ClNg5GFd_Pe2HIt9hHl8fWMHL6y52Ax1qn5N6hXL3dEi8MN7DKoWZpFyUfA9K3Onq5OnECb8-1xbl0TX_3kpQZzngrEvuup9tSG3DwKwSJWPE0x9jPM2LE52XmlN6MCykV1LL9Rniyg9Um1p2dr2q4brcdnW2htzZiyqJio8-D0pJyQTMNw6D";
  
  console.log("Fetching URL:", url);
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.tender247.com/',
      'Cache-Control': 'max-age=0'
    }
  });

  const html = response.data;
  console.log("Total HTML Length:", html.length);

  const keywords = ["100575724", "maintenance", "hvac", "Raipur", "Chhattisgarh", "1.44 Cr"];
  
  console.log("\nSearching for keywords in raw HTML:");
  for (const keyword of keywords) {
    const index = html.toLowerCase().indexOf(keyword.toLowerCase());
    console.log(`Keyword "${keyword}": ${index !== -1 ? `FOUND at index ${index}` : "NOT FOUND"}`);
    if (index !== -1) {
      console.log(`Snippet around keyword: "${html.substring(Math.max(0, index - 50), Math.min(html.length, index + 100))}"\n`);
    }
  }
}

testSearch().catch(console.error);
