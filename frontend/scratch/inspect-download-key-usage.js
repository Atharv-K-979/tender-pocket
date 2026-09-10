const fs = require('fs');

const content = fs.readFileSync('scratch/chunk_1158_ok.js', 'utf8');

let idx = 0;
console.log("Searching for references to downloadkey:");
while ((idx = content.indexOf('downloadkey', idx)) !== -1) {
  console.log(`Found reference at index ${idx}:`);
  console.log(content.slice(idx - 100, idx + 300));
  idx += 12;
}
