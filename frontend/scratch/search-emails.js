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
      console.log('Searching for emails from anuthibhansali07@gmail.com...');
      const messages = await client.search({ from: 'anuthibhansali07@gmail.com' });
      console.log(`Found ${messages.length} message(s).`);

      for (const uid of messages) {
        const msg = await client.fetchOne(uid, { envelope: true, flags: true });
        console.log(`UID: ${uid} | Subject: "${msg.envelope.subject}" | Flags: ${JSON.stringify(Array.from(msg.flags))} | Date: ${msg.envelope.date}`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

run().catch(console.error);
