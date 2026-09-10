const fs = require('fs');

const code = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

// Find imports at the top or look for occurrences of "C=" or "C = " or "s("
// Let's search for where C is defined.
// Often it's defined like "var C = s(xxxxx)" or "let C = ..."
// Let's find occurrences of ",C=" or " C=" or "C=s(" or "C=n("
let regex = /[,\s{}]C\s*=\s*[a-zA-Z0-9_$.]+\([0-9]+\)/g;
let match;
while ((match = regex.exec(code)) !== null) {
  console.log(`Found definition of C: ${match[0]} at index ${match.index}`);
  const start = Math.max(0, match.index - 100);
  const end = Math.min(code.length, match.index + 200);
  console.log(code.substring(start, end));
}

// Let's search for all functions or objects assigned to C.R or C.M
// E.g. "C.R=" or "R:" or "M:"
// Let's search for "R=" or "M=" or "R:" inside the module C
// Wait, C might be an imported module like s(12345)
// Let's find where "s(54321)" (or whatever number C is) is defined in the file.
// Or we can search for the literal string "R=async" or "R=function" or "M=async"
const searchStrings = ['C.R', 'C.M', '.M =', '.R =', 'R:async', 'M:async'];
searchStrings.forEach(s => {
  let idx = code.indexOf(s);
  if (idx !== -1) {
    console.log(`Found occurrence of ${s} at index ${idx}`);
    console.log(code.substring(idx - 100, idx + 300));
  }
});
