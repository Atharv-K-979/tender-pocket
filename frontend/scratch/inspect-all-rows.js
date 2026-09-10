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
      
      const $ = cheerio.load(html);
      
      const table = $('table').filter((_, el) => {
        return $(el).find('td:contains("TENDER DETAILS")').length > 0;
      }).first();
      
      console.log('Found details table. Total rows:', table.find('tr').length);
      
      table.find('tr').each((i, tr) => {
        const cells = $(tr).children('td');
        const text = $(tr).text().replace(/\s+/g, ' ').trim();
        console.log(`Row #${i}: Cells: ${cells.length} | Text: ${text.substring(0, 120)}...`);
      });
      
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

run().catch(console.error);
