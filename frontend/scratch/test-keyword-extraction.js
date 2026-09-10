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
const { cleanQuotedPrintable } = require('../src/lib/scraper');

const host = process.env.IMAP_HOST || 'imap.gmail.com';
const port = parseInt(process.env.IMAP_PORT || '993', 10);
const secure = process.env.IMAP_SECURE !== 'false';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;

function extractEmailKeywords(html) {
  if (!html) return [];
  const cleanHtml = cleanQuotedPrintable(html);
  const $ = cheerio.load(cleanHtml);
  const keywords = new Set();
  
  // Specific selectors for keyword highlights (e.g. orange font color="#ff9600")
  $('font[color="#ff9600"], font[color="orange"], span[style*="#ff9600"], span[style*="rgb(255, 150, 0)"], span.highlight, mark').each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (text && text.length >= 3 && text.length <= 40) {
      const words = text.split(/[^a-zA-Z0-9-]/);
      for (const w of words) {
        const cleanWord = w.trim();
        if (cleanWord.length >= 3 && !['tender', 'corrigendum', 'date', 'view', 'click', 'here', 'fresh'].includes(cleanWord)) {
          keywords.add(cleanWord);
        }
      }
    }
  });
  
  return Array.from(keywords);
}

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
      
      const keywords = extractEmailKeywords(html);
      console.log('Extracted Keywords:', keywords);
      
      const targetTitle = "procurement and supply of laboratory equipment's for artificial insemination (ai) on pig for piu-ardd under tripura rural economic growth and services delivery project (tresp)- phase contrast microscope with stage warmer, bod incubator, water bath, dummy for semen collection, refrigerator, analytical weighing balance, polythene sealing machine/ heat sealer machine, photometer, autoclave, hot air oven, ph meter, ultrapure water filtration, laminar air flow, triple/double distilled water glass assembly";
      
      const matched = [];
      const lowerTitle = targetTitle.toLowerCase();
      for (const kw of keywords) {
        if (lowerTitle.includes(kw)) {
          matched.push(kw);
        }
      }
      console.log('Matched keywords in title:', matched);
      
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

run().catch(console.error);
