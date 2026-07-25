import axios from 'axios';
import * as cheerio from 'cheerio';

async function listInlineScripts() {
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
  $('script:not([src])').each((_, el) => {
    scripts.push($(el).text());
  });

  console.log(`\nFound ${scripts.length} inline scripts.`);
  
  // Find script containing "tender"
  const script8 = scripts.find(s => s.includes('tender') && s.length > 1000);
  if (script8) {
    console.log("\nScript #8 in full:");
    console.log(script8);
  } else {
    console.log("Could not find Script #8");
  }
}

listInlineScripts().catch(console.error);
