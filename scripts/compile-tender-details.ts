import db from '../src/lib/db';
import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

async function compile() {
  const tenders = db.prepare("SELECT * FROM tenders").all() as any[];
  console.log(`Compiling details for ${tenders.length} tenders...`);

  const results: any[] = [];

  for (let i = 0; i < tenders.length; i++) {
    const t = tenders[i];
    const docsDir = path.join(process.cwd(), 'public', 'documents', t.id);

    let gemBidNumber = '';
    let dated = '';
    let bidEndDate = '';
    let bidEndTime = '';
    let totalQty = '';
    let itemCategory = '';
    let preBidDate = '';
    let corrigendumRemark = '';

    // Check if it's corrigendum from DB title
    if (t.title.toLowerCase().includes('corrigendum')) {
      corrigendumRemark = 'Corrigendum published';
    }

    // Try to find HTML documents in the docs directory
    if (fs.existsSync(docsDir)) {
      const files = fs.readdirSync(docsDir);
      
      // Check if corrigendum documents exist
      const hasCorrigendumDoc = files.some(f => f.toLowerCase().includes('corrigendum'));
      if (hasCorrigendumDoc && !corrigendumRemark) {
        corrigendumRemark = 'Corrigendum document downloaded';
      }

      const htmlFile = files.find(f => f.endsWith('.html'));
      if (htmlFile) {
        const htmlPath = path.join(docsDir, htmlFile);
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const $ = cheerio.load(htmlContent);

        // Find GeM details from the page tables
        $('td, tr').each((_, el) => {
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          
          // Match Bid Number
          if (text.includes('Bid Number:') || text.includes('Bid Number :')) {
            const match = text.match(/GEM\/\d+\/B\/\d+/i);
            if (match) gemBidNumber = match[0];
          }
          
          // Match Dated
          if (text.includes('Dated:') || text.includes('Dated :')) {
            const match = text.match(/Dated:\s*(\d{2}-\d{2}-\d{4})/i) || text.match(/Dated\s*:\s*(\d{2}-\d{2}-\d{4})/i);
            if (match) dated = match[1];
          }

          // Match Bid End Date/Time
          if (text.includes('Bid End Date/Time') || text.includes('Bid End Date/Time :')) {
            // Check next elements
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
          if (text.includes('Total Quantity') || text.includes('Total Quantity :')) {
            let val = $(el).next().text().trim();
            if (!val) {
              val = $(el).closest('tr').next().text().trim();
            }
            if (val) totalQty = val.replace(/[^0-9]/g, '');
          }

          // Match Item Category
          if (text.includes('Item Category') || text.includes('Item Category :')) {
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
      }
    }

    // Fallbacks
    const tenderType = (gemBidNumber || t.title.toLowerCase().includes('gem') || t.original_url.toLowerCase().includes('gem')) ? 'GeM' : 'Non GeM';
    const sourceId = gemBidNumber || t.ref_no || t.id;
    
    // Vertical Name mapping
    let verticalName = 'Others';
    if (t.title.toLowerCase().includes('centrifuge')) verticalName = 'Centrifuge';
    else if (t.title.toLowerCase().includes('freezer') || t.title.toLowerCase().includes('deep freezer')) verticalName = 'Deep Freezer';
    else if (t.title.toLowerCase().includes('hvac') || t.title.toLowerCase().includes('conditioning')) verticalName = 'HVAC';
    else if (t.title.toLowerCase().includes('furnishing') || t.title.toLowerCase().includes('interior')) verticalName = 'Interior & Furnishing';

    // Place & State
    let place = '';
    let state = '';
    if (t.location) {
      const parts = t.location.split(',').map((p: string) => p.trim());
      if (parts.length > 0) place = parts[0];
      if (parts.length > 1) state = parts[1];
    }

    // Bid Quantity
    let bidQty = totalQty || '1';
    // If quantity is in the title, extract it
    const qtyMatch = t.title.match(/quantity\s*-\s*(\d+)/i) || t.title.match(/qty\s*-\s*(\d+)/i);
    if (qtyMatch) {
      bidQty = qtyMatch[1];
    }

    results.push({
      srNo: i + 1,
      entryDate: t.scraped_at ? t.scraped_at.split('T')[0] : '',
      source: 'Tender247',
      sourceId: sourceId,
      verticalName: verticalName,
      organisationName: t.authority || 'N/A',
      place: place || 'N/A',
      state: state || 'N/A',
      tenderType: tenderType,
      tenderId: t.id,
      link: t.original_url,
      publishDate: dated || 'N/A',
      startDate: dated || 'N/A',
      endDate: bidEndDate || t.due_date || 'N/A',
      time: bidEndTime || 'N/A',
      preBidDate: preBidDate || 'N/A',
      corrigendumRemark: corrigendumRemark || 'N/A',
      productNameAsPerTender: t.title,
      productNameAsPerMarkEn: itemCategory || verticalName,
      bidQty: bidQty,
      quotedQty: bidQty
    });
  }

  // Generate Markdown Table
  let md = `# Compiled Tender Details\n\n`;
  md += `| Sr No | Entry Date | Source | Source ID | Vertical | Organisation Name | Place | State | Tender Type | Tender ID | Link | Publish Date | Start Date | End Date | Time | Pre Bid Date | Corrigendum Remark | Product Name As per Tender | Product Name As per MarkEn | Bid Qty | Quoted Qty |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;

  for (const r of results) {
    // Escape pipes in content
    const cleanTitle = r.productNameAsPerTender.replace(/\|/g, '\\|');
    const cleanOrg = r.organisationName.replace(/\|/g, '\\|');
    md += `| ${r.srNo} | ${r.entryDate} | ${r.source} | ${r.sourceId} | ${r.verticalName} | ${cleanOrg} | ${r.place} | ${r.state} | ${r.tenderType} | [${r.tenderId}](${r.link}) | [Link](${r.link}) | ${r.publishDate} | ${r.startDate} | ${r.endDate} | ${r.time} | ${r.preBidDate} | ${r.corrigendumRemark} | ${cleanTitle} | ${r.productNameAsPerMarkEn} | ${r.bidQty} | ${r.quotedQty} |\n`;
  }

  fs.writeFileSync(path.join(process.cwd(), 'compiled_tenders.md'), md);
  
  // Save as CSV too
  let csv = `Sr No,Entry date,Source,Source id,Vertical Name,Organisation Name,Place,State,Tender Type (GeM / Non GeM),TENDER ID,LINK,PUBLISH DATE,Start Date,End Date,Time,Pre Bid Date,Corrigendum Remark,Product Name As per Tender,Product Name As per MarkEn,Bid Qty,Quoted Qty\n`;
  for (const r of results) {
    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    csv += `${r.srNo},${escapeCsv(r.entryDate)},${escapeCsv(r.source)},${escapeCsv(r.sourceId)},${escapeCsv(r.verticalName)},${escapeCsv(r.organisationName)},${escapeCsv(r.place)},${escapeCsv(r.state)},${escapeCsv(r.tenderType)},${escapeCsv(r.tenderId)},${escapeCsv(r.link)},${escapeCsv(r.publishDate)},${escapeCsv(r.startDate)},${escapeCsv(r.endDate)},${escapeCsv(r.time)},${escapeCsv(r.preBidDate)},${escapeCsv(r.corrigendumRemark)},${escapeCsv(r.productNameAsPerTender)},${escapeCsv(r.productNameAsPerMarkEn)},${escapeCsv(r.bidQty)},${escapeCsv(r.quotedQty)}\n`;
  }
  fs.writeFileSync(path.join(process.cwd(), 'compiled_tenders.csv'), csv);
  
  console.log(`Compilation complete! Saved to compiled_tenders.md and compiled_tenders.csv`);
}

compile().catch(console.error);
