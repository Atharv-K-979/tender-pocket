const fs = require('fs');

const jsContent = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

function extract(keyword, length = 1500) {
  const index = jsContent.indexOf(keyword);
  if (index === -1) {
    console.log(`Keyword "${keyword}" not found.`);
    return;
  }
  const start = Math.max(0, index - 200);
  const end = Math.min(jsContent.length, index + length);
  console.log(`\n=== Snippet around "${keyword}" (index ${index}) ===`);
  console.log(jsContent.slice(start, end));
}

extract('tender-document-list', 1500);
extract('download', 1500);
