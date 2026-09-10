const fs = require('fs');

const content = fs.readFileSync('scratch/chunk_1158_ok.js', 'utf8');

const index = content.indexOf('p={getEncryptkey:"/T247ApiTender/api/tender/auth/encrypt-data"');
if (index !== -1) {
  console.log("Found p definition at", index);
  console.log(content.slice(index, index + 2000));
}
