import axios from 'axios';
import * as cheerio from 'cheerio';
import { parseMoneyValue, parseDateString } from '../src/lib/scraper';

async function testRedirect() {
  const url = "https://r.tenders.bidsnrfp.com/tr/cl/PoghfD9PPxTAxHlDekIXW9ovICA3RQzZP3XAtPu4kmVyubR5KkpDRxMOMtDUaqQVPjMaMDZaOGQsq9srxflLwFg9Gchd1B_ACkSljdsTye9PVRtN7YWeMo9yEKE5CKjnul3Dl8n2cY9jBPs19JTsElTHw6TRobyZPMJV1biU6uJYbRMmBSnNBgJhVRL-ntOwvn5wcwa4ypkex9KfjX6oHSk3u9yR9YXXEACkmPyFl6FQDdyGDebtfmbXdPgmDF_9MIo-KGfmavI_zMJIiORa720QxceBRlalFPQADRLJoaUCU3JKhlz5cHlLmXCIMQj5ILvV-H-MtepXpfzCT0bfhkRn9yw_qumrpDRT94";

  console.log("Fetching URL:", url);
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=0'
      },
      timeout: 10000
    });

    const finalUrl = response.request.res.responseUrl || response.config.url || '';
    console.log("\nRedirected successfully!");
    console.log("Final URL:", finalUrl);
    console.log("Status Code:", response.status);

    const $ = cheerio.load(response.data);
    const title = $('h1').first().text().trim() || $('h2').first().text().trim() || $('title').first().text().trim();
    console.log("Page Header / Title:", title);

    // Let's print out some HTML snippets or cells containing key details to verify they exist
    console.log("\nSearching for fields in the page...");
    
    const getValueByLabel = (labels: string[]): string => {
      let value = '';
      for (const label of labels) {
        $(':contains("' + label + '")').each((_, el) => {
          const text = $(el).text().trim();
          const cleanText = text.toLowerCase().replace(/:/g, '').trim();
          const cleanLabel = label.toLowerCase().trim();
          
          if (cleanText === cleanLabel || cleanText.startsWith(cleanLabel)) {
            let sibling = $(el).next();
            if (sibling.length > 0) {
              value = sibling.text().trim();
              if (value) return false;
            }
            let parentSibling = $(el).parent().next();
            if (parentSibling.length > 0) {
              value = parentSibling.text().trim();
              if (value) return false;
            }
            let nextCol = $(el).closest('td, th, div').next();
            if (nextCol.length > 0) {
              value = nextCol.text().trim();
              if (value) return false;
            }
          }
        });
        if (value) break;
      }
      return value;
    };

    const t247Id = getValueByLabel(['T247 ID', 'Tender247 ID', 'T247 Ref No']);
    const refNo = getValueByLabel(['Reference No', 'Ref No', 'Tender ID', 'Tender No']);
    const estimatedCost = getValueByLabel(['Estimated Cost', 'Tender Value', 'Estimated Value', 'Tender Cost']);
    const authority = getValueByLabel(['Authority', 'Organization', 'Agency']);
    const location = getValueByLabel(['Location', 'State', 'City']);
    const dueDate = getValueByLabel(['Due Date', 'Closing Date', 'Submission Date']);

    console.log("Scraped T247 ID:", t247Id);
    console.log("Scraped Ref No:", refNo);
    console.log("Scraped Estimated Cost (Raw):", estimatedCost);
    console.log("Parsed Cost:", parseMoneyValue(estimatedCost));
    console.log("Scraped Authority:", authority);
    console.log("Scraped Location:", location);
    console.log("Scraped Due Date:", dueDate);
    console.log("Parsed Date:", parseDateString(dueDate));

  } catch (error) {
    console.error("Error fetching redirect URL:", error);
  }
}

testRedirect();
