const fs = require('fs');
const path = require('path');
const { extractBusinessMetadataFromHtml } = require('../src/lib/scraper');

const htmlPath = path.join(__dirname, '../public/documents/100638186/NIT_203163996.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

const meta = extractBusinessMetadataFromHtml(htmlContent, '100638186', 'test title');
console.log("Parsed Metadata:", meta);
