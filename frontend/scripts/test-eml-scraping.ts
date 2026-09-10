import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';
import { extractTenderLinks, scrapeTender } from '../src/lib/scraper';

async function testE2E() {
  const emlPath = path.join(__dirname, 'test-email.eml');
  const emlContent = fs.readFileSync(emlPath, 'utf8');

  console.log("Parsing EML with mailparser...");
  const parsed = await simpleParser(emlContent);

  // Extract from HTML which has the full valid links
  const links = extractTenderLinks(parsed.html || '');
  console.log(`Found ${links.length} links in HTML:`);
  
  // Filter for links that are actual redirects (start with /tr/cl/)
  const tenderLinks = links.filter(l => l.includes('/tr/cl/'));
  console.log(`Filtered down to ${tenderLinks.length} potential tender/redirect links.`);

  console.log("\n--- SCRAPING POTENTIAL TENDER LINKS ---");
  for (let i = 0; i < tenderLinks.length; i++) {
    const link = tenderLinks[i];
    console.log(`\nProcessing Link #${i + 1}: ${link}`);
    const details = await scrapeTender(link);
    console.log("Scraped Result Summary:");
    console.log(`- ID: ${details.id}`);
    console.log(`- Title: ${details.title}`);
    console.log(`- Authority: ${details.authority}`);
    console.log(`- Cost: ${details.estimated_cost}`);
    console.log(`- Location: ${details.location}`);
    console.log(`- Document: ${details.document_url}`);
    console.log(`- Original URL: ${details.original_url}`);
    console.log(`- Notes/Error: ${details.notes || 'None'}`);
  }
}

testE2E().catch(console.error);
