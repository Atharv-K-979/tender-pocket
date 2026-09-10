import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { extractTenderLinks } from '../src/lib/scraper';

async function testAll() {
  const emlPath = path.join(__dirname, 'test-email.eml');
  const emlContent = fs.readFileSync(emlPath, 'utf8');

  console.log("Parsing EML with mailparser...");
  const parsed = await simpleParser(emlContent);

  console.log("Email Subject:", parsed.subject);
  console.log("Email Date:", parsed.date);
  console.log("Has Text:", !!parsed.text);
  console.log("Has HTML:", !!parsed.html);

  console.log("\n--- EXTRACTING FROM PLAIN TEXT ---");
  const textLinks = extractTenderLinks(parsed.text || '');
  console.log(`Found ${textLinks.length} links in plain text:`);
  textLinks.forEach((link, idx) => console.log(`${idx + 1}: ${link}`));

  console.log("\n--- EXTRACTING FROM HTML ---");
  const htmlLinks = extractTenderLinks(parsed.html || '');
  console.log(`Found ${htmlLinks.length} links in HTML:`);
  htmlLinks.forEach((link, idx) => console.log(`${idx + 1}: ${link}`));

  // Test requesting all HTML links
  console.log("\n--- TESTING ALL HTML LINKS RESOLUTION ---");
  for (let i = 0; i < htmlLinks.length; i++) {
    const testLink = htmlLinks[i];
    console.log(`\nLink #${i + 1}: ${testLink}`);
    try {
      const response = await axios.get(testLink, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tender247.com/',
          'Cache-Control': 'max-age=0'
        },
        timeout: 10000
      });
      console.log("Response status:", response.status);
      console.log("Final URL:", response.request?.res?.responseUrl || response.config.url);
    } catch (err: any) {
      console.error("Resolution failed!");
      if (err.response) {
        console.error("Status:", err.response.status);
        console.error("Data sample:", err.response.data.substring ? err.response.data.substring(0, 200) : "No string data");
      } else {
        console.error("Error message:", err.message);
      }
    }
  }
}

testAll().catch(console.error);
