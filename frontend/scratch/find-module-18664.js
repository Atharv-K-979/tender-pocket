const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

const targets = ['18664:', '18664:function', 'archiveApi:', 'archiveApi ='];
targets.forEach(t => {
  const index = content.indexOf(t);
  if (index !== -1) {
    console.log(`Found "${t}" at index ${index}`);
    console.log(content.slice(index, index + 1000));
  }
});
