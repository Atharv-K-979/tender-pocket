import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';
import { parseMoneyValue, parseDateString } from '../src/lib/scraper';

interface EmailTender {
  id: string;
  url: string;
  title: string;
  authority?: string;
  location?: string;
  estimated_cost_raw?: string;
  due_date?: string;
}

function parseTendersFromEmailHtml(html: string): EmailTender[] {
  const $ = cheerio.load(html);
  const tenders: EmailTender[] = [];

  // Find the table that contains the header "TENDER DETAILS"
  const table = $('table').filter((_, el) => {
    return $(el).find('td:contains("TENDER DETAILS")').length > 0;
  }).first();

  if (table.length === 0) {
    console.log("Could not find table with TENDER DETAILS header.");
    return [];
  }

  // Find all rows in this table's tbody (skip headers if any)
  table.find('tbody > tr').each((trIdx, tr) => {
    const cells = $(tr).children('td');
    if (cells.length < 3) return;

    // Check if the first cell contains "T247 ID" or "T247 ID :"
    const cell1Text = $(cells[0]).text();
    if (!cell1Text.includes('T247 ID') && !cell1Text.includes('T247 ID :')) return;

    // Extract T247 ID
    let id = '';
    const label = $(cells[0]).find('label');
    if (label.length > 0) {
      id = label.text().trim();
    } else {
      const match = cell1Text.match(/T247\s+ID\s*:\s*(\d+)/i);
      if (match) id = match[1];
    }

    // Extract link and title
    const aTag = $(cells[0]).find('a');
    let url = '';
    let title = '';
    if (aTag.length > 0) {
      url = aTag.attr('href') || '';
      title = aTag.text().replace(/\s+/g, ' ').trim();
    }

    if (!id || !url) return;

    // Cell 2: Authority & Location
    const cell2 = cells[1];
    const boldTag = $(cell2).find('span[style*="font-weight:bold"], strong, b');
    let authority = '';
    if (boldTag.length > 0) {
      authority = boldTag.first().text().replace(/\s+/g, ' ').trim();
    } else {
      const lines = $(cell2).text().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 0) authority = lines[0];
    }

    let location = $(cell2).text().replace(authority, '').replace(/\s+/g, ' ').trim();
    location = location.replace(/^[:,\s\-]+/, '').replace(/[:,\s\-]+$/, '').trim();

    // Cell 3: Cost & Due Date
    const cell3Text = $(cells[2]).text().replace(/\s+/g, ' ').trim();
    const dateMatch = cell3Text.match(/(\d{1,2}[-/\s]\d{1,2}[-/\s]\d{4})/);
    let dueDateRaw = '';
    if (dateMatch) {
      dueDateRaw = dateMatch[1];
    }

    let costRaw = cell3Text.replace(dueDateRaw, '').trim();

    tenders.push({
      id,
      url,
      title,
      authority: authority || undefined,
      location: location || undefined,
      estimated_cost_raw: costRaw || undefined,
      due_date: dueDateRaw || undefined
    });
  });

  return tenders;
}

async function test() {
  const emlPath = path.join(__dirname, 'test-email.eml');
  const emlContent = fs.readFileSync(emlPath, 'utf8');
  const parsed = await simpleParser(emlContent);

  const html = parsed.html || '';
  const tenders = parseTendersFromEmailHtml(html);

  console.log(`Parsed ${tenders.length} tenders from EML table directly:`);
  tenders.forEach((t, idx) => {
    console.log(`\nTender #${idx + 1}:`);
    console.log(`- ID: ${t.id}`);
    console.log(`- URL: ${t.url.substring(0, 80)}...`);
    console.log(`- Title: ${t.title}`);
    console.log(`- Authority: ${t.authority}`);
    console.log(`- Location: ${t.location}`);
    console.log(`- Cost Raw: ${t.estimated_cost_raw} (Parsed: ${parseMoneyValue(t.estimated_cost_raw || null)})`);
    console.log(`- Due Date Raw: ${t.due_date} (Parsed: ${parseDateString(t.due_date || null)})`);
  });
}

test().catch(console.error);
