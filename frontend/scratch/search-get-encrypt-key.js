const fs = require('fs');

const chunks = [
  'scratch/chunk_9320.js',
  'scratch/tender-page-chunk.js',
  'scratch/chunk_1158_ok.js'
];

chunks.forEach(chunk => {
  if (!fs.existsSync(chunk)) return;
  const content = fs.readFileSync(chunk, 'utf8');
  console.log(`\n=== Searching ${chunk} ===`);
  
  let idx = 0;
  while ((idx = content.indexOf('getEncryptkey', idx)) !== -1) {
    console.log(`Found "getEncryptkey" at ${idx}:`);
    console.log(content.slice(idx - 100, idx + 300));
    idx += 13;
  }
});
