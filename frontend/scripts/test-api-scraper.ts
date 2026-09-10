import axios from 'axios';
import * as cheerio from 'cheerio';
import { parseMoneyValue, parseDateString } from '../src/lib/scraper';

async function combinedScraper(url: string) {
  let id = '';
  try {
    const urlObj = new URL(url);
    id = urlObj.searchParams.get('id') || '';
    if (!id) {
      const pathParts = urlObj.pathname.split('/');
      id = pathParts[pathParts.length - 1] || '';
    }
  } catch (e) {
    id = Buffer.from(url).toString('base64').substring(0, 16);
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.tender247.com/',
      'Cache-Control': 'max-age=0'
    };

    const response = await axios.get(url, { headers, timeout: 10000 });
    const finalUrl = response.request.res.responseUrl || response.config.url || url;
    const lowerFinalUrl = finalUrl.toLowerCase();

    console.log("Resolved Final URL:", finalUrl);

    // Check if it's the new SPA layout
    if (lowerFinalUrl.includes('/auth/tender/')) {
      console.log("Detected Next.js SPA details page. Querying backend APIs...");
      
      // Parse route parameters: /auth/tender/[id]/[securityCode]/[userId]
      const urlObj = new URL(finalUrl);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      const tenderIndex = pathParts.indexOf('tender');
      if (tenderIndex === -1 || pathParts.length <= tenderIndex + 2) {
        throw new Error(`Failed to parse parameters from path: ${urlObj.pathname}`);
      }

      const tenderId = pathParts[tenderIndex + 1];
      const securityCode = pathParts[tenderIndex + 2];
      
      console.log(`Extracted parameters - Tender ID: ${tenderId}, Security Code: ${securityCode}`);

      const apiHeaders = {
        'Referer': 'https://www.tender247.com/',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': headers['User-Agent']
      };

      // 1. Fetch details
      const detailRes = await axios.post(
        `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/${tenderId}`,
        { guest_user_id: 0, security_code: securityCode, ip: "" },
        { headers: apiHeaders }
      );

      if (!detailRes.data?.Success || !detailRes.data.Data?.[0]) {
        throw new Error(`API returned failure for tender details: ${JSON.stringify(detailRes.data)}`);
      }

      const tData = detailRes.data.Data[0];

      // 2. Fetch location
      let locationStr = '';
      try {
        const locRes = await axios.post(
          `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-sitelocation/${tenderId}`,
          {},
          { headers: apiHeaders }
        );
        const locData = locRes.data?.Data?.[0];
        if (locData) {
          const parts = [locData.city_name, locData.state_name].filter(Boolean);
          locationStr = parts.join(', ');
        }
      } catch (locErr: any) {
        console.warn("Failed to fetch sitelocation:", locErr.message);
      }

      // 3. Fetch document list
      let documentUrl = '';
      try {
        const docRes = await axios.post(
          `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`,
          {},
          { headers: apiHeaders }
        );
        const docs = docRes.data?.Data || [];
        // Look for the first document path
        if (docs.length > 0) {
          const docPath = docs[0].doc_path;
          if (docPath) {
            documentUrl = `https://documents.tender247.com/tender/download-document/${docPath}`;
          }
        }
      } catch (docErr: any) {
        console.warn("Failed to fetch document list:", docErr.message);
      }

      // Parse money values
      const estimatedCost = tData.tender_estimatedcost ? Number(tData.tender_estimatedcost) : null;
      const emd = tData.earnest_money_deposite ? Number(tData.earnest_money_deposite) : null;
      const docFee = tData.document_fees ? Number(tData.document_fees) : null;

      // Formatting dates: submission dates might be "DD-MM-YYYY" or similar, use parseDateString helper
      const dueDate = parseDateString(tData.tender_endsubmission_datetime);
      const openingDate = parseDateString(tData.tender_opening_datetime);

      return {
        id: String(tData.tender_id || tenderId),
        ref_no: tData.tender_number || null,
        title: tData.requirement_workbrief || tData.work_description || "Tender " + tenderId,
        authority: tData.organization_name || null,
        estimated_cost: estimatedCost,
        estimated_cost_raw: estimatedCost ? estimatedCost.toString() : null,
        emd: emd,
        emd_raw: emd ? emd.toString() : null,
        document_fee: docFee,
        document_fee_raw: docFee ? docFee.toString() : null,
        location: locationStr || null,
        sector: tData.nameof_website || null, // nameof_website is often source website, we can use it or fallback
        due_date: dueDate,
        opening_date: openingDate,
        document_url: documentUrl || null,
        original_url: url,
        scraped_at: new Date().toISOString()
      };
    } else {
      console.log("Detected standard HTML page. Running Cheerio parser...");
      // Existing Cheerio parsing code ...
      return {
        id,
        title: "Standard HTML scraped details placeholder",
        original_url: url,
        scraped_at: new Date().toISOString()
      };
    }
  } catch (error: any) {
    console.error(`Error scraping URL: ${url}`, error);
    return {
      id,
      title: `Failed to scrape: ${url}`,
      original_url: url,
      notes: `Failed: ${error.message}`
    };
  }
}

async function test() {
  const url = "https://r.tenders.bidsnrfp.com/tr/cl/DTsRQOZJfkCjz7IdvjnE7k9aBY3lLo3dq_Rxm-Hk3sgghdKeiEjuzgvCzmrHyNrmURdmyqWBI9WTuAEf1vvvEJe3T_ykoTkTwrlgNEpjOupE7E4elhocEmrmh9VGC3hksYOkXRnXoc_nJZk5LcXY2JKGaTTzKmNcFpRrmUjiSKkNPIZSgx1ClNg5GFd_Pe2HIt9hHl8fWMHL6y52Ax1qn5N6hXL3dEi8MN7DKoWZpFyUfA9K3Onq5OnECb8-1xbl0TX_3kpQZzngrEvuup9tSG3DwKwSJWPE0x9jPM2LE52XmlN6MCykV1LL9Rniyg9Um1p2dr2q4brcdnW2htzZiyqJio8-D0pJyQTMNw6D";
  const result = await combinedScraper(url);
  console.log("\nScrape Result:");
  console.log(JSON.stringify(result, null, 2));
}

test().catch(console.error);
