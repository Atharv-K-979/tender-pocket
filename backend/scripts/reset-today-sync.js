const db = require('../src/lib/db').default;
const { ImapFlow } = require('imapflow');

const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;

async function reset() {
  console.log("1. Deleting 10 tenders from database...");
  const targetTenderIds = [
    '100325011', '100631612', '100261662', '100630397', '100639178',
    '99607749', '100640564', '100598836', '100649729', '100649746'
  ];
  
  for (const id of targetTenderIds) {
    db.prepare("DELETE FROM tenders WHERE id = ?").run(id);
  }
  console.log("Deleted matching tenders from DB.");

  console.log("2. Deleting processed email logs from database...");
  db.prepare("DELETE FROM processed_emails WHERE subject LIKE '%24-May-26%'").run();
  console.log("Deleted email logs from DB.");

  console.log("3. Connecting to IMAP to mark UIDs 73328 and 73329 as Unread...");
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
      await client.messageFlagsRemove({ uid: [73328, 73329] }, ['\\Seen']);
      console.log("Successfully marked UIDs 73328 and 73329 as Unread in IMAP.");
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

reset().catch(console.error);
