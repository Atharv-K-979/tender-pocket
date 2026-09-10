import axios from 'axios';
import * as cheerio from 'cheerio';

async function listScripts() {
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
  const scripts: string[] = [];
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) scripts.push(src);
  });

  console.log("\nScript tags:");
  scripts.forEach((src, idx) => console.log(`${idx + 1}: ${src}`));
}

listScripts().catch(console.error);
