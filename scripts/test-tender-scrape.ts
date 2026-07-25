import axios from 'axios';
import * as cheerio from 'cheerio';
import { scrapeTender } from '../src/lib/scraper';

async function testScrape() {
  const url = "https://r.tenders.bidsnrfp.com/tr/cl/DTsRQOZJfkCjz7IdvjnE7k9aBY3lLo3dq_Rxm-Hk3sgghdKeiEjuzgvCzmrHyNrmURdmyqWBI9WTuAEf1vvvEJe3T_ykoTkTwrlgNEpjOupE7E4elhocEmrmh9VGC3hksYOkXRnXoc_nJZk5LcXY2JKGaTTzKmNcFpRrmUjiSKkNPIZSgx1ClNg5GFd_Pe2HIt9hHl8fWMHL6y52Ax1qn5N6hXL3dEi8MN7DKoWZpFyUfA9K3Onq5OnECb8-1xbl0TX_3kpQZzngrEvuup9tSG3DwKwSJWPE0x9jPM2LE52XmlN6MCykV1LL9Rniyg9Um1p2dr2q4brcdnW2htzZiyqJio8-D0pJyQTMNw6D";
  
  console.log("Scraping URL:", url);
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.tender247.com/',
      'Cache-Control': 'max-age=0'
    }
  });

  const finalUrl = response.request.res.responseUrl || response.config.url || url;
  console.log("Final URL resolved to:", finalUrl);
  console.log("Response status:", response.status);

  const $ = cheerio.load(response.data);
  console.log("Cheerio page title:", $('title').text().trim());
  console.log("Cheerio h1 text:", $('h1').text().trim());
  console.log("Cheerio h2 text:", $('h2').text().trim());
  
  console.log("\nHTML Body snippet (first 1500 chars):");
  console.log(response.data.substring(0, 1500));
}

testScrape().catch(console.error);
