import axios from 'axios';

async function findApi() {
  const url = "https://www.tender247.com/auth/_next/static/chunks/app/page-a931939f4e686b36.js";
  
  console.log("Fetching JS chunk:", url);
  const response = await axios.get(url);
  const code = response.data;
  console.log("JS Chunk Length:", code.length);

  // Search for fetch, axios, or endpoints
  console.log("\nSearching for fetch/axios calls or API keywords:");
  const regexes = [
    /fetch\s*\(\s*["'`][^"'`]+["'`]/gi,
    /axios\s*\.\s*[a-z]+\s*\(\s*["'`][^"'`]+["'`]/gi,
    /\/api\/[a-zA-Z0-9_-]+/gi,
    /url\s*:\s*["'`][^"'`]+["'`]/gi,
    /method\s*:\s*["'`][a-zA-Z]+["'`]/gi
  ];

  for (const r of regexes) {
    let match;
    console.log(`\nMatches for ${r.toString()}:`);
    let count = 0;
    while ((match = r.exec(code)) !== null && count < 15) {
      console.log(`- ${match[0]}`);
      count++;
    }
  }

  // Let's search for some strings of interest
  const keywords = ["api", "tender", "detail", "get", "post", "http"];
  console.log("\nSearching for keywords:");
  for (const kw of keywords) {
    let count = 0;
    let idx = -1;
    while ((idx = code.toLowerCase().indexOf(kw, idx + 1)) !== -1 && count < 10) {
      console.log(`- "${kw}" found around: "${code.substring(Math.max(0, idx - 40), Math.min(code.length, idx + 60)).replace(/\n/g, ' ')}"`);
      count++;
    }
  }
}

findApi().catch(console.error);
