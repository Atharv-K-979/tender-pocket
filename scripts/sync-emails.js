const { ImapFlow } = require('imapflow');

// Read environment variables
const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;
const apiUrl = process.env.TENDER_API_URL || 'http://localhost:3000/api/process-email';
const senderFilter = process.env.hasOwnProperty('SENDER_FILTER') ? process.env.SENDER_FILTER : ''; // e.g. "sales@tender247.com"
const subjectFilter = process.env.hasOwnProperty('SUBJECT_FILTER') ? process.env.SUBJECT_FILTER : 'Tender247'; // search criteria subject

if (!user || !password) {
  console.error('CRITICAL: IMAP_USER and IMAP_PASSWORD environment variables are required.');
  console.error('Please configure them in your .env or .env.local file.');
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
  let retries = 3;
  let connected = false;
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Connecting to IMAP mail server at ${host}:${port}... (Attempt ${i + 1}/${retries})`);
      await client.connect();
      connected = true;
      break;
    } catch (err) {
      if (i === retries - 1) {
        console.error('An error occurred during IMAP connection setup:', err);
        throw err;
      }
      console.warn(`[Network Retry] IMAP connection failed: ${err.message}. Retrying in 10s...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }

  try {
    // Select Inbox
    let lock = await client.getMailboxLock('INBOX');
    console.log('Successfully locked INBOX. Searching for matching Tender247 emails...');
    
    try {
      // Build search query: search for unread emails
      const searchCriteria = {
        seen: false
      };
      
      if (subjectFilter) {
        searchCriteria.subject = subjectFilter;
      }
      
      if (senderFilter) {
        searchCriteria.from = senderFilter;
      }

      const messages = await client.search(searchCriteria);
      console.log(`Found ${messages.length} matching unread email message(s).`);

      if (messages.length === 0) {
        console.log('No new tender emails to process.');
        return;
      }

      for (const uid of messages) {
        console.log(`Fetching message UID: ${uid}...`);
        
        // Fetch raw message RFC822 source
        let message = await client.fetchOne(uid, { source: true });
        
        if (!message || !message.source) {
          console.error(`Failed to fetch source for message UID: ${uid}`);
          continue;
        }

        // Post raw EML string to Next.js API
        const emlString = message.source.toString('utf-8');
        
        console.log(`Sending message UID: ${uid} to scraping endpoint: ${apiUrl}...`);
        
        try {
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
            // Mark the email as read/seen since it has been successfully processed
            await client.messageFlagsAdd({ uid }, ['\\Seen']);
            console.log(`Message UID ${uid} marked as Seen.`);
          } else {
            console.error(`ERROR [UID ${uid}]:`, result.error || 'Unknown endpoint error');
          }
        } catch (fetchError) {
          console.error(`Fetch request failed for message UID ${uid}:`, fetchError.message);
        }
      }
    } finally {
      // Make sure to release lock
      lock.release();
    }
  } catch (err) {
    console.error('An error occurred during IMAP synchronization:', err);
  } finally {
    await client.logout();
    console.log('Logged out of IMAP mail server.');
  }
}

run().catch(console.error);
