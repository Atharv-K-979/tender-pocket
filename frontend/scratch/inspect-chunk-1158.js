const fs = require('fs');

const content = fs.readFileSync('scratch/chunk_1158_ok.js', 'utf8');

// Let's find defaults. properties
let idx = 0;
while ((idx = content.indexOf('DownloadURL', idx)) !== -1) {
  console.log(`Found "DownloadURL" at ${idx}:`);
  console.log(content.slice(idx - 100, idx + 200));
  idx += 11;
}

const terms = ['Download', 'download', 'document', 'DownloadGlobleResultUrl'];
terms.forEach(t => {
  let idx = 0;
  console.log(`\nSearching for "${t}":`);
  while ((idx = content.indexOf(t, idx)) !== -1) {
    console.log(`  Found at ${idx}: ${content.slice(idx - 50, idx + 100)}`);
    idx += t.length;
    if (idx > 15000) break; // limit
  }
});
