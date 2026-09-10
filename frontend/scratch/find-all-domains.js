const fs = require('fs');

const content = fs.readFileSync('scratch/chunk_1158_ok.js', 'utf8');

// Regex to match URLs
const regex = /https?:\/\/[a-zA-Z0-9.\-_/]+/g;
const urls = new Set();
let match;
while ((match = regex.exec(content)) !== null) {
  urls.add(match[0]);
}

console.log("Found domains/URLs in chunk 1158:");
Array.from(urls).forEach(u => console.log(`- ${u}`));
