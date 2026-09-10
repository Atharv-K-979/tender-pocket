const fs = require('fs');
const path = require('path');

try {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    env.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        process.env[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    });
  }
} catch (e) {
  console.error("Failed to load .env:", e);
}

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');
const { extractViewAllLink, resolveKeyFromViewAllLink } = require('../src/lib/scraper');

const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;

async function run() {
  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: {
      user,
      pass: password
    },
    logger: false
  });

  await client.connect();
  try {
    let lock = await client.getMailboxLock('INBOX');
    try {
      console.log('Fetching UID 74154...');
      const msg = await client.fetchOne(74154, { source: true });
      const parsed = await simpleParser(msg.source);
      const html = parsed.html || '';
      
      const viewAllLink = await extractViewAllLink(html);
      console.log('View All Link:', viewAllLink);
      if (viewAllLink) {
        const key = await resolveKeyFromViewAllLink(viewAllLink);
        console.log('Resolved Key:', key);
      }
      
      // Let's dump all text to see if the tender brief we're looking for is in the email at all!
      const $ = cheerio.load(html);
      const textContent = $.text();
      console.log('Does email contain "artificial insemination" or "pig" or "tripura"?');
      console.log('Contains "artificial insemination":', textContent.toLowerCase().includes('artificial insemination'));
      console.log('Contains "pig":', textContent.toLowerCase().includes('pig'));
      console.log('Contains "tripura":', textContent.toLowerCase().includes('tripura'));
      console.log('Contains "refrigerator":', textContent.toLowerCase().includes('refrigerator'));
      
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

run().catch(console.error);
