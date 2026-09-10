const fs = require('fs');

const chunks = [
  'scratch/chunk_1158_ok.js',
  'scratch/chunk_9320.js',
  'scratch/tender-page-chunk.js'
];

chunks.forEach(chunk => {
  if (!fs.existsSync(chunk)) return;
  const content = fs.readFileSync(chunk, 'utf8');
  console.log(`\n=== Searching ${chunk} ===`);
  
  let idx = 0;
  while ((idx = content.indexOf('encrypt-data', idx)) !== -1) {
    console.log(`Found 'encrypt-data' at ${idx}:`);
    console.log(content.slice(idx - 150, idx + 250));
    idx += 12;
  }
});
