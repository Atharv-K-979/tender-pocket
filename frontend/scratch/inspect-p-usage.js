const fs = require('fs');

const content = fs.readFileSync('scratch/chunk_1158_ok.js', 'utf8');

// Find where p is used. Usually it looks like: something:function(...) { return something.post(p.getEncryptkey, ...) }
// Or maybe: getEncryptkey:function(e) { return something.post(p.getEncryptkey, e) }
const idx = content.indexOf('getEncryptkey:function');
if (idx !== -1) {
  console.log("Found getEncryptkey:function at", idx);
  console.log(content.slice(idx - 100, idx + 500));
} else {
  console.log("getEncryptkey:function not found.");
}

// Let's search for any occurrence of ".getEncryptkey" (e.g. p.getEncryptkey)
let index = 0;
while ((index = content.indexOf('.getEncryptkey', index)) !== -1) {
  console.log(`Found ".getEncryptkey" at ${index}:`);
  console.log(content.slice(index - 100, index + 300));
  index += 14;
}
