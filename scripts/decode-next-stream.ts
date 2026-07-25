import axios from 'axios';
import * as cheerio from 'cheerio';

async function decodeStream() {
  const url = "https://www.tender247.com/auth/tender/100575724/b9447510-de95-46e0-b8cb-01ffd815155e/1003059";
  
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

  const $ = cheerio.load(response.data);
  let rscStream = "";

  $('script').each((_, el) => {
    const text = $(el).text();
    // Match self.__next_f.push([1, "chunk"]) or self.__next_f.push([1,"chunk"])
    // We want to extract the string chunk
    const matches = text.matchAll(/self\.__next_f\.push\(\[\d+,\s*"([\s\S]*?)"\]\)/g);
    for (const m of matches) {
      // Escape sequences in JS string literals
      let chunk = m[1];
      // Unescape double quotes and newlines
      chunk = chunk.replace(/\\"/g, '"')
                   .replace(/\\n/g, '\n')
                   .replace(/\\r/g, '\r')
                   .replace(/\\t/g, '\t')
                   .replace(/\\\\/g, '\\');
      rscStream += chunk;
    }
  });

  console.log("Full Decoded Next.js Stream Length:", rscStream.length);
  
  // Save full stream to file for analysis
  const outputPath = 'scripts/rsc-stream.txt';
  require('fs').writeFileSync(outputPath, rscStream, 'utf8');
  console.log(`Saved RSC stream to ${outputPath}`);

  // Search for keywords
  const keywords = ["maintenance", "hvac", "Raipur", "Chhattisgarh", "1.44 Cr", "all india institute"];
  console.log("\nSearching for keywords in reconstructed stream:");
  for (const keyword of keywords) {
    const index = rscStream.toLowerCase().indexOf(keyword.toLowerCase());
    console.log(`Keyword "${keyword}": ${index !== -1 ? `FOUND at index ${index}` : "NOT FOUND"}`);
    if (index !== -1) {
      console.log(`Snippet: "${rscStream.substring(Math.max(0, index - 80), Math.min(rscStream.length, index + 120)).replace(/\n/g, ' ')}"\n`);
    }
  }
}

decodeStream().catch(console.error);
