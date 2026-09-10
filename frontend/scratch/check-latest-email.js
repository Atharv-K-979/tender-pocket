const { ImapFlow } = require('imapflow');

const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;
const senderFilter = process.env.hasOwnProperty('SENDER_FILTER') ? process.env.SENDER_FILTER : '';
const subjectFilter = process.env.hasOwnProperty('SUBJECT_FILTER') ? process.env.SUBJECT_FILTER : '';

if (!user || !password) {
  console.error('CRITICAL: IMAP_USER and IMAP_PASSWORD environment variables are required.');
  process.exit(1);
}

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

async function run() {
  console.log(`Connecting to IMAP mail server at ${host}:${port}...`);
  await client.connect();

  try {
    let lock = await client.getMailboxLock('INBOX');
    console.log('Inbox locked. Searching for matching emails...');
    
    try {
      const searchCriteria = {};
      if (subjectFilter) searchCriteria.subject = subjectFilter;
      if (senderFilter) searchCriteria.from = senderFilter;

      const messages = await client.search(searchCriteria);
      console.log(`Found ${messages.length} total matching emails.`);

      if (messages.length === 0) {
        console.log('No matching emails found.');
        return;
      }

      // Sort messages to get the latest one (highest UID)
      messages.sort((a, b) => b - a);
      const latestUid = messages[0];
      console.log(`\n--- LATEST EMAIL INFO ---`);
      console.log(`Latest UID: ${latestUid}`);

      // Fetch envelope and flags
      const meta = await client.fetchOne(latestUid, { envelope: true, flags: true, source: true });
      if (meta) {
        console.log(`Subject: ${meta.envelope.subject}`);
        console.log(`From: ${meta.envelope.from.map(f => `${f.name || ''} <${f.address}>`).join(', ')}`);
        console.log(`Date: ${meta.envelope.date}`);
        console.log(`Flags: ${JSON.stringify(meta.flags)}`);

        // Post raw EML to Next.js API to make sure we parse/sync this latest one
        const emlString = meta.source.toString('utf-8');
        const apiUrl = process.env.TENDER_API_URL || 'http://localhost:3000/api/process-email';
        console.log(`\nRe-processing / Syncing latest email (UID ${latestUid}) to scraping endpoint...`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ emlString })
        });

        const result = await response.json();
        console.log("API Response:", result);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('Error occurred:', err);
  } finally {
    await client.logout();
    console.log('Logged out.');
  }
}

run().catch(console.error);
