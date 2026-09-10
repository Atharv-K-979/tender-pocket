const fs = require('fs');

const content = fs.readFileSync('scratch/chunk_1158_ok.js', 'utf8');

// Find all places where getEncryptkey is referenced in code (other than the definition)
let idx = 0;
console.log("Searching for references to getEncryptkey:");
while ((idx = content.indexOf('getEncryptkey', idx)) !== -1) {
  console.log(`Found reference at index ${idx}:`);
  console.log(content.slice(idx - 150, idx + 250));
  idx += 13;
}
