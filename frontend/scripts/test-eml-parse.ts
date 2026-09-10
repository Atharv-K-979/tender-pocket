import { simpleParser } from 'mailparser';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { extractTenderLinks, scrapeTender } from '../src/lib/scraper';

const rawEml = `Delivered-To: anuthibhansali@gmail.com
Received: by 2002:a05:6358:b3d6:b0:299:8a05:3360 with SMTP id pb22csp789509rwc;
        Sat, 23 May 2026 00:34:21 -0700 (PDT)
Subject: Fw: 38 New Tender/s, Blood Bank and Medical Cold Chain Equipment 22-May-26 (Noon) - Tender247
Content-Type: text/plain; charset="us-ascii"
Content-Transfer-Encoding: quoted-printable

________________________________
From: Tender247 Tender Alert <admin@bidsnrfp.com>
Sent: Friday, May 22, 2026 2:12 PM
Subject: 38 New Tender/s, Blood Bank and Medical Cold Chain Equipment 22-Ma=
y-26 (Noon) - Tender247

1.      T247 ID : 99316347
corrigendum : supply of - refrigerated centrifuge - | quantity - 22<https:/=
=2/r.tenders.bidsnrfp.com/tr/cl/PoghfD9PPxTAxHlDekIXW9ovICA3RQzZP3XAtPu4kmVy=
ubR5KkpDRxMOMtDUaqQVPjMaMDZaOGQsq9srxflLwFg9Gchd1B_ACkSljdsTye9PVRtN7YWeMo9=
yEKE5CKjnul3Dl8n2cY9jBPs19JTsElTHw6TRobyZPMJV1biU6uJYbRMmBSnNBgJhVRL-ntOwvn=
5wcwa4ypkex9KfjX6oHSk3u9yR9YXXEACkmPyFl6FQDdyGDebtfmbXdPgmDF_9MIo-KGfmavI_z=
MJIiORa720QxceBRlalFPQADRLJoaUCU3JKhlz5cHlLmXCIMQj5ILvV-H-MtepXpfzCT0bfhkRn=
9yw_qumrpDRT94>
`;

function cleanQuotedPrintable(text: string): string {
  if (!text) return '';
  
  // 1. Remove soft line breaks (equal sign at end of line)
  let cleaned = text.replace(/=\r?\n/g, '');
  
  // 2. Decode standard quoted-printable equal signs (=3D -> =)
  cleaned = cleaned.replace(/=3D/gi, '=');
  
  // 3. Fix corrupted URL protocols like https:/=2/ or https:/=2F/ or https:/
  cleaned = cleaned.replace(/(https?):\/+(?:=[23][fFdD]\/|=[23]\/)?/gi, '$1://');
  
  return cleaned;
}

async function run() {
  console.log("Parsing raw EML text with mailparser...");
  const parsed = await simpleParser(rawEml);
  const rawBody = parsed.text || '';
  
  console.log("\nCleaning body text...");
  const body = cleanQuotedPrintable(rawBody);
  
  console.log("\nDecoded & Cleaned Body:");
  console.log(body);
  
  // Find where "https:/" is in body and print its exact characters and codes
  const start = body.indexOf('https:/');
  if (start !== -1) {
    const end = body.indexOf('>', start);
    const url = body.substring(start, end !== -1 ? end : start + 300);
    console.log(`\nURL text between brackets: "${url}"`);
    console.log("Length:", url.length);
    console.log("Char codes:", Array.from(url).map(c => c.charCodeAt(0)).join(', '));
    
    // Test matching on this extracted URL directly
    const testRegex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:tender24(?:7|by7)|bidsnrfp)\.[a-zA-Z]{2,6}\/[^\s"'>)]+/gi;
    console.log("Matches url directly:", url.match(testRegex));
  } else {
    console.log("\n'https:/' was not found in the body!");
  }
  
  console.log("\nExtracting links...");
  const links = extractTenderLinks(body);
  console.log("Found links:", links);
  
  if (links.length === 0) {
    console.error("No links found!");
    return;
  }
  
  console.log("\nTesting scraping for the first link:", links[0]);
  const details = await scrapeTender(links[0]);
  console.log("\nScraped Details Result:");
  console.log(JSON.stringify(details, null, 2));
}

run().catch(console.error);
