import axios from 'axios';

async function testRSC() {
  const url = "https://www.tender247.com/auth/tender/100575724/b9447510-de95-46e0-b8cb-01ffd815155e/1003059";
  
  console.log("Fetching RSC payload for URL:", url);
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.tender247.com/',
        'Cache-Control': 'max-age=0',
        'RSC': '1' // Next.js React Server Component header
      }
    });

    const data = response.data;
    console.log("RSC Data Length:", data.length);
    
    // Search for keywords
    const keywords = ["maintenance", "hvac", "Raipur", "Chhattisgarh", "1.44 Cr"];
    console.log("\nSearching for keywords in RSC stream:");
    for (const keyword of keywords) {
      const index = data.toLowerCase().indexOf(keyword.toLowerCase());
      console.log(`Keyword "${keyword}": ${index !== -1 ? `FOUND at index ${index}` : "NOT FOUND"}`);
      if (index !== -1) {
        console.log(`Snippet: "${data.substring(Math.max(0, index - 80), Math.min(data.length, index + 120))}"\n`);
      }
    }
  } catch (err: any) {
    console.error("RSC fetch failed:", err.message);
  }
}

testRSC().catch(console.error);
