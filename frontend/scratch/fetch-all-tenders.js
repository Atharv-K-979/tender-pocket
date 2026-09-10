import { fetchTendersFromMailtendersKey } from '../src/lib/scraper';

async function run() {
  const key = "l0bojs ejxR2Sk cm3rfllj90yGzuSVse0LXErK0ej4=";
  console.log("Fetching all tenders from listing API for key:", key);
  try {
    const list = await fetchTendersFromMailtendersKey(key);
    console.log(`Successfully fetched ${list.length} tenders.`);
    list.forEach((t, i) => {
      console.log(`\n[Tender #${i + 1}] ID: ${t.id}`);
      console.log(`Title: ${t.title}`);
      console.log(`Highlighted text: ${t.highlighted_text}`);
      console.log(`URL: ${t.url}`);
    });
  } catch (err) {
    console.error("Failed to fetch list:", err);
  }
}

run().catch(console.error);
