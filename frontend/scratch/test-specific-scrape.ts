import { scrapeTender } from '../src/lib/scraper';

async function test() {
  const url = "https://www.tender247.com/auth/tender/100647036/7EF013AF-68EB-489B-BF9E-B773AE6A7BC7?tesd=25-06-2026";
  console.log("Scraping specific URL:", url);
  try {
    const result = await scrapeTender(url);
    console.log("Scrape Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Scrape failed:", err);
  }
}

test().catch(console.error);
