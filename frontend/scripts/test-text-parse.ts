import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';

interface EmailTender {
  id: string;
  url: string;
  title: string;
  authority?: string;
  location?: string;
  estimated_cost_raw?: string;
  due_date?: string;
}

function parseTendersFromEmailText(text: string): EmailTender[] {
  if (!text) return [];

  const tenders: EmailTender[] = [];
  const lines = text.split(/\r?\n/).map(line => line.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\d+\.\s+T247\s+ID\s*:\s*(\d+)/i);
    if (match) {
      const id = match[1];
      
      let url = '';
      let title = '';
      let authority = '';
      let location = '';
      let costRaw = '';
      let dueDateRaw = '';

      let lineOffset = 1;
      const detailLines: string[] = [];
      
      while (i + lineOffset < lines.length) {
        const nextLine = lines[i + lineOffset];
        if (nextLine.match(/^\d+\.\s+T247\s+ID\s*:/i) || nextLine.toLowerCase().includes('click here to view all') || nextLine.toLowerCase().includes('to receive whatsapp')) {
          break;
        }
        detailLines.push(nextLine);
        lineOffset++;
      }

      const activeLines = detailLines.map(l => l.trim()).filter(Boolean);

      if (activeLines.length > 0) {
        const titleLine = activeLines[0];
        
        const urlMatch = titleLine.match(/<*(https?:\/\/[^\s>]+)>*/i);
        if (urlMatch) {
          url = urlMatch[1];
          title = titleLine.replace(urlMatch[0], '').replace(/[<>]/g, '').trim();
        } else {
          title = titleLine;
        }

        if (!url && activeLines.length > 1) {
          const nextLine = activeLines[1];
          const urlMatch2 = nextLine.match(/<*(https?:\/\/[^\s>]+)>*/i);
          if (urlMatch2) {
            url = urlMatch2[1];
            activeLines.splice(1, 1);
          }
        }

        if (!url) {
          for (let j = 1; j < activeLines.length; j++) {
            const urlMatch3 = activeLines[j].match(/<*(https?:\/\/[^\s>]+)>*/i);
            if (urlMatch3) {
              url = urlMatch3[1];
              activeLines.splice(j, 1);
              break;
            }
          }
        }

        if (activeLines.length > 1) {
          authority = activeLines[1];
        }
        if (activeLines.length > 2) {
          location = activeLines[2];
        }
        if (activeLines.length > 3) {
          costRaw = activeLines[3];
        }
        if (activeLines.length > 4) {
          dueDateRaw = activeLines[4];
        }
      }

      if (id && url) {
        tenders.push({
          id,
          url,
          title: title || `Tender ${id}`,
          authority: authority || undefined,
          location: location || undefined,
          estimated_cost_raw: costRaw || undefined,
          due_date: dueDateRaw || undefined
        });
      }

      i += lineOffset - 1;
    }
  }

  return tenders;
}

async function test() {
  const emlPath = path.join(__dirname, 'test-email.eml');
  const emlContent = fs.readFileSync(emlPath, 'utf8');
  const parsed = await simpleParser(emlContent);

  const text = parsed.text || '';
  console.log("Parsing from plain text...");
  const tenders = parseTendersFromEmailText(text);

  console.log(`Parsed ${tenders.length} tenders from EML text directly:`);
  tenders.forEach((t, idx) => {
    console.log(`\nTender #${idx + 1}:`);
    console.log(`- ID: ${t.id}`);
    console.log(`- URL: ${t.url.substring(0, 80)}...`);
    console.log(`- Title: ${t.title}`);
    console.log(`- Authority: ${t.authority}`);
    console.log(`- Location: ${t.location}`);
    console.log(`- Cost Raw: ${t.estimated_cost_raw}`);
    console.log(`- Due Date Raw: ${t.due_date}`);
  });
}

test().catch(console.error);
