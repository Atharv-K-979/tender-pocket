import axios from 'axios';

async function findDownload() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/app/tender/%5B...tenderParams%5D/page-d64ea3d30cb5181c.js";
  
  console.log("Fetching Page JS chunk:", url);
  const response = await axios.get(url);
  const code = response.data;
  console.log("Page JS Chunk Length:", code.length);

  // Search for webpack module 41614
  console.log("\nSearching for module 41614:");
  // Look for "41614:" or "41614:function" or similar in webpack definition format
  let idx = code.indexOf('41614:');
  if (idx !== -1) {
    console.log(code.substring(idx, idx + 1500));
  } else {
    // Try other formats
    idx = -1;
    while ((idx = code.indexOf('41614', idx + 1)) !== -1) {
      console.log(`Found 41614 at index ${idx}: "${code.substring(idx - 50, idx + 100)}"`);
    }
  }
}

findDownload().catch(console.error);
