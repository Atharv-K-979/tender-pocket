const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

const index = content.indexOf('Download All Documents');
if (index !== -1) {
  console.log("Found Download All Documents at", index);
  console.log(content.slice(index - 1000, index + 2000));
} else {
  console.log("Download All Documents not found.");
}
