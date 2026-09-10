const fs = require('fs');

const content = fs.readFileSync('scratch/tender-page-chunk.js', 'utf8');

// Search for RouteUrls definition or keys
const keys = [
  'archiveApi',
  'globalArchiveDetail',
  'globalArchiveSiteLocation',
  'globalSimilerArchiveTender'
];

keys.forEach(k => {
  const index = content.indexOf(k);
  if (index !== -1) {
    console.log(`Found "${k}" at index ${index}`);
    // Print 100 characters around the index
    console.log(content.slice(Math.max(0, index - 50), Math.min(content.length, index + 250)));
  }
});

// Let's search for RouteUrls definition. Usually it looks like: RouteUrls = { ... } or RouteUrls:{ ... }
// Since it's a module, let's search for RouteUrls:
const routeUrlsIndex = content.indexOf('RouteUrls');
console.log("\nRouteUrls index:", routeUrlsIndex);
if (routeUrlsIndex !== -1) {
  // Let's search around RouteUrls
  console.log("Context around RouteUrls:");
  console.log(content.slice(Math.max(0, routeUrlsIndex - 100), Math.min(content.length, routeUrlsIndex + 500)));
}

// Let's find where the values of RouteUrls are assigned.
// E.g., we can search for the string "/apigateway/" or similar API path patterns.
const paths = ['/apigateway', 'archive', 'tender-detail'];
paths.forEach(p => {
  let idx = 0;
  console.log(`\nSearching for "${p}":`);
  while ((idx = content.indexOf(p, idx)) !== -1) {
    console.log(`  Found at ${idx}: ${content.slice(idx, idx + 100)}`);
    idx += p.length;
    if (idx > 50000) break; // limit results
  }
});
