const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

let idx = 0;
console.log("Searching for references to document_path in tender-page-chunk.js:");
while ((idx = content.indexOf('document_path', idx)) !== -1) {
  console.log(`Found reference at index ${idx}:`);
  console.log(content.slice(idx - 100, idx + 300));
  idx += 13;
}
