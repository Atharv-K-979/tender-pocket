const Database = require('better-sqlite3');
const { ImapFlow } = require('imapflow');
const path = require('path');

const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;

async function clearAndReset() {
  console.log("--- Resetting local Database ---");
  const dbPath = path.join(process.cwd(), 'tenders.db');
  const db = new Database(dbPath);
  
  db.prepare("DELETE FROM tenders").run();
  db.prepare("DELETE FROM processed_emails").run();
  db.prepare("DELETE FROM status_history").run();
  console.log("Deleted all rows from 'tenders', 'processed_emails', and 'status_history'.");
  db.close();

  if (!user || !password) {
    console.warn("IMAP credentials not found. Skipping IMAP unread reset.");
    return;
  }

  console.log("--- Resetting Email Seen Flags on IMAP ---");
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
      const uids = [73328, 73329, 73347, 74154, 74280];
      await client.messageFlagsRemove({ uid: uids }, ['\\Seen']);
      console.log(`Successfully marked UIDs ${uids.join(', ')} as Unread in IMAP.`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

clearAndReset().catch(console.error);
