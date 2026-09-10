import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import db, { Tender } from './db';
import JSZip from 'jszip';

// Clean common Quoted-Printable MIME formatting artifacts and repair protocols
export function cleanQuotedPrintable(text: string): string {
  if (!text) return '';
  
  // 1. Remove soft line breaks (equal sign at end of line)
  let cleaned = text.replace(/=\r?\n/g, '');
  
  // 2. Decode standard quoted-printable equal signs (=3D -> =)
  cleaned = cleaned.replace(/=3D/gi, '=');
  
  // 3. Fix corrupted URL protocols like https:/=2/ or https:/=2F/ or https:/
  cleaned = cleaned.replace(/(https?):\/+(?:=[23][fFdD]\/|=[23]\/)?/gi, '$1://');
  
  return cleaned;
}

// Clean HTML tags to return plain text
export function cleanHtmlTags(str: string): string {
  if (!str) return '';
  if (!str.includes('<') && !str.includes('>')) {
    return str;
  }
  try {
    const $ = cheerio.load(str);
    return $.text().replace(/\s+/g, ' ').trim();
  } catch (e) {
    return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

// Extract unique highlighted keywords from the email body HTML
export function extractEmailKeywords(html: string): string[] {
  if (!html) return [];
  const cleanHtml = cleanQuotedPrintable(html);
  const $ = cheerio.load(cleanHtml);
  const keywords = new Set<string>();
  
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

// Find matched keywords in the raw text/title
export function matchKeywordsInText(text: string, keywords: string[]): string {
  if (!text || !keywords || keywords.length === 0) return '';
  const lowerText = text.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matched.push(kw);
    }
  }
  return matched.join(', ');
}

// Extract highlighted text from HTML (Tender247 keyword matching)
export function extractHighlight(htmlString: string): string {
  if (!htmlString) return '';
  if (!htmlString.includes('<') && !htmlString.includes('>')) {
    return '';
  }
  try {
    const $ = cheerio.load(htmlString);
    const highlightedParts: string[] = [];
    $('span[style*="background"], span[style*="color"], span.highlight, strong, b, font, mark').each((_, el) => {
      highlightedParts.push($(el).text().trim());
    });
    if (highlightedParts.length > 0) {
      return highlightedParts.join(' ').replace(/\s+/g, ' ').trim();
    }
  } catch (e) {
    // Ignore
  }
  return '';
}

// Extract all Tender247 / Tender24by7 / bidsnrfp redirect URLs from text or HTML content
export function extractTenderLinks(content: string): string[] {
  if (!content) return [];
  
  // Clean raw email contents first to resolve line wraps and MIME encoding
  const cleanContent = cleanQuotedPrintable(content);
  
  const urls: string[] = [];
  
  // Matches tender247, tender24by7, and bidsnrfp domains with multiple subdomains and TLDs
  const regex = /https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:tender24(?:7|by7)|bidsnrfp)\.[a-zA-Z]{2,6}\/[^\s"'>)]+/gi;
  let match;
  
  while ((match = regex.exec(cleanContent)) !== null) {
    let url = match[0];
    
    // Clean up trailing punctuation
    url = url.replace(/[.,;:)\]]+$/, '');
    
    const lowerUrl = url.toLowerCase();
    
    // Accept standard tender details pages and email newsletter redirect trackers
    if (
      lowerUrl.includes('/detail') || 
      lowerUrl.includes('/tender') || 
      lowerUrl.includes('id=') ||
      lowerUrl.includes('/show') ||
      lowerUrl.includes('/tr/cl/')
    ) {
      if (!urls.includes(url)) {
        urls.push(url);
      }
    }
  }
  
  return urls;
}

// Helper to parse monetary values (e.g. "Rs. 5,00,000", "5.5 Lakhs", "2.1 Crore")
export function parseMoneyValue(rawVal: string | null): number | null {
  if (!rawVal) return null;
  
  const originalLower = rawVal.toLowerCase().trim();
  
  // If it clearly says Ref Document / Refer Tender Document / N.A. etc.
  if (originalLower.includes('refer') || originalLower.includes('document') || originalLower.includes('na') || originalLower.includes('n.a.')) {
    return null;
  }
  
  // Clean rawVal to keep only digits, commas, dots, and k/m/l/c letters
  let clean = originalLower.replace(/[^0-9.,kKlLcC\s]/g, '').trim();
  
  let multiplier = 1;
  if (originalLower.includes('crore') || originalLower.includes('cr')) {
    multiplier = 10000000;
  } else if (originalLower.includes('lakh') || originalLower.includes('lac') || originalLower.includes('lakhs') || originalLower.includes('lacs')) {
    multiplier = 100000;
  } else if (originalLower.includes('k') || originalLower.includes('thousand')) {
    multiplier = 1000;
  }
  
  // Extract the first number match starting with a digit
  const match = clean.match(/\d[\d,.]*/);
  if (!match) return null;
  
  // Remove commas and parse float
  const numericStr = match[0].replace(/,/g, '');
  const parsedNum = parseFloat(numericStr);
  
  if (isNaN(parsedNum)) return null;
  return parsedNum * multiplier;
}

// Helper to parse dates like "24-May-2026", "24/05/2026", "24-05-2026 15:00"
export function parseDateString(rawDate: string | null): string | null {
  if (!rawDate) return null;
  
  // Remove day names and leading/trailing non-alphanumeric punctuation
  let clean = rawDate
    .replace(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi, '')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/[^a-zA-Z0-9]+$/, '')
    .trim();

  // Prioritize DD-MM-YYYY or DD-Month-YYYY format
  const dmyMatch = clean.match(/^(\d{1,2})[-/\s](\d{1,2}|[a-zA-Z]{3,})[-/\s](\d{4})(?:\s+.*)?$/);
  if (dmyMatch) {
    const dayStr = dmyMatch[1].padStart(2, '0');
    const monthPart = dmyMatch[2];
    const yearStr = dmyMatch[3];
    
    let monthStr = '';
    if (/^\d+$/.test(monthPart)) {
      monthStr = monthPart.padStart(2, '0');
    } else {
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIdx = months.indexOf(monthPart.toLowerCase().substring(0, 3));
      if (monthIdx !== -1) {
        monthStr = String(monthIdx + 1).padStart(2, '0');
      }
    }
    
    if (monthStr) {
      return `${yearStr}-${monthStr}-${dayStr}`;
    }
  }
  
  // Try standard parsing
  const parsed = Date.parse(clean);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Split on delimiters fallback
  const parts = clean.split(/[-/\s]+/);
  if (parts.length >= 3) {
    let day = parseInt(parts[0], 10);
    let month: number | null = null;
    let year = parseInt(parts[2], 10);
    
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthStr = parts[1].toLowerCase().substring(0, 3);
    const monthIdx = months.indexOf(monthStr);
    
    if (monthIdx !== -1) {
      month = monthIdx;
    } else {
      month = parseInt(parts[1], 10) - 1; // 0-indexed
    }
    
    if (year < 100) {
      year += 2000;
    }
    
    if (!isNaN(day) && month !== null && !isNaN(month) && !isNaN(year)) {
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
  }
  
  return rawDate; // Fallback to raw string if we can't parse it
}

// Scrape a Tender247 tender details page
export async function scrapeTender(url: string): Promise<Partial<Tender>> {
  // Extract ID from URL query parameters (as fallback)
  let id = '';
  try {
    const urlObj = new URL(url);
    id = urlObj.searchParams.get('id') || '';
    if (!id) {
      // Try path-based ID e.g. /tender/details/123456
      const pathParts = urlObj.pathname.split('/');
      id = pathParts[pathParts.length - 1] || '';
    }
  } catch (e) {
    // If not a valid URL, make a hash of it
    id = Buffer.from(url).toString('base64').substring(0, 16);
  }
  
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.tender247.com/',
      'Cache-Control': 'max-age=0'
    };

    const response = await axios.get(url, {
      headers,
      timeout: 10000
    });

    const finalUrl = response.request.res.responseUrl || response.config.url || url;
    const lowerFinalUrl = finalUrl.toLowerCase();
    
    // Check if the final URL is a Next.js SPA tender details page on tender247 / tender24by7
    if (lowerFinalUrl.includes('/auth/tender/')) {
      // Parse route parameters: /auth/tender/[id]/[securityCode]/[userId]
      const urlObj = new URL(finalUrl);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      const tenderIndex = pathParts.indexOf('tender');
      if (tenderIndex === -1 || pathParts.length <= tenderIndex + 2) {
        throw new Error(`Failed to parse parameters from path: ${urlObj.pathname}`);
      }

      const tenderId = pathParts[tenderIndex + 1];
      const securityCode = pathParts[tenderIndex + 2];

      const apiHeaders = {
        'Referer': 'https://www.tender247.com/',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': headers['User-Agent']
      };

      // 1. Fetch details
      let detailRes;
      let isArchived = false;
      let tData = null;

      try {
        detailRes = await axios.post(
          `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/${tenderId}`,
          { guest_user_id: 0, security_code: securityCode, ip: "" },
          { headers: apiHeaders }
        );
        if (detailRes.data?.Success && detailRes.data.Data?.[0]) {
          tData = detailRes.data.Data[0];
        }
      } catch (err) {
        console.warn(`Regular details API failed for ${tenderId}:`, err);
      }

      if (!tData) {
        // Fallback to archive detail API
        const yearsToTry = [new Date().getFullYear(), new Date().getFullYear() - 1];
        for (const yr of yearsToTry) {
          try {
            console.log(`Trying archive detail API for tender ${tenderId} and year ${yr}...`);
            const archDetailRes = await axios.post(
              `https://t247_api.tender247.com/apigateway/T247ArchiveTenders/api/${yr}/tender-detail/${tenderId}`,
              { guest_user_id: 0, security_code: securityCode, ip: "", fullViewTender: true },
              { headers: apiHeaders }
            );
            if (archDetailRes.data?.Success && archDetailRes.data.Data?.[0]) {
              tData = archDetailRes.data.Data[0];
              isArchived = true;
              break;
            }
          } catch (archErr) {
            // ignore and try next year
          }
        }
      }

      if (!tData) {
        throw new Error(`API returned failure for tender details: ${tenderId}`);
      }

      // 2. Fetch location
      let locationStr = '';
      try {
        const locUrl = isArchived
          ? `https://t247_api.tender247.com/apigateway/T247ArchiveTenders/api/${new Date().getFullYear()}/tender-sitelocation/${tenderId}`
          : `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-sitelocation/${tenderId}`;
        const locRes = await axios.post(
          locUrl,
          {},
          { headers: apiHeaders }
        );
        const locData = locRes.data?.Data?.[0];
        if (locData) {
          const parts = [locData.city_name, locData.state_name].filter(Boolean);
          locationStr = parts.join(', ');
        }
      } catch (locErr) {
        console.warn("Failed to fetch sitelocation:", locErr);
      }

      // 3. Fetch document list
      let documentUrl = '';
      try {
        const docUrl = isArchived
          ? `https://t247_api.tender247.com/apigateway/T247ArchiveTenders/api/${new Date().getFullYear()}/tender-document-list/${tenderId}`
          : `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`;
        const docRes = await axios.post(
          docUrl,
          { guest_user_id: 0, security_code: securityCode, ip: "" },
          { headers: apiHeaders }
        );
        const docs = docRes.data?.Data || [];
        if (docs.length > 0) {
          const docPath = docs[0].doc_path || docs[0].document_path;
          if (docPath) {
            const isUncPath = docPath.startsWith('\\\\') || docPath.includes('\\');
            if (isUncPath) {
              documentUrl = `https://documents.tender247.com/tender/download-document-all/${encodeURIComponent(docPath)}`;
            } else {
              documentUrl = `https://documents.tender247.com/tender/download-document/${docPath}`;
            }
          }
        } else if (isArchived && tData.doc_path) {
          documentUrl = `https://documents.tender247.com/tender/download-document-all/${encodeURIComponent(tData.doc_path)}`;
        }
      } catch (docErr) {
        console.warn("Failed to fetch document list:", docErr);
      }

      const estimatedCost = tData.tender_estimatedcost ? Number(tData.tender_estimatedcost) : null;
      const emd = tData.earnest_money_deposite ? Number(tData.earnest_money_deposite) : null;
      const docFee = tData.document_fees ? Number(tData.document_fees) : null;

      const dueDate = parseDateString(tData.tender_endsubmission_datetime);
      const openingDate = parseDateString(tData.tender_opening_datetime);

      const rawTitle = tData.requirement_workbrief || tData.work_description || "Tender " + tenderId;
      const cleanTitle = cleanHtmlTags(rawTitle);
      const highlightedText = extractHighlight(rawTitle);

      return {
        id: String(tData.tender_id || tenderId),
        ref_no: tData.tender_number || null,
        title: cleanTitle,
        product_name_as_per_tender: highlightedText || undefined,
        authority: tData.organization_name || null,
        estimated_cost: estimatedCost,
        estimated_cost_raw: estimatedCost ? estimatedCost.toString() : null,
        emd: emd,
        emd_raw: emd ? emd.toString() : null,
        document_fee: docFee,
        document_fee_raw: docFee ? docFee.toString() : null,
        location: locationStr || null,
        sector: tData.nameof_website || null,
        due_date: dueDate,
        opening_date: openingDate,
        document_url: documentUrl || null,
        original_url: url,
        scraped_at: new Date().toISOString()
      };
    }

    // Check if the final URL is a valid legacy tender details page on tender247 / tender24by7
    const isTenderDetailsPage = 
      (lowerFinalUrl.includes('tender247.com') || lowerFinalUrl.includes('tender24by7.')) &&
      (lowerFinalUrl.includes('/detail') || lowerFinalUrl.includes('id=') || lowerFinalUrl.includes('/show'));

    if (!isTenderDetailsPage) {
      return {
        id: '',
        title: 'Utility/Non-Tender Link (Skipped)',
        original_url: url,
        notes: 'Skipped utility or list page'
      };
    }

    const $ = cheerio.load(response.data);
    
    // Helper to search cells for label and extract value from sibling/next-sibling
    const getValueByLabel = (labels: string[]): string => {
      let value = '';
      
      // We will look for elements matching labels
      for (const label of labels) {
        $(':contains("' + label + '")').each((_, el) => {
          const text = $(el).text().trim();
          
          // Match label exactly or with a trailing colon
          const cleanText = text.toLowerCase().replace(/:/g, '').trim();
          const cleanLabel = label.toLowerCase().trim();
          
          if (cleanText === cleanLabel || cleanText.startsWith(cleanLabel)) {
            // Case 1: Value is in the immediate next sibling element
            let sibling = $(el).next();
            if (sibling.length > 0) {
              value = sibling.text().trim();
              if (value) return false; // break cheerio loop
            }
            
            // Case 2: Value is in the parent's next sibling element (standard table row layout)
            let parentSibling = $(el).parent().next();
            if (parentSibling.length > 0) {
              value = parentSibling.text().trim();
              if (value) return false;
            }

            // Case 3: Inside a definition list, or flex container
            // Let's check parent's children or sibling's children
            let nextCol = $(el).closest('td, th, div').next();
            if (nextCol.length > 0) {
              value = nextCol.text().trim();
              if (value) return false;
            }
          }
        });
        if (value) break;
      }
      
      // Clean up values containing duplicates of labels (e.g. "T247 ID: 12345" -> "12345")
      for (const label of labels) {
        if (value.toLowerCase().startsWith(label.toLowerCase())) {
          value = value.substring(label.length).replace(/^[:\s\-]+/, '').trim();
        }
      }
      
      return value;
    };

    // Scraping fields based on common Tender247 HTML keys
    const scrapedId = getValueByLabel(['T247 ID', 'Tender247 ID', 'T247 Ref No']) || id;
    const ref_no = getValueByLabel(['Reference No', 'Ref No', 'Tender ID', 'Tender No', 'Reference Number', 'Ref. No.']);
    
    // Work description / Title
    let rawTitle = getValueByLabel(['Description', 'Work Description', 'Tender Title', 'Title of Work', 'Subject']);
    let highlightedText = '';
    
    if (rawTitle) {
      // Look for highlights in the cell next to the label
      $(':contains("Description"), :contains("Work Description"), :contains("Tender Title")').each((_, el) => {
        let cell = $(el).next();
        if (cell.length === 0) {
          cell = $(el).parent().next();
        }
        if (cell.length > 0) {
          highlightedText = extractHighlight(cell.html() || '');
          if (highlightedText) return false;
        }
      });
    } else {
      // Fallback: search for prominent headers
      const firstH1 = $('h1').first();
      rawTitle = firstH1.text().trim() || $('h2').first().text().trim() || '';
      highlightedText = extractHighlight(firstH1.html() || $('h2').first().html() || '');
    }

    const cleanTitle = cleanHtmlTags(rawTitle) || 'Tender details from page: ' + scrapedId;
    if (!highlightedText) {
      highlightedText = extractHighlight(rawTitle);
    }

    const authority = getValueByLabel(['Authority', 'Organization', 'Agency', 'Department', 'Procuring Entity', 'Client', 'State Govt', 'Ministry']);
    
    const estimated_cost_raw = getValueByLabel(['Estimated Cost', 'Tender Value', 'Estimated Value', 'Tender Cost', 'Cost of Work', 'Amount']);
    const estimated_cost = parseMoneyValue(estimated_cost_raw);
    
    const emd_raw = getValueByLabel(['EMD', 'Earnest Money Deposit']);
    const emd = parseMoneyValue(emd_raw);
    
    const document_fee_raw = getValueByLabel(['Document Cost', 'Tender Fee', 'Document Fee', 'Fee']);
    const document_fee = parseMoneyValue(document_fee_raw);
    
    const location = getValueByLabel(['Location', 'State', 'City', 'Place of Work', 'Region']);
    const sector = getValueByLabel(['Sector', 'Category', 'Industry', 'Sub Category']);
    
    const due_date_raw = getValueByLabel(['Due Date', 'Closing Date', 'Submission Date', 'Bid Submission End Date', 'End Date', 'Last Date of Submission']);
    const due_date = parseDateString(due_date_raw);
    
    const opening_date_raw = getValueByLabel(['Opening Date', 'Bid Opening Date']);
    const opening_date = parseDateString(opening_date_raw);
    
    // Find documents: search for <a> tags containing PDF or Download text
    let document_url = '';
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().toLowerCase();
      if (href && (href.endsWith('.pdf') || text.includes('download') || text.includes('nit') || text.includes('document'))) {
        try {
          document_url = new URL(href, url).toString();
          return false; // Break loop
        } catch (e) {
          // ignore invalid URLs
        }
      }
    });

    return {
      id: scrapedId || id,
      ref_no: ref_no || null,
      title: cleanTitle,
      product_name_as_per_tender: highlightedText || undefined,
      authority: authority || null,
      estimated_cost,
      estimated_cost_raw: estimated_cost_raw || null,
      emd,
      emd_raw: emd_raw || null,
      document_fee,
      document_fee_raw: document_fee_raw || null,
      location: location || null,
      sector: sector || null,
      due_date: due_date || null,
      opening_date: opening_date || null,
      document_url: document_url || null,
      original_url: url,
      scraped_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error scraping tender URL: ${url}`, error);
    // If request blocked, return partial object with ID and URL so user can see it failed but we saved the link
    return {
      id,
      title: `Blocked/Failed to scrape: ${url}`,
      original_url: url,
      notes: `Failed to scrape automatically. Error: ${error instanceof Error ? error.message : String(error)}`,
      scraped_at: new Date().toISOString()
    };
  }
}

export interface EmailTender {
  id: string;
  url: string;
  title: string;
  authority?: string;
  location?: string;
  estimated_cost_raw?: string;
  due_date?: string;
  ref_no?: string;
  emd_raw?: string;
  document_fee_raw?: string;
  highlighted_text?: string;
}

// Parse structured tenders directly from the HTML table inside Tender247 emails
export function parseTendersFromEmailHtml(html: string): EmailTender[] {
  if (!html) return [];
  
  // Clean QP MIME encoding first
  const cleanHtml = cleanQuotedPrintable(html);
  const $ = cheerio.load(cleanHtml);
  const tenders: EmailTender[] = [];

  // Find the table that contains the header "TENDER DETAILS"
  const table = $('table').filter((_, el) => {
    return $(el).find('td:contains("TENDER DETAILS")').length > 0;
  }).first();

  if (table.length === 0) {
    return [];
  }

  // Find all rows in this table's tbody (skip headers if any)
  table.find('tbody > tr').each((_, tr) => {
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
    let highlightedText = '';
    if (aTag.length > 0) {
      url = aTag.attr('href') || '';
      const rawTitleText = aTag.html() || '';
      title = cleanHtmlTags(aTag.text());
      highlightedText = extractHighlight(rawTitleText);
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
      highlighted_text: highlightedText || undefined,
      authority: authority || undefined,
      location: location || undefined,
      estimated_cost_raw: costRaw || undefined,
      due_date: dueDateRaw || undefined
    });
  });

  return tenders;
}

// Parse structured tenders directly from the plain text inside Tender247 emails (e.g. copy-pasted text)
export function parseTendersFromEmailText(text: string): EmailTender[] {
  if (!text) return [];

  // Clean QP MIME encoding first
  const cleanText = cleanQuotedPrintable(text);
  const tenders: EmailTender[] = [];
  const lines = cleanText.split(/\r?\n/).map(line => line.trim());

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

// Extract the "View All" redirect link from the email content
export async function extractViewAllLink(emailBody: string): Promise<string | null> {
  if (!emailBody) return null;
  const cleanBody = cleanQuotedPrintable(emailBody);
  
  // Try HTML parsing first using Cheerio
  try {
    const $ = cheerio.load(cleanBody);
    let viewAllHref = '';
    $('a').each((_, el) => {
      const text = $(el).text().toLowerCase();
      const href = $(el).attr('href');
      if (href && (text.includes('view all') || text.includes('fresh tenders'))) {
        viewAllHref = href;
        return false; // break loop
      }
    });
    if (viewAllHref) return viewAllHref;
  } catch (e) {
    // Ignore cheerio error
  }

  // Fallback to regex on plain text
  const regex = /view\s+all\s*(?:\(\d+\))?\s*(?:fresh\s+tenders)?\s*<*(https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:tender247|tender24by7|bidsnrfp)\.[a-zA-Z]{2,6}\/[^\s"'>\)]+)>*/gi;
  const match = regex.exec(cleanBody);
  if (match) {
    return match[1].replace(/[.,;:)\]]+$/, '');
  }

  return null;
}

// Resolve the "View All" tracking link to get the Next.js query key parameter
export async function resolveKeyFromViewAllLink(url: string): Promise<string | null> {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.tender247.com/'
    };
    
    const res = await axios.get(url, { headers, timeout: 8000, maxRedirects: 5 });
    const resolvedUrl = res.request.res.responseUrl || res.config.url || '';
    
    if (resolvedUrl.includes('key=')) {
      const urlObj = new URL(resolvedUrl);
      return urlObj.searchParams.get('key');
    }
  } catch (e) {
    console.error("Failed to resolve View All redirect link:", e);
  }
  return null;
}

// Fetch all tenders matching the query from the Tender247 search API using the query key
export async function fetchTendersFromMailtendersKey(key: string): Promise<EmailTender[]> {
  const normalizedKey = key.replace(/ /g, '+');
  const headers: any = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Referer': 'https://www.tender247.com/'
  };

  try {
    // 1. Authenticate with key
    const loginRes = await axios.post(
      "https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/login/user/key",
      { key: normalizedKey },
      { headers }
    );

    const loginData = loginRes.data?.Data?.[0];
    const token = loginData?.token;
    const userId = loginData?.user_id;
    const queryId = loginData?.user_query_id;
    const mailDate = loginData?.mail_date;

    if (!token || !userId || !queryId) {
      console.error("Authentication with key failed:", loginRes.data);
      return [];
    }

    headers['Authorization'] = `Bearer ${token}`;

    // 2. Fetch search count to know how many to request
    const countRes = await axios.post(
      "https://t247_api.tender247.com/apigateway/T247Tender/mail/api/tender/auth/tender-search-count",
      {
        tab_id: 1,
        tender_id: 0,
        tender_number: "",
        search_text: "",
        refine_search_text: "",
        tender_value_operator: 0,
        tender_value_from: 0,
        tender_value_to: 0,
        publication_date_from: "",
        publication_date_to: "",
        closing_date_from: "",
        closing_date_to: "",
        search_by_location: false,
        statezone_ids: "",
        city_ids: "",
        state_ids: "",
        organization_ids: "",
        organization_name: "",
        sort_by: 1,
        sort_type: 2,
        page_no: 1,
        record_per_page: 20,
        keyword_id: "",
        mfa: "",
        nameof_website: "",
        tender_typeid: 0,
        is_tender_doc_uploaded: false,
        user_id: userId,
        user_email_service_query_id: queryId,
        exact_search: false,
        exact_search_text: false,
        search_by_split_word: false,
        product_id: "",
        organization_type_id: "",
        sub_industry_id: "",
        search_by: 0,
        guest_user_id: 0,
        quantity: "",
        quantity_operator: 0,
        msme_exemption: 0,
        startup_exemption: 0,
        gem: 0,
        mail_date: mailDate,
        tab_status: 3,
        is_ai_summary: false,
        boq: 0,
        is_grace: false,
        surety_bond: false,
        limited_tender: false
      },
      { headers }
    );

    const totalTendersCount = countRes.data?.Data?.[0]?.tendercount || 50;

    // 3. Query all search results
    const searchRes = await axios.post(
      "https://t247_api.tender247.com/apigateway/T247Tender/mail/api/tender/auth/search-tender",
      {
        tab_id: 1,
        tender_id: 0,
        tender_number: "",
        search_text: "",
        refine_search_text: "",
        tender_value_operator: 0,
        tender_value_from: 0,
        tender_value_to: 0,
        publication_date_from: "",
        publication_date_to: "",
        closing_date_from: "",
        closing_date_to: "",
        search_by_location: false,
        statezone_ids: "",
        city_ids: "",
        state_ids: "",
        organization_ids: "",
        organization_name: "",
        sort_by: 1,
        sort_type: 2,
        page_no: 1,
        record_per_page: Math.max(totalTendersCount, 100),
        keyword_id: "",
        mfa: "",
        nameof_website: "",
        tender_typeid: 0,
        is_tender_doc_uploaded: false,
        user_id: userId,
        user_email_service_query_id: queryId,
        exact_search: false,
        exact_search_text: false,
        search_by_split_word: false,
        product_id: "",
        organization_type_id: "",
        sub_industry_id: "",
        search_by: 0,
        guest_user_id: 0,
        quantity: "",
        quantity_operator: 0,
        msme_exemption: 0,
        startup_exemption: 0,
        gem: 0,
        mail_date: mailDate,
        tab_status: 3,
        is_ai_summary: false,
        boq: 0,
        is_grace: false,
        surety_bond: false,
        limited_tender: false
      },
      { headers }
    );

    if (searchRes.data?.Success && searchRes.data.Data) {
      return searchRes.data.Data.map((t: any) => {
        // Construct the Next.js SPA URL for clicking
        const spaUrl = `https://www.tender247.com/auth/tender/${t.tender_id}/${t.security_code || ''}/${userId}`;
        
        const rawTitle = t.requirement_workbrief || t.work_description || `Tender ${t.tender_id}`;
        const cleanTitle = cleanHtmlTags(rawTitle);
        const highlightedText = extractHighlight(rawTitle);

        return {
          id: String(t.tender_id),
          url: spaUrl,
          title: cleanTitle,
          highlighted_text: highlightedText || undefined,
          authority: t.organization_name || undefined,
          location: t.site_location || undefined,
          estimated_cost_raw: t.tender_estimatedcost ? t.tender_estimatedcost.toString() : (t.estimatedcost ? t.estimatedcost.toString() : undefined),
          due_date: t.submission_enddate || undefined,
          ref_no: t.tender_number || undefined,
          emd_raw: t.earnest_money_deposite ? t.earnest_money_deposite.toString() : undefined,
          document_fee_raw: t.document_fees ? t.document_fees.toString() : undefined
        };
      });
    }
  } catch (e) {
    console.error("Failed to fetch search results from Tender247 API:", e);
  }
  return [];
}

export interface DownloadedDoc {
  name: string;
  filename: string;
  local_path: string;
  created_date?: string | null;
}

// Download a single file using Axios and write to path
export async function downloadFile(url: string, outputPath: string, headers?: any): Promise<boolean> {
  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tender247.com/',
        ...headers
      },
      timeout: 15000
    });

    fs.writeFileSync(outputPath, response.data);
    return true;
  } catch (error) {
    console.error(`Failed to download file from ${url}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

// Compute starting business metadata defaults based on database details
export function computeDefaultBusinessMetadata(t: Partial<Tender>): Partial<Tender> {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const formattedCurrentDate = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

  // 1. Tender Type & Source
  const isGem = !!(
    t.ref_no?.toUpperCase().includes('GEM') ||
    t.title?.toLowerCase().includes('gem') ||
    t.original_url?.toLowerCase().includes('gem')
  );
  const tenderType = isGem ? 'GeM' : 'Non GeM';
  const source = isGem ? 'GeM' : 'E- Procurment';

  // 2. Vertical Name
  let verticalName = 'Others';
  if (t.title) {
    const lowerTitle = t.title.toLowerCase();
    if (lowerTitle.includes('wheelchair') || lowerTitle.includes('trolley') || lowerTitle.includes('couch') || lowerTitle.includes('screen') || lowerTitle.includes('cart') || lowerTitle.includes('cabinet') || lowerTitle.includes('ward') || lowerTitle.includes('bed') || lowerTitle.includes('furniture') || lowerTitle.includes('table')) {
      verticalName = 'Medical Equipment & Furniture';
    } else if (lowerTitle.includes('centrifuge')) {
      verticalName = 'Centrifuge';
    } else if (lowerTitle.includes('freezer') || lowerTitle.includes('deep freezer')) {
      verticalName = 'Deep Freezer';
    } else if (lowerTitle.includes('hvac') || lowerTitle.includes('conditioning') || lowerTitle.includes('split ac') || lowerTitle.includes('chiller') || lowerTitle.includes('cooling')) {
      verticalName = 'HVAC';
    }
  }

  // 3. Place & State
  let place = 'N/A';
  let state = 'N/A';
  if (t.location) {
    const parts = t.location.split(',').map(p => p.trim());
    if (parts.length > 0) place = parts[0];
    if (parts.length > 1) state = parts[1];
  }

  // 4. Corrigendum Remark
  const corrigendumRemark = t.title?.toLowerCase().includes('corrigendum') ? 'Yes' : 'No';

  // 5. Bid Qty
  let bidQty = 1;
  if (t.title) {
    const qtyMatch = t.title.match(/quantity\s*-\s*(\d+)/i) || t.title.match(/qty\s*-\s*(\d+)/i);
    if (qtyMatch) {
      bidQty = parseInt(qtyMatch[1], 10);
    }
  }

  return {
    entry_date: formattedCurrentDate,
    mis_executive: '',
    source: source,
    source_id: t.ref_no || null,
    vertical_name: verticalName,
    place: place,
    state: state,
    tender_type: tenderType,
    publish_date: 'N/A',
    start_date: 'N/A',
    time: 'N/A',
    pre_bid_date: 'No',
    corrigendum_remark: corrigendumRemark,
    product_name_as_per_tender: t.product_name_as_per_tender || t.title || '',
    product_name_as_per_marken: verticalName,
    bid_qty: bidQty,
    quoted_qty: bidQty
  };
}

// Helper to parse MSTC Date/Times (e.g. "26-05-26 12:00" or "22-05-2026") into YYYY-MM-DD HH:mm:ss
export function parseMstcDateTime(raw: string): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  // Match DD-MM-YY HH:MM or DD-MM-YYYY HH:MM
  const match = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2}))?/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    const hour = match[4] ? match[4].padStart(2, '0') : '00';
    const min = match[5] ? match[5].padStart(2, '0') : '00';
    return `${year}-${month}-${day} ${hour}:${min}:00`;
  }
  return null;
}

// Helper to parse NIC / E-Procurement Date/Times (e.g. "23-May-2026 11:00 AM") into YYYY-MM-DD HH:mm:ss
export function parseNicDateTime(raw: string): string | null {
  if (!raw || raw.toUpperCase() === 'NA') return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  // Match format like "23-May-2026 11:00 AM" or "23-May-26 11:00 AM"
  const match = cleaned.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2}))?(?:\s*(AM|PM))?/i);
  if (match) {
    const day = match[1].padStart(2, '0');
    const monthName = match[2].toLowerCase().substring(0, 3);
    const months: { [key: string]: string } = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const month = months[monthName] || '01';
    let year = match[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    let hourVal = match[4] ? parseInt(match[4], 10) : 0;
    const minVal = match[5] ? match[5].padStart(2, '0') : '00';
    const ampm = match[6] ? match[6].toUpperCase() : '';

    if (ampm === 'PM' && hourVal < 12) {
      hourVal += 12;
    } else if (ampm === 'AM' && hourVal === 12) {
      hourVal = 0;
    }
    const hour = hourVal.toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minVal}:00`;
  }
  return null;
}

// Extract specific bid details from downloaded GeM Bid Document HTML files
export function extractBusinessMetadataFromHtml(htmlContent: string, tenderId: string, currentTitle: string): Partial<Tender> {
  const $ = cheerio.load(htmlContent);
  
  // Detect if it is an MSTC Catalogue HTML page
  let mstcAuctionNumber = '';
  let mstcViewDate = '';
  let mstcStartDate = '';
  let mstcCloseDate = '';

  $('tr').each((_, trElement) => {
    const cells = $(trElement).find('td, th').map((_, cell) => $(cell).text().trim()).get();
    if (cells.length >= 2) {
      const label = cells[0].toLowerCase();
      const value = cells[1];
      
      if (label.includes('auction number') || label.includes('auction no')) {
        mstcAuctionNumber = value;
      } else if (label.includes('catalogue view date')) {
        mstcViewDate = value;
      } else if (label.includes('scheduled auction start date')) {
        mstcStartDate = value;
      } else if (label.includes('scheduled auction close date')) {
        mstcCloseDate = value;
      }
    }
  });

  if (mstcAuctionNumber || mstcStartDate || mstcCloseDate || mstcViewDate) {
    const mstcMeta: Partial<Tender> = {};
    if (mstcAuctionNumber) {
      mstcMeta.ref_no = mstcAuctionNumber;
      mstcMeta.source_id = mstcAuctionNumber;
    }
    if (mstcStartDate) {
      const parsedStart = parseMstcDateTime(mstcStartDate);
      if (parsedStart) {
        mstcMeta.start_date = parsedStart;
      }
    }
    if (mstcCloseDate) {
      const parsedClose = parseMstcDateTime(mstcCloseDate);
      if (parsedClose) {
        mstcMeta.due_date = parsedClose;
      }
    }
    if (mstcViewDate) {
      const parsedPublish = parseMstcDateTime(mstcViewDate);
      if (parsedPublish) {
        mstcMeta.publish_date = parsedPublish;
      }
    }
    return mstcMeta;
  }

  // Detect if it is an NIC / E-Procurement HTML page
  let nicPublishDate = '';
  let nicStartDate = '';
  let nicDueDate = '';
  let nicPreBidDate = '';
  let nicRefNo = '';

  $('.td_caption').each((_, captionEl) => {
    const label = $(captionEl).text().trim().replace(/\s+/g, ' ').toLowerCase();
    const value = $(captionEl).next('.td_field').text().trim().replace(/\s+/g, ' ');
    
    if (label.includes('tender reference number')) {
      nicRefNo = value;
    } else if (label.includes('published date')) {
      nicPublishDate = value;
    } else if (label.includes('bid submission start date')) {
      nicStartDate = value;
    } else if (label.includes('bid submission end date')) {
      nicDueDate = value;
    } else if (label.includes('pre bid meeting date')) {
      nicPreBidDate = value;
    }
  });

  if (nicPublishDate || nicStartDate || nicDueDate || nicRefNo) {
    const nicMeta: Partial<Tender> = {};
    if (nicRefNo) {
      nicMeta.ref_no = nicRefNo;
    }
    if (nicPublishDate) {
      const parsedPublish = parseNicDateTime(nicPublishDate);
      if (parsedPublish) {
        nicMeta.publish_date = parsedPublish;
      }
    }
    if (nicStartDate) {
      const parsedStart = parseNicDateTime(nicStartDate);
      if (parsedStart) {
        nicMeta.start_date = parsedStart;
      }
    }
    if (nicDueDate) {
      const parsedDue = parseNicDateTime(nicDueDate);
      if (parsedDue) {
        nicMeta.due_date = parsedDue;
      }
    }
    if (nicPreBidDate && nicPreBidDate.toUpperCase() !== 'NA') {
      const parsedPreBid = parseNicDateTime(nicPreBidDate);
      if (parsedPreBid) {
        nicMeta.pre_bid_date = parsedPreBid;
      }
    }
    return nicMeta;
  }

  let gemBidNumber = '';
  let dated = '';
  let bidEndDate = '';
  let bidEndTime = '';
  let totalQty = '';
  let itemCategory = '';
  let preBidDate = 'No';

  // Find GeM details from the page tables
  $('td, tr').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    
    // Match Bid Number
    if (text.includes('Bid Number:') || text.includes('Bid Number :') || text.includes('बड संDया/Bid Number:') || text.includes('बड संDया/Bid Number :')) {
      const match = text.match(/GEM\/\d+\/B\/\d+/i);
      if (match) gemBidNumber = match[0];
    }
    
    // Match Dated
    if (text.includes('Dated:') || text.includes('Dated :') || text.includes('दनांक /Dated:') || text.includes('दनांक /Dated :')) {
      const match = text.match(/Dated:\s*(\d{2}-\d{2}-\d{4})/i) || text.match(/Dated\s*:\s*(\d{2}-\d{2}-\d{4})/i);
      if (match) dated = match[1];
    }

    // Match Bid End Date/Time
    if (text.includes('Bid End Date/Time') || text.includes('Bid End Date/Time :') || text.includes('बड बंद होने क')) {
      let val = $(el).next().text().trim();
      if (!val) {
        val = $(el).closest('tr').next().text().trim();
      }
      if (val) {
        const match = val.replace(/\s+/g, ' ').match(/(\d{2}-\d{2}-\d{4})\s*(\d{2}:\d{2}:\d{2})/);
        if (match) {
          bidEndDate = match[1];
          bidEndTime = match[2];
        }
      }
    }

    // Match Total Quantity
    if (text.includes('Total Quantity') || text.includes('Total Quantity :') || text.includes('कुल मा ा/Total Quantity')) {
      let val = $(el).next().text().trim();
      if (!val) {
        val = $(el).closest('tr').next().text().trim();
      }
      if (val) totalQty = val.replace(/[^0-9]/g, '');
    }

    // Match Item Category
    if (text.includes('Item Category') || text.includes('Item Category :') || text.includes('व&तु \'ेणी /Item Category') || text.includes('व&तु \'ेणी/Item Category')) {
      let val = $(el).next().text().trim();
      if (!val) {
        val = $(el).closest('tr').next().text().trim();
      }
      if (val) itemCategory = val.split('\n')[0].trim();
    }

    // Match Pre Bid Date
    if (text.includes('Pre Bid Date') || text.includes('Pre Bid Date/Time')) {
      let val = $(el).next().text().trim();
      if (val) preBidDate = val;
    }
  });

  // 12-hour AM/PM Time Formatter
  let formattedTime = 'N/A';
  if (bidEndTime) {
    const timeParts = bidEndTime.split(':');
    if (timeParts.length >= 2) {
      let hour = parseInt(timeParts[0], 10);
      const min = timeParts[1];
      const ampm = hour >= 12 ? 'pm' : 'am';
      hour = hour % 12;
      hour = hour ? hour : 12; // hour '0' resolves to '12'
      formattedTime = `${hour}:${min} ${ampm}`;
    }
  }

  // Convert "Dated" (e.g. 20-04-2026) to standard human format like "20 Apr 2026"
  const formatDateHuman = (dStr: string): string => {
    if (!dStr) return 'N/A';
    const parts = dStr.split('-');
    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const monthIdx = parseInt(parts[1], 10) - 1;
      const year = parts[2];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${day} ${months[monthIdx]} ${year}`;
      }
    }
    return dStr;
  };

  const formattedPublishDate = formatDateHuman(dated);

  return {
    source_id: gemBidNumber || null,
    ref_no: gemBidNumber || null,
    publish_date: formattedPublishDate,
    start_date: formattedPublishDate,
    due_date: bidEndDate || null,
    time: formattedTime,
    pre_bid_date: preBidDate,
    product_name_as_per_tender: itemCategory || null,
    product_name_as_per_marken: itemCategory || null,
    bid_qty: totalQty ? parseInt(totalQty, 10) : null
  };
}

// Helper to recursively get all files in a directory
function getFilesRecursively(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(filePath));
    } else {
      results.push(filePath);
    }
  }
  return results;
}

// Download and save all tender documents for a tender ID
export async function downloadAndSaveTenderDocuments(tenderId: string): Promise<string | null> {
  if (!tenderId || !/^\d+$/.test(tenderId)) {
    console.warn(`Invalid tender ID for document download: ${tenderId}`);
    return null;
  }

  const apiHeaders = {
    'Referer': 'https://www.tender247.com/',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  };

  try {
    let postBody: any = {};
    const tRecordInit = db.prepare("SELECT original_url FROM tenders WHERE id = ?").get(tenderId) as any;
    if (tRecordInit && tRecordInit.original_url) {
      const lowerUrl = tRecordInit.original_url.toLowerCase();
      if (lowerUrl.includes('/auth/tender/')) {
        try {
          const urlObj = new URL(tRecordInit.original_url);
          const pathParts = urlObj.pathname.split('/').filter(Boolean);
          const tenderIndex = pathParts.indexOf('tender');
          if (tenderIndex !== -1 && pathParts.length > tenderIndex + 2) {
            const guestUserId = pathParts[tenderIndex + 3] || '1003059';
            const securityCode = pathParts[tenderIndex + 2];
            console.log(`Tender ${tenderId} is a guest link. Authenticating with guestUserId: ${guestUserId}, securityCode: ${securityCode}...`);
            
            // Dynamic guest token fetch
            const loginRes = await axios.get(
              `https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/user-login/${guestUserId}`,
              { headers: { 'User-Agent': apiHeaders['User-Agent'], 'Referer': apiHeaders.Referer, 'Accept': 'application/json' }, timeout: 10000 }
            );
            const token = loginRes.data?.Data?.[0]?.token;
            if (token) {
              console.log(`Successfully obtained Bearer token for guest user ${guestUserId}`);
              (apiHeaders as any)['Authorization'] = `Bearer ${token}`;
            }
            postBody = {
              guest_user_id: Number(guestUserId),
              security_code: securityCode,
              ip: ""
            };
          }
        } catch (urlErr) {
          console.warn(`Failed to parse guest credentials from original_url: ${tRecordInit.original_url}`, urlErr);
        }
      }
    }

    console.log(`Fetching documents for tender ${tenderId}...`);
    let docs = [];
    let isArchived = false;
    let archiveYear = new Date().getFullYear().toString();

    // 1. Try regular document list first
    try {
      const docRes = await axios.post(
        `https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-document-list/${tenderId}`,
        postBody,
        { headers: apiHeaders, timeout: 10000 }
      );
      docs = docRes.data?.Data || [];
    } catch (err: any) {
      console.warn(`Regular document list failed for ${tenderId}: ${err.message}`);
    }

    // 2. If no docs found, try archive document list
    if (!Array.isArray(docs) || docs.length === 0) {
      // Find year from database
      const tRecord = db.prepare("SELECT due_date, publish_date FROM tenders WHERE id = ?").get(tenderId) as any;
      if (tRecord) {
        const dateToCheck = tRecord.due_date || tRecord.publish_date;
        if (dateToCheck && dateToCheck !== 'N/A') {
          const match = dateToCheck.match(/\d{4}/);
          if (match) archiveYear = match[0];
        }
      }
      
      const yearsToTry = [archiveYear, (Number(archiveYear) - 1).toString(), new Date().getFullYear().toString()];
      const uniqueYears = Array.from(new Set(yearsToTry));

      for (const yr of uniqueYears) {
        try {
          const archiveUrl = `https://t247_api.tender247.com/apigateway/T247ArchiveTenders/api/${yr}/tender-document-list/${tenderId}`;
          console.log(`Trying archive document list for year ${yr}: ${archiveUrl}...`);
          const archiveRes = await axios.post(
            archiveUrl,
            postBody,
            { headers: apiHeaders, timeout: 10000 }
          );
          if (archiveRes.data?.Success && Array.isArray(archiveRes.data.Data) && archiveRes.data.Data.length > 0) {
            docs = archiveRes.data.Data;
            isArchived = true;
            archiveYear = yr;
            break;
          }
        } catch (archErr: any) {
          // ignore
        }
      }
    }

    // 3. Fallback: if still no docs, try fetching details to get doc_path
    if (!Array.isArray(docs) || docs.length === 0) {
      const yearsToTry = [archiveYear, new Date().getFullYear().toString(), (new Date().getFullYear() - 1).toString()];
      const uniqueYears = Array.from(new Set(yearsToTry));
      
      for (const yr of uniqueYears) {
        try {
          const detailUrl = `https://t247_api.tender247.com/apigateway/T247ArchiveTenders/api/${yr}/tender-detail/${tenderId}`;
          console.log(`Trying archive detail fallback to get doc_path for year ${yr}: ${detailUrl}...`);
          const detailRes = await axios.post(
            detailUrl,
            { guest_user_id: 0, security_code: postBody.security_code || "", ip: "", fullViewTender: true },
            { headers: apiHeaders, timeout: 10000 }
          );
          const tData = detailRes.data?.Data?.[0];
          if (tData && tData.doc_path) {
            console.log(`Found doc_path in archive details: ${tData.doc_path}`);
            docs = [{
              tender_id: Number(tenderId),
              document_id: 999999999, // dummy id
              document_path: tData.doc_path,
              document_type_name: "Tender Document",
              file_extension: ".zip",
              created_date: tData.created_date || null
            }];
            isArchived = true;
            archiveYear = yr;
            break;
          }
        } catch (detailErr: any) {
          // ignore
        }
      }
    }

    if (!Array.isArray(docs) || docs.length === 0) {
      console.log(`No documents found for tender ${tenderId} in API or Archive.`);
      return null;
    }

    console.log(`Found ${docs.length} documents for tender ${tenderId}.`);
    const downloadedDocsList: DownloadedDoc[] = [];
    const publicDir = path.join(process.cwd(), 'public');
    const tenderDocsDir = path.join(publicDir, 'documents', tenderId);

    for (const doc of docs) {
      const docPath = doc.doc_path || doc.document_path;
      if (!docPath) continue;

      const isUncPath = docPath.startsWith('\\\\') || docPath.includes('\\');
      let downloadUrl = `https://documents.tender247.com/tender/download-document/${docPath}`;
      let fileExt = doc.file_extension || '.pdf';
      let filename = '';

      if (isUncPath) {
        downloadUrl = `https://documents.tender247.com/tender/download-document-all/${encodeURIComponent(docPath)}`;
        fileExt = '.zip';
        filename = `Tender_Document_${doc.document_id || 'all'}${fileExt}`;
      } else {
        const safeTypeName = (doc.document_type_name || 'Document')
          .replace(/[^a-zA-Z0-9]/g, '_')
          .replace(/_+/g, '_');
        filename = `${safeTypeName}_${doc.document_id}${fileExt}`;
      }

      const outputPath = path.join(tenderDocsDir, filename);

      console.log(`Downloading ${doc.document_type_name || 'Document'} to ${outputPath}...`);
      const success = await downloadFile(
        downloadUrl, 
        outputPath, 
        (apiHeaders as any)['Authorization'] ? { 'Authorization': (apiHeaders as any)['Authorization'] } : undefined
      );

      if (success) {
        downloadedDocsList.push({
          name: doc.document_type_name || 'Associated Document',
          filename,
          local_path: `/documents/${tenderId}/${filename}`,
          created_date: doc.created_date || null
        });
      }
    }

    // ZIP File Extraction and Indexing
    const zipFiles = downloadedDocsList.filter(d => d.filename.toLowerCase().endsWith('.zip'));
    for (const zipDoc of zipFiles) {
      const zipPath = path.join(tenderDocsDir, zipDoc.filename);
      if (fs.existsSync(zipPath)) {
        try {
          console.log(`Extracting ZIP archive ${zipDoc.filename} for tender ${tenderId}...`);
          const extractedDir = path.join(tenderDocsDir, 'extracted');
          if (!fs.existsSync(extractedDir)) {
            fs.mkdirSync(extractedDir, { recursive: true });
          }

          const zip = new JSZip();
          const content = fs.readFileSync(zipPath);
          const zipData = await zip.loadAsync(content);

          for (const [filename, file] of Object.entries(zipData.files)) {
            if (!file.dir) {
              const fileData = await file.async('nodebuffer');
              const destPath = path.join(extractedDir, filename);
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              fs.writeFileSync(destPath, fileData);
            }
          }

          console.log(`ZIP extraction successful for ${zipDoc.filename}. Indexing extracted files...`);
          const extractedFiles = getFilesRecursively(extractedDir);
          for (const filePath of extractedFiles) {
            const relPath = path.relative(extractedDir, filePath);
            downloadedDocsList.push({
              name: path.basename(filePath),
              filename: `extracted/${relPath}`,
              local_path: `/documents/${tenderId}/extracted/${relPath}`,
              created_date: zipDoc.created_date
            });
          }
        } catch (zipErr) {
          console.error(`Failed to extract ZIP file ${zipDoc.filename} for tender ${tenderId}:`, zipErr);
        }
      }
    }

    if (downloadedDocsList.length > 0) {
      const mainDocUrl = downloadedDocsList[0].local_path;
      const downloadedDocsJson = JSON.stringify(downloadedDocsList);

      // 1. Try to find any HTML files to extract metadata (including from zip)
      const htmlFiles = downloadedDocsList.filter(d => d.filename.endsWith('.html') || d.filename.endsWith('.htm'));
      let extracted: any = {};
      for (const hFile of htmlFiles) {
        try {
          const htmlPath = path.join(tenderDocsDir, hFile.filename);
          const htmlContent = fs.readFileSync(htmlPath, 'utf8');
          const tRecord = db.prepare("SELECT title, ref_no, location, original_url FROM tenders WHERE id = ?").get(tenderId) as any;
          if (tRecord) {
            const extMeta = extractBusinessMetadataFromHtml(htmlContent, tenderId, tRecord.title);
            extracted = { ...extracted, ...extMeta };
          }
        } catch (err) {
          console.error(`Failed to parse HTML metadata from ${hFile.filename} inside downloadAndSaveTenderDocuments for ${tenderId}:`, err);
        }
      }

      // 2. Fetch existing tender record to compute defaults
      const tRecord = db.prepare("SELECT * FROM tenders WHERE id = ?").get(tenderId) as any;
      
      let ocrMetadata: any = {};
      if (tRecord) {
        const currentRefNo = extracted.ref_no || tRecord.ref_no;
        const currentEstCost = tRecord.estimated_cost;
        const currentStartDate = extracted.start_date || tRecord.start_date;
        const currentDueDate = extracted.due_date || tRecord.due_date;
        const currentPublishDate = extracted.publish_date || tRecord.publish_date;
        const currentPreBidDate = extracted.pre_bid_date || tRecord.pre_bid_date;
        
        // If ref_no, estimated_cost, start_date, due_date, publish_date or pre_bid_date is missing, try OCR/Text extraction on all available PDF files
        if (!currentRefNo || !currentEstCost || !currentStartDate || !currentDueDate || !currentPublishDate || !currentPreBidDate) {
          const pdfFiles = downloadedDocsList.filter(d => d.filename.toLowerCase().endsWith('.pdf'));
          for (const pdfFile of pdfFiles) {
            try {
              const pdfPath = path.join(tenderDocsDir, pdfFile.filename);
              console.log(`Running text extraction on ${pdfFile.filename}...`);
              const ocrText = await extractTextFromPdf(pdfPath, tenderId);
              if (ocrText) {
                const ocrMeta = extractMetadataFromOcrText(ocrText);
                ocrMetadata = { ...ocrMetadata, ...ocrMeta };
                console.log(`OCR Metadata extraction results for ${tenderId} on ${pdfFile.filename}:`, ocrMeta);
              }
            } catch (ocrErr) {
              console.error(`OCR processing failed for PDF ${pdfFile.filename} on tender ${tenderId}:`, ocrErr);
            }
          }
        }
      }

      if (tRecord) {
        const defaults = computeDefaultBusinessMetadata(tRecord);
        
        // Merge defaults, extracted, and existing
        const finalMetadata: any = {
          ...defaults,
          ...extracted
        };

        if (ocrMetadata.refNo && (!finalMetadata.ref_no || finalMetadata.ref_no === 'N/A')) {
          console.log(`Setting ref_no for tender ${tenderId} from OCR: "${ocrMetadata.refNo}"`);
          finalMetadata.ref_no = ocrMetadata.refNo;
        }

        if (ocrMetadata.estimatedCost !== undefined && ocrMetadata.estimatedCost !== null && !tRecord.estimated_cost) {
          console.log(`Setting estimated_cost for tender ${tenderId} from OCR: "${ocrMetadata.estimatedCost}"`);
          finalMetadata.estimated_cost = ocrMetadata.estimatedCost;
          finalMetadata.estimated_cost_raw = ocrMetadata.estimatedCostRaw;
        }

        if (ocrMetadata.emd !== undefined && ocrMetadata.emd !== null && !tRecord.emd) {
          console.log(`Setting emd for tender ${tenderId} from OCR: "${ocrMetadata.emd}"`);
          finalMetadata.emd = ocrMetadata.emd;
          finalMetadata.emd_raw = ocrMetadata.emdRaw;
        }

        if (ocrMetadata.startDate && (!finalMetadata.start_date || finalMetadata.start_date === 'N/A')) {
          console.log(`Setting start_date for tender ${tenderId} from OCR: "${ocrMetadata.startDate}"`);
          finalMetadata.start_date = ocrMetadata.startDate;
        }
        if (ocrMetadata.dueDate && (!finalMetadata.due_date || finalMetadata.due_date === 'N/A')) {
          console.log(`Setting due_date for tender ${tenderId} from OCR: "${ocrMetadata.dueDate}"`);
          finalMetadata.due_date = ocrMetadata.dueDate;
        }
        if (ocrMetadata.publishDate && (!finalMetadata.publish_date || finalMetadata.publish_date === 'N/A')) {
          console.log(`Setting publish_date for tender ${tenderId} from OCR: "${ocrMetadata.publishDate}"`);
          finalMetadata.publish_date = ocrMetadata.publishDate;
        }
        if (ocrMetadata.preBidDate && (!finalMetadata.pre_bid_date || finalMetadata.pre_bid_date === 'No' || finalMetadata.pre_bid_date === 'N/A')) {
          console.log(`Setting pre_bid_date for tender ${tenderId} from OCR: "${ocrMetadata.preBidDate}"`);
          finalMetadata.pre_bid_date = ocrMetadata.preBidDate;
        }

        // Check if corrigendum Remark should check documents too
        const hasCorrigendumDoc = downloadedDocsList.some(d => d.name.toLowerCase().includes('corrigendum'));
        if (hasCorrigendumDoc) {
          finalMetadata.corrigendum_remark = 'Yes';
        }

        // Update database with all business metadata including estimated_cost, estimated_cost_raw, and dates
        const updateStmt = db.prepare(`
          UPDATE tenders SET
            document_url = ?,
            downloaded_docs = ?,
            entry_date = COALESCE(NULLIF(NULLIF(entry_date, 'N/A'), ''), ?),
            source = COALESCE(NULLIF(NULLIF(source, 'N/A'), ''), ?),
            source_id = COALESCE(NULLIF(NULLIF(source_id, 'N/A'), ''), ?),
            ref_no = COALESCE(NULLIF(NULLIF(ref_no, 'N/A'), ''), ?),
            vertical_name = COALESCE(NULLIF(NULLIF(vertical_name, 'N/A'), ''), ?),
            place = COALESCE(NULLIF(NULLIF(place, 'N/A'), ''), ?),
            state = COALESCE(NULLIF(NULLIF(state, 'N/A'), ''), ?),
            tender_type = COALESCE(NULLIF(NULLIF(tender_type, 'N/A'), ''), ?),
            publish_date = COALESCE(NULLIF(NULLIF(publish_date, 'N/A'), ''), ?),
            start_date = COALESCE(NULLIF(NULLIF(start_date, 'N/A'), ''), ?),
            due_date = COALESCE(NULLIF(NULLIF(due_date, 'N/A'), ''), ?),
            time = COALESCE(NULLIF(NULLIF(time, 'N/A'), ''), ?),
            pre_bid_date = CASE WHEN pre_bid_date IS NULL OR pre_bid_date = 'No' OR pre_bid_date = 'N/A' OR pre_bid_date = '' THEN ? ELSE pre_bid_date END,
            corrigendum_remark = ?,
            product_name_as_per_tender = COALESCE(NULLIF(NULLIF(product_name_as_per_tender, 'N/A'), ''), ?),
            product_name_as_per_marken = COALESCE(NULLIF(NULLIF(product_name_as_per_marken, 'N/A'), ''), ?),
            bid_qty = COALESCE(bid_qty, ?),
            quoted_qty = COALESCE(quoted_qty, ?),
            estimated_cost = COALESCE(estimated_cost, ?),
            estimated_cost_raw = COALESCE(NULLIF(NULLIF(estimated_cost_raw, 'N/A'), ''), ?),
            emd = COALESCE(emd, ?),
            emd_raw = COALESCE(NULLIF(NULLIF(emd_raw, 'N/A'), ''), ?),
            ai_details_summary = NULL,
            ai_history_summary = NULL
          WHERE id = ?
        `);

        updateStmt.run(
          mainDocUrl,
          downloadedDocsJson,
          finalMetadata.entry_date,
          finalMetadata.source,
          finalMetadata.source_id,
          finalMetadata.ref_no,
          finalMetadata.vertical_name,
          finalMetadata.place,
          finalMetadata.state,
          finalMetadata.tender_type,
          finalMetadata.publish_date,
          finalMetadata.start_date,
          finalMetadata.due_date || (tRecord ? tRecord.due_date : null),
          finalMetadata.time,
          finalMetadata.pre_bid_date,
          finalMetadata.corrigendum_remark,
          finalMetadata.product_name_as_per_tender,
          finalMetadata.product_name_as_per_marken || finalMetadata.vertical_name,
          finalMetadata.bid_qty,
          finalMetadata.quoted_qty,
          finalMetadata.estimated_cost !== undefined ? finalMetadata.estimated_cost : null,
          finalMetadata.estimated_cost_raw !== undefined ? finalMetadata.estimated_cost_raw : null,
          finalMetadata.emd !== undefined ? finalMetadata.emd : null,
          finalMetadata.emd_raw !== undefined ? finalMetadata.emd_raw : null,
          tenderId
        );
      } else {
        // Fallback simple update if record doesn't exist yet (unlikely)
        const stmt = db.prepare("UPDATE tenders SET document_url = ?, downloaded_docs = ? WHERE id = ?");
        stmt.run(mainDocUrl, downloadedDocsJson, tenderId);
      }

      console.log(`Successfully updated database for tender ${tenderId} with ${downloadedDocsList.length} downloaded documents and business metadata.`);
      return mainDocUrl;
    }

    return null;
  } catch (error) {
    console.error(`Error downloading documents for tender ${tenderId}:`, error);
    return null;
  }
}

// Extract text from PDF, trying fast digital text extraction first, falling back to OCR if empty/short
export async function extractTextFromPdf(pdfPath: string, tenderId: string): Promise<string> {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.warn(`PDF file not found at ${pdfPath}`);
    return '';
  }

  // 1. Try fast digital text extraction using pdftotext first (extremely fast and accurate for digital PDFs)
  try {
    console.log(`Attempting fast digital text extraction using pdftotext on ${pdfPath}...`);
    const outText = execSync(`pdftotext -f 1 -l 3 "${pdfPath}" -`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (outText && outText.trim().length > 150) {
      console.log(`Successfully extracted digital text from PDF (${outText.trim().length} chars). Skipping OCR.`);
      return outText;
    }
  } catch (err) {
    console.warn(`pdftotext extraction failed or returned too little text, will fall back to OCR:`, err instanceof Error ? err.message : String(err));
  }

  // 2. Fall back to OCR if pdftotext returned empty or very little text
  console.log(`Digital text extraction returned no/insufficient text. Falling back to OCR (pdftoppm + tesseract)...`);
  return extractTextFromPdfUsingOcr(pdfPath, tenderId);
}

// Perform OCR on first 3 pages of a PDF using poppler's pdftoppm and tesseract
export async function extractTextFromPdfUsingOcr(pdfPath: string, tenderId: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    console.warn(`PDF file not found at ${pdfPath}`);
    return '';
  }

  const tempDir = path.join(process.cwd(), 'public', 'documents', `temp-${tenderId}`);
  try {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    console.log(`Running pdftoppm on ${pdfPath} to extract images...`);
    const prefix = path.join(tempDir, 'page');
    // Run pdftoppm to extract first 3 pages as PNGs at 150 DPI
    execSync(`pdftoppm -png -r 150 -f 1 -l 3 "${pdfPath}" "${prefix}"`, { stdio: 'ignore' });

    const files = fs.readdirSync(tempDir);
    const pngFiles = files.filter(f => f.endsWith('.png')).sort((a, b) => {
      const numA = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
      const numB = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
      return numA - numB;
    });

    if (pngFiles.length === 0) {
      console.warn(`No page images generated from PDF ${pdfPath}`);
      return '';
    }

    console.log(`Running tesseract OCR on ${pngFiles.length} pages...`);
    let combinedText = '';

    for (const pngFile of pngFiles) {
      const pngPath = path.join(tempDir, pngFile);
      const txtPrefix = path.join(tempDir, pngFile.replace('.png', ''));
      const txtPath = txtPrefix + '.txt';

      try {
        execSync(`tesseract "${pngPath}" "${txtPrefix}"`, { stdio: 'ignore' });
        if (fs.existsSync(txtPath)) {
          const pageText = fs.readFileSync(txtPath, 'utf8');
          combinedText += `\n--- Page ${pngFile} ---\n` + pageText;
        }
      } catch (ocrErr) {
        console.error(`Error during OCR on page image ${pngFile}:`, ocrErr);
      }
    }

    return combinedText;
  } catch (err) {
    console.error(`Error extracting text from PDF using OCR for tender ${tenderId}:`, err);
    return '';
  } finally {
    // Clean up temp directory
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.error(`Error cleaning up temp OCR directory ${tempDir}:`, cleanupErr);
    }
  }
}

// Extract metadata from OCR extracted text
// Format raw OCR date strings into human-readable DD MMM YYYY format
export function formatOcrDate(dateStr: string): string {
  if (!dateStr) return '';
  const cleanStr = dateStr.trim().replace(/\s+/g, ' ');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  
  // Check if it matches space-separated like "25 May 2026"
  const spaceParts = cleanStr.split(' ');
  if (spaceParts.length === 3) {
    const day = parseInt(spaceParts[0], 10);
    const year = spaceParts[2];
    const monthLower = spaceParts[1].toLowerCase();
    
    let monthIdx = months.findIndex(m => monthLower.startsWith(m.toLowerCase()));
    if (monthIdx === -1) {
      monthIdx = fullMonths.findIndex(m => monthLower === m);
    }
    
    if (!isNaN(day) && monthIdx >= 0 && monthIdx < 12 && year.length === 4) {
      return `${day} ${months[monthIdx]} ${year}`;
    }
  }

  // Handle slash/dash separated dates (e.g. 25/05/2026 or 25-05-2026)
  const cleanDashesSlashes = cleanStr.replace(/\//g, '-');
  const parts = cleanDashesSlashes.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const monthIdx = parseInt(parts[1], 10) - 1;
    const year = parts[2];
    if (!isNaN(day) && monthIdx >= 0 && monthIdx < 12 && year.length === 4) {
      return `${day} ${months[monthIdx]} ${year}`;
    }
  }

  return dateStr;
}

// Extract metadata from OCR extracted text
export function extractMetadataFromOcrText(text: string): { 
  refNo?: string, 
  estimatedCost?: number, 
  estimatedCostRaw?: string,
  startDate?: string,
  dueDate?: string,
  publishDate?: string,
  preBidDate?: string,
  emd?: number,
  emdRaw?: string
} {
  let refNo: string | undefined = undefined;
  let estimatedCost: number | undefined = undefined;
  let estimatedCostRaw: string | undefined = undefined;

  // Patterns to locate Reference Numbers
  const refNoPatterns = [
    /(?:Tender\s+)?Reference\s+(?:No\.?|Number)[:\s.-]+(?:No\.?|Number)?\s*([^\n\r]+)/i,
    /NIT\s+(?:No\.?|Number)[:\s.-]+([^\n\r]+)/i,
    /Ref\s*(?:\.?|erence)\s*(?:No\.?|Number)[:\s.-]+([^\n\r]+)/i,
    /Tender\s+(?:No\.?|Number)[:\s.-]+([^\n\r]+)/i,
    /Bid\s+Number[:\s.-]+([^\n\r]+)/i,
    /e-Tender\s+(?:No\.?|Number)[:\s.-]+([^\n\r]+)/i,
  ];

  for (const pattern of refNoPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let candidate = match[1].trim();
      // Remove trailing punctuation or formatting artifacts
      candidate = candidate.replace(/[.,:;*_\-\/]+$/, '').trim();
      if (candidate.length > 5 && candidate.length < 80) {
        refNo = candidate;
        break;
      }
    }
  }

  // If no prefix pattern match, fallback check for standalone lines starting with common patterns like F. or No. F.
  if (!refNo) {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('F.1-') || trimmed.startsWith('No. F.')) {
        refNo = trimmed;
        break;
      }
    }
  }

  // Cost patterns (Estimated cost/value)
  const costPatterns = [
    /Estimated\s+Bid\s+Value[^\n]*?([0-9,]{4,}(?:\.\d+)?)/i,
    /(?:Estimated|Approximate|Approx\.?|Put\s+to|Value\s+of)\s*(?:Cost|Value|Amount|Tender)[:\s.-]+(?:Rs\.?|INR)?\s*([0-9,]+(?:\.\d+)?\s*(?:Lakh|Crore|Million|Cr\.?|L\.?)?)/i,
    /(?:Estimated|Approximate|Approx\.?|Put\s+to|Value\s+of)\s*(?:Cost|Value|Amount|Tender)[^\n]*?(?:Rs\.?|INR)\s*([0-9,]+(?:\.\d+)?\s*(?:Lakh|Crore|Million|Cr\.?|L\.?)?)/i,
  ];

  for (const pattern of costPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      estimatedCostRaw = match[1].trim();
      break;
    }
  }

  if (estimatedCostRaw) {
    let raw = estimatedCostRaw.toLowerCase().replace(/,/g, '');
    let multiplier = 1;
    if (raw.includes('lakh')) {
      multiplier = 100000;
      raw = raw.replace(/lakhs?|l\.?/g, '');
    } else if (raw.includes('crore')) {
      multiplier = 10000000;
      raw = raw.replace(/crores?|cr\.?/g, '');
    } else if (raw.includes('million')) {
      multiplier = 1000000;
      raw = raw.replace(/millions?/g, '');
    }
    const parsed = parseFloat(raw.trim());
    if (!isNaN(parsed)) {
      estimatedCost = parsed * multiplier;
    }
  }

  // EMD Parsing
  let emd: number | undefined = undefined;
  let emdRaw: string | undefined = undefined;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let emdAmountSum = 0;
  let hasEmd = false;
  let isScheduleWise = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('EMD Amount') || line.includes('ईएमड रािश')) {
      if (line.toLowerCase().includes('schedule') || line.includes('Schedule')) {
        isScheduleWise = true;
      }
      
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const nextLine = lines[j];
        const cleanVal = nextLine.replace(/,/g, '');
        const num = parseFloat(cleanVal);
        if (!isNaN(num) && num > 0) {
          emdAmountSum += num;
          hasEmd = true;
          break;
        }
      }
    }
  }

  if (hasEmd) {
    emd = emdAmountSum;
    if (isScheduleWise) {
      emdRaw = `Schedule-wise (Total INR ${emdAmountSum.toLocaleString('en-IN')})`;
    } else {
      emdRaw = `INR ${emdAmountSum.toLocaleString('en-IN')}`;
    }
  } else {
    // Check if explicitly Not Required
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('EMD Detail') || line.includes('ईएमड ववरण')) {
        for (let j = i + 1; j <= i + 5 && j < lines.length; j++) {
          const nextLine = lines[j];
          if (nextLine.toLowerCase() === 'no' || nextLine.includes('नहीं') || nextLine.includes('Required No')) {
            emd = 0;
            emdRaw = 'Not Required';
            break;
          }
        }
        if (emd !== undefined) break;
      }
    }
  }

  // Date patterns
  const datePatterns = {
    startDate: /(?:Start\s+Date|Submission\s+Start|Date\s+of\s+Submission\s+Start)[^\n\r]*?(\d{2}[-./]\d{2}[-./]\d{4}|\d{1,2}\s+[A-Za-z]{3,10}\s+\d{4})/i,
    dueDate: /(?:Last\s+Date|Due\s+Date|Submission\s+End|End\s+Date|Last\s+Date\s+&\s+Time\s+for\s+Submission)[^\n\r]*?(\d{2}[-./]\d{2}[-./]\d{4}|\d{1,2}\s+[A-Za-z]{3,10}\s+\d{4})/i,
    publishDate: /(?:Publishing\s+of|Publishing\s+Date|Publication\s+Details|Date\s+of\s+publishing|Publish\s+Date)[^\n\r]*?(\d{2}[-./]\d{2}[-./]\d{4}|\d{1,2}\s+[A-Za-z]{3,10}\s+\d{4})/i,
    preBidDate: /(?:Pre-bid\s+meeting|Pre\s+bid\s+date|Date\s+of\s+pre-bid)[^\n\r]*?(\d{2}[-./]\d{2}[-./]\d{4}|\d{1,2}\s+[A-Za-z]{3,10}\s+\d{4})/i,
  };

  const parsedDates: {
    startDate?: string,
    dueDate?: string,
    publishDate?: string,
    preBidDate?: string
  } = {};

  for (const [key, pattern] of Object.entries(datePatterns)) {
    const match = text.match(pattern);
    if (match && match[1]) {
      parsedDates[key as 'startDate' | 'dueDate' | 'publishDate' | 'preBidDate'] = formatOcrDate(match[1]);
    }
  }

  return { 
    refNo, 
    estimatedCost, 
    estimatedCostRaw,
    emd,
    emdRaw,
    ...parsedDates
  };
}



