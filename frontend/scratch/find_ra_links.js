const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function findLinks() {
  const url = "https://bidplus.gem.gov.in/all-bids";
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  try {
    console.log("Fetching GeM listing page...");
    const res = await axios.get(url, { headers, timeout: 15000 });
    const $ = cheerio.load(res.data);
    
    // Save to temp file
    fs.writeFileSync('scratch/gem_all_bids.html', res.data);
    console.log("Saved HTML. Searching for PDF links...");

    const links = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (href && (href.includes('Document') || href.includes('doc') || href.includes('show') || href.includes('pdf'))) {
        links.push({ href, text });
      }
    });

    console.log(`Found ${links.length} matching links:`);
    console.log(JSON.stringify(links.slice(0, 30), null, 2));

    // Look for rows that have RA numbers (e.g. contain /R/)
    console.log("\nSearching for rows containing RA numbers...");
    $('.bid_no, td, div, p').each((_, el) => {
      const text = $(el).text();
      if (text.includes('/R/')) {
        console.log(`Found text containing RA: "${text.trim().substring(0, 150)}..."`);
        // Find parent container and locate links inside it
        const container = $(el).closest('div.border, tr, div.row, div.card');
        if (container.length > 0) {
          const containerLinks = [];
          container.find('a').each((_, a) => {
            containerLinks.push({ href: $(a).attr('href'), text: $(a).text().trim() });
          });
          console.log(`Links inside RA container:`, containerLinks);
        }
      }
    });

  } catch (err) {
    console.error("Error:", err.message);
  }
}

findLinks();
