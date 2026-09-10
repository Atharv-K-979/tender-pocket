const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

// Find where C is defined or imported in this chunk
// Typically it will be defined near the top of the function or imported via s(...)
// Let's search for C=s(...) or C = s(...) or similar
const matchIndex = content.indexOf('Download All Documents');

if (matchIndex !== -1) {
  // Let's search backwards from Download All Documents to find where C is declared
  const searchSlice = content.slice(Math.max(0, matchIndex - 8000), matchIndex);
  
  // Look for declarations of C
  const decls = [
    /C\s*=\s*s\(\d+\)/g,
    /C\s*=\s*i\(\d+\)/g,
    /C\s*=\s*[^,;]+/g,
    /var\s+C\s*=/g,
    /let\s+C\s*=/g,
    /const\s+C\s*=/g
  ];
  
  decls.forEach(regex => {
    let match;
    while ((match = regex.exec(searchSlice)) !== null) {
      console.log(`Matched declaration backward: "${match[0]}"`);
    }
  });

  // Print the first 2000 chars of searchSlice to inspect imports manually
  console.log("\nBackward context first 2000 chars:");
  console.log(searchSlice.slice(0, 2000));
}
