const fs = require('fs');

const jsContent = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

// Find archiveApi in the js file
const idx = jsContent.indexOf('archiveApi');
if (idx !== -1) {
  console.log("Found archiveApi at", idx);
  console.log(jsContent.substring(idx - 100, idx + 200));
}

// Let's find RouteUrls definition
const idxRoute = jsContent.indexOf('RouteUrls =');
if (idxRoute !== -1) {
  console.log("Found RouteUrls = at", idxRoute);
  console.log(jsContent.substring(idxRoute, idxRoute + 1000));
} else {
  // Try lowercase or property declaration
  const idxRouteProp = jsContent.indexOf('RouteUrls:');
  if (idxRouteProp !== -1) {
    console.log("Found RouteUrls: at", idxRouteProp);
    console.log(jsContent.substring(idxRouteProp - 100, idxRouteProp + 1000));
  }
}

// Let's print any occurrences of "RouteUrls" to see where it is defined
const regex = /RouteUrls\s*:\s*\{([^}]+)\}/gi;
let match;
while ((match = regex.exec(jsContent)) !== null) {
  console.log("RouteUrls Match:", match[0]);
}

const regex2 = /RouteUrls\s*=\s*\{([^}]+)\}/gi;
while ((match = regex2.exec(jsContent)) !== null) {
  console.log("RouteUrls= Match:", match[0]);
}

// Let's look for "archiveApi" values in other files in chunks/src if RouteUrls is imported from another chunk
// Wait, we can just search for RouteUrls in the entire file
const occ = [];
let index = jsContent.indexOf('RouteUrls');
while (index !== -1) {
  occ.push(index);
  index = jsContent.indexOf('RouteUrls', index + 1);
}
console.log(`Found ${occ.length} occurrences of RouteUrls`);
occ.slice(0, 10).forEach(o => {
  console.log(`At ${o}:`, jsContent.substring(o - 50, o + 150));
});
