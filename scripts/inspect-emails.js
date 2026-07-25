const { ImapFlow } = require('imapflow');

const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;

async function inspect() {
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
      console.log("Searching for last 20 messages in INBOX...");
      // Fetch status of the inbox
      const mailbox = await client.status('INBOX', { messages: true });
      console.log(`Total messages in Inbox: ${mailbox.messages}`);

      // Search for emails containing "Tender247" in subject
      const messages = await client.search({ subject: 'Tender247' });
      console.log(`Found ${messages.length} messages with subject 'Tender247'.`);

      for (const uid of messages.slice(-5)) {
        // Fetch envelope and flags
        const msg = await client.fetchOne(uid, { envelope: true, flags: true });
        console.log(`UID: ${uid}`);
        console.log(`- Subject: ${msg.envelope.subject}`);
        console.log(`- Flags: ${JSON.stringify(msg.flags)}`);
        console.log(`- Date: ${msg.envelope.date}`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

inspect().catch(console.error);
