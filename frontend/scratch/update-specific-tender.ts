import { downloadAndSaveTenderDocuments } from '../src/lib/scraper';

async function main() {
  const tenderId = '100638186';
  console.log(`Processing specific tender: ${tenderId}`);
  const result = await downloadAndSaveTenderDocuments(tenderId);
  console.log(`Finished processing. Result: ${result}`);
}

main().catch(console.error);
