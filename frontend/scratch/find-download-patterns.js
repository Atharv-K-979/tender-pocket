const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

// Let's find all occurrences of "download" and print context
let idx = 0;
while ((idx = content.indexOf('download', idx)) !== -1) {
  console.log(`Found "download" at ${idx}:`);
  console.log(content.slice(Math.max(0, idx - 100), Math.min(content.length, idx + 200)));
  idx += 8;
  if (idx > 50000) break; // limit to first few hits
}
