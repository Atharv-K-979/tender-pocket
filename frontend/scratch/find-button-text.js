const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

const searchTerms = [
  'Download All',
  'Download all',
  'download-all',
  'DownloadAll',
  'downloadAll',
  'downloadZip',
  'download-zip',
  'zip'
];

searchTerms.forEach(term => {
  let idx = 0;
  console.log(`\nSearching for "${term}":`);
  while ((idx = content.indexOf(term, idx)) !== -1) {
    console.log(`Found at ${idx}:`);
    console.log(content.slice(Math.max(0, idx - 100), Math.min(content.length, idx + 200)));
    idx += term.length;
    if (idx > 100000) break; // limit
  }
});
