const fs = require('fs');

const content = fs.readFileSync('scratch/chunk_1158_ok.js', 'utf8');

let idx = 0;
console.log("Searching for 'encrypt' in chunk 1158:");
while ((idx = content.indexOf('encrypt', idx)) !== -1) {
  console.log(`Found 'encrypt' at ${idx}:`);
  console.log(content.slice(idx - 100, idx + 200));
  idx += 7;
}

// Let's also search for 'document_path' or 'documentPath'
idx = 0;
console.log("\nSearching for 'document_path' or 'documentPath' in chunk 1158:");
while ((idx = content.indexOf('document_path', idx)) !== -1) {
  console.log(`Found 'document_path' at ${idx}:`);
  console.log(content.slice(idx - 100, idx + 200));
  idx += 13;
}
while ((idx = content.indexOf('documentPath', idx)) !== -1) {
  console.log(`Found 'documentPath' at ${idx}:`);
  console.log(content.slice(idx - 100, idx + 200));
  idx += 12;
}
