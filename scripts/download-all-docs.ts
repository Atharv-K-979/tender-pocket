import db from '../src/lib/db';
import { downloadAndSaveTenderDocuments } from '../src/lib/scraper';

async function main() {
  console.log("Fetching all tenders from SQLite database...");
  const tenders = db.prepare("SELECT id FROM tenders").all() as { id: string }[];
  console.log(`Found ${tenders.length} tenders. Starting document downloads...`);

  let count = 0;
  for (const t of tenders) {
    count++;
    console.log(`\n[${count}/${tenders.length}] Processing tender ID: ${t.id}`);
    try {
      const localUrl = await downloadAndSaveTenderDocuments(t.id);
      if (localUrl) {
        console.log(`--> SUCCESS: Downloaded main doc to ${localUrl}`);
      } else {
        console.log(`--> No documents found or download failed.`);
      }
    } catch (e: any) {
      console.error(`--> Error: ${e.message}`);
    }
    // Small sleep to be polite to the document server
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\nFinished downloading all tender documents.");
}

main().catch(console.error);
