const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

const index = content.indexOf('/T247TenderAI/api/pdf-download');
if (index !== -1) {
  console.log("Found pdf-download at", index);
  console.log(content.slice(index - 500, index + 1000));
} else {
  console.log("pdf-download not found.");
}
