import db from '../src/lib/db';
import * as fs from 'fs';
import * as path from 'path';
import { extractBusinessMetadataFromHtml, computeDefaultBusinessMetadata } from '../src/lib/scraper';

async function migrate() {
  const tenders = db.prepare("SELECT * FROM tenders").all() as any[];
  console.log(`Migrating/Backfilling metadata for ${tenders.length} tenders...`);

  let count = 0;
  for (const t of tenders) {
    const docsDir = path.join(process.cwd(), 'public', 'documents', t.id);
    let extracted: any = {};
    let hasCorrigendumDoc = false;

    if (fs.existsSync(docsDir)) {
      const files = fs.readdirSync(docsDir);
      hasCorrigendumDoc = files.some(f => f.toLowerCase().includes('corrigendum'));

      const htmlFile = files.find(f => f.endsWith('.html'));
      if (htmlFile) {
        try {
          const htmlPath = path.join(docsDir, htmlFile);
          const htmlContent = fs.readFileSync(htmlPath, 'utf8');
          extracted = extractBusinessMetadataFromHtml(htmlContent, t.id, t.title);
        } catch (err) {
          console.error(`Failed to parse HTML metadata for tender ${t.id}:`, err);
        }
      }
    }

    const defaults = computeDefaultBusinessMetadata(t);
    
    // Merge defaults, extracted, and existing values if they exist
    const finalMetadata = {
      ...defaults,
      ...extracted
    };

    if (hasCorrigendumDoc || t.title?.toLowerCase().includes('corrigendum')) {
      finalMetadata.corrigendum_remark = 'Yes';
    }

    // Prepare update query
    const updateStmt = db.prepare(`
      UPDATE tenders SET
        entry_date = ?,
        source = ?,
        source_id = ?,
        ref_no = ?,
        vertical_name = ?,
        place = ?,
        state = ?,
        tender_type = ?,
        publish_date = ?,
        start_date = ?,
        time = ?,
        pre_bid_date = ?,
        corrigendum_remark = ?,
        product_name_as_per_tender = ?,
        product_name_as_per_marken = ?,
        bid_qty = ?,
        quoted_qty = ?
      WHERE id = ?
    `);

    updateStmt.run(
      t.entry_date || finalMetadata.entry_date,
      t.source || finalMetadata.source,
      t.source_id || finalMetadata.source_id,
      t.ref_no || finalMetadata.ref_no,
      t.vertical_name || finalMetadata.vertical_name,
      t.place || finalMetadata.place,
      t.state || finalMetadata.state,
      t.tender_type || finalMetadata.tender_type,
      t.publish_date || finalMetadata.publish_date,
      t.start_date || finalMetadata.start_date,
      t.time || finalMetadata.time,
      t.pre_bid_date || finalMetadata.pre_bid_date,
      t.corrigendum_remark || finalMetadata.corrigendum_remark,
      t.product_name_as_per_tender || finalMetadata.product_name_as_per_tender,
      t.product_name_as_per_marken || finalMetadata.product_name_as_per_marken || finalMetadata.vertical_name,
      t.bid_qty || finalMetadata.bid_qty,
      t.quoted_qty || finalMetadata.quoted_qty,
      t.id
    );
    count++;
  }

  console.log(`Migration complete! Successfully migrated ${count} tenders in database.`);
}

migrate().catch(console.error);
