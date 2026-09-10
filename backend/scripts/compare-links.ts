import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';
import { extractTenderLinks } from '../src/lib/scraper';

async function compare() {
  const emlPath = path.join(__dirname, 'test-email.eml');
  const emlContent = fs.readFileSync(emlPath, 'utf8');
  const parsed = await simpleParser(emlContent);

  const textLinks = extractTenderLinks(parsed.text || '');
  const htmlLinks = extractTenderLinks(parsed.html || '');

  console.log("Plain Text Link 4:");
  console.log(textLinks[3]); // index 3 is Link #4
  console.log("Length:", textLinks[3]?.length);

  console.log("\nHTML Link 4:");
  console.log(htmlLinks[3]);
  console.log("Length:", htmlLinks[3]?.length);

  if (textLinks[3] === htmlLinks[3]) {
    console.log("\nThey are identical!");
  } else {
    console.log("\nThey are DIFFERENT!");
    // Find where they diverge
    const len = Math.min(textLinks[3].length, htmlLinks[3].length);
    for (let i = 0; i < len; i++) {
      if (textLinks[3][i] !== htmlLinks[3][i]) {
        console.log(`Diverged at index ${i}:`);
        console.log(`Text: "...${textLinks[3].substring(i - 10, i + 20)}..."`);
        console.log(`HTML: "...${htmlLinks[3].substring(i - 10, i + 20)}..."`);
        break;
      }
    }
  }
}

compare().catch(console.error);
