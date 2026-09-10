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
      console.log('Fetching UID 74154 source...');
      const msg = await client.fetchOne(74154, { source: true });
      const parsed = await simpleParser(msg.source);
      
      const html = parsed.html || '';
      console.log('HTML length:', html.length);
      
      const $ = cheerio.load(html);
      
      // Let's print out all a tags in the TENDER DETAILS table
      const table = $('table').filter((_, el) => {
        return $(el).find('td:contains("TENDER DETAILS")').length > 0;
      }).first();
      
      console.log('Found details table:', table.length > 0);
      
      table.find('tbody > tr').each((i, tr) => {
        const cells = $(tr).children('td');
        if (cells.length < 3) return;
        const cell1Text = $(cells[0]).text();
        if (!cell1Text.includes('T247 ID') && !cell1Text.includes('T247 ID :')) return;
        
        const aTag = $(cells[0]).find('a');
        if (aTag.length > 0) {
          console.log(`\nTender #${i}:`);
          console.log(`Link: ${aTag.attr('href')}`);
          console.log(`Text: ${aTag.text().trim().substring(0, 100)}...`);
          console.log(`HTML snippet: ${aTag.html()}`);
        }
      });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

run().catch(console.error);
