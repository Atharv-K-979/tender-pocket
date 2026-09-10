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
      console.log(`Removing \\Seen flag from UID ${uid}...`);
      await client.messageFlagsRemove({ uid }, ['\\Seen']);
      
      const msg = await client.fetchOne(uid, { flags: true });
      console.log(`New flags for UID ${uid}: ${JSON.stringify(Array.from(msg.flags))}`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

run().catch(console.error);
