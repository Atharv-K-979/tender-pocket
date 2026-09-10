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

const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;
const apiUrl = process.env.TENDER_API_URL || 'http://localhost:3000/api/process-email';

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
      const uid = 74154;
      console.log(`Fetching message source for UID: ${uid}...`);
      let message = await client.fetchOne(uid, { source: true });
      
      if (!message || !message.source) {
        console.error(`Failed to fetch source for message UID: ${uid}`);
        return;
      }

      const emlString = message.source.toString('utf-8');
      console.log(`Sending message UID: ${uid} to scraping endpoint: ${apiUrl}...`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ emlString })
      });

      const result = await response.json();
      if (result.success) {
        console.log(`SUCCESS [UID ${uid}]: ${result.message}`);
        console.log(`Tenders Added:`, result.tendersAdded);
        console.log(`Tenders Updated:`, result.tendersUpdated);
        console.log(`Failed:`, result.failed);
      } else {
        console.error(`ERROR [UID ${uid}]:`, result.error || 'Unknown endpoint error');
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

run().catch(console.error);
