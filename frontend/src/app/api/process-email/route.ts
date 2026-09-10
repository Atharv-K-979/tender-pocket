import { NextResponse } from 'next/server';
import db, { Tender } from '@/lib/db';
import { extractTenderLinks, scrapeTender, parseTendersFromEmailHtml, parseTendersFromEmailText, extractViewAllLink, resolveKeyFromViewAllLink, fetchTendersFromMailtendersKey, parseMoneyValue, parseDateString, EmailTender, downloadAndSaveTenderDocuments, computeDefaultBusinessMetadata, extractEmailKeywords, matchKeywordsInText } from '@/lib/scraper';
import { simpleParser } from 'mailparser';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    let { emailBody, subject, sender, receivedAt, emlString } = body;

    // Auto-detect if pasted text is raw EML headers + content
    const looksLikeEml = emailBody && (
      emailBody.includes('Delivered-To:') || 
      emailBody.includes('Received:') || 
      (emailBody.includes('Subject:') && (emailBody.includes('From:') || emailBody.includes('Content-Type:')))
    );

    if (looksLikeEml && !emlString) {
      emlString = emailBody;
    }

    // If raw EML format is sent, parse it first using mailparser
    if (emlString) {
      try {
        const parsed = await simpleParser(emlString);
        emailBody = (parsed.html as string) || parsed.text || '';
        subject = parsed.subject;
        sender = parsed.from?.text;
        receivedAt = parsed.date ? parsed.date.toISOString() : null;
      } catch (emlError) {
        console.error('Error parsing EML content:', emlError);
        return NextResponse.json(
          { success: false, error: 'Invalid EML file content: ' + (emlError instanceof Error ? emlError.message : String(emlError)) },
          { status: 400 }
        );
      }
    }

    if (!emailBody) {
      return NextResponse.json(
        { success: false, error: 'Either emailBody or emlString is required' },
        { status: 400 }
      );
    }

    const emailKeywords = extractEmailKeywords(emailBody);
    console.log(`Extracted email keywords for dynamic highlights:`, emailKeywords);

    let emailTenders: EmailTender[] = [];

    // 1. Try to extract the "View All" link and fetch all tenders from the listing API
    try {
      const viewAllLink = await extractViewAllLink(emailBody);
      if (viewAllLink) {
        console.log("Found View All link:", viewAllLink);
        const key = await resolveKeyFromViewAllLink(viewAllLink);
        if (key) {
          console.log("Resolved key from View All link:", key);
          const listTenders = await fetchTendersFromMailtendersKey(key);
          if (listTenders.length > 0) {
            console.log(`Successfully fetched ${listTenders.length} tenders from Tender247 search API.`);
            emailTenders = listTenders;
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch tenders from listing API:", e);
    }

    // 2. Fallback: Parse structured tenders from the email HTML table directly (5 tenders)
    if (emailTenders.length === 0) {
      emailTenders = parseTendersFromEmailHtml(emailBody);
    }

    // 3. Fallback: Parse structured tenders from the email plain text directly (5 tenders)
    if (emailTenders.length === 0) {
      emailTenders = parseTendersFromEmailText(emailBody);
    }

    // If still no structured tenders found, extract links and create basic EmailTender objects as a fallback
    if (emailTenders.length === 0) {
      const links = extractTenderLinks(emailBody);
      emailTenders = links.map(link => {
        let id = '';
        try {
          const urlObj = new URL(link);
          id = urlObj.searchParams.get('id') || '';
          if (!id) {
            const pathParts = urlObj.pathname.split('/');
            id = pathParts[pathParts.length - 1] || '';
          }
        } catch (e) {
          id = Buffer.from(link).toString('base64').substring(0, 16);
        }
        return {
          id,
          url: link,
          title: `Tender ${id}`
        };
      });
    }

    if (emailTenders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No tenders found in email content.',
        linksFound: 0,
        tendersAdded: []
      });
    }

    const tendersAdded: string[] = [];
    const tendersUpdated: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    // Process each tender
    for (const emailTender of emailTenders) {
      const link = emailTender.url;
      const id = emailTender.id;

      // Check for duplicate in DB by either ID or original link
      const checkStmt = db.prepare('SELECT * FROM tenders WHERE id = ? OR original_url = ?');
      const existing = checkStmt.get(id, link) as Tender | undefined;

      let isTrackingSlugReplacement = false;
      if (existing) {
        const isExistingNumeric = /^\d+$/.test(existing.id);
        const isNewNumeric = /^\d+$/.test(id);

        if (!isExistingNumeric && isNewNumeric) {
          // Delete old invalid placeholder with the tracking slug ID
          const deleteStmt = db.prepare('DELETE FROM tenders WHERE id = ?');
          deleteStmt.run(existing.id);
          console.log(`Deleted old tracking slug placeholder ID: ${existing.id} in favor of numeric ID: ${id}`);
          isTrackingSlugReplacement = true;
        }
      }

      // Check if we already have the details loaded from the listing API
      const isListApi = !!emailTender.ref_no || !!emailTender.estimated_cost_raw || !!emailTender.emd_raw;

      let details: Partial<Tender> = {};
      if (isListApi) {
        // Details are already loaded from the Tender247 API
        const estimatedCost = emailTender.estimated_cost_raw ? parseMoneyValue(emailTender.estimated_cost_raw) : null;
        const emd = emailTender.emd_raw ? parseMoneyValue(emailTender.emd_raw) : null;
        const docFee = emailTender.document_fee_raw ? parseMoneyValue(emailTender.document_fee_raw) : null;

        details = {
          id: emailTender.id,
          ref_no: emailTender.ref_no || null,
          title: emailTender.title,
          authority: emailTender.authority || null,
          estimated_cost: estimatedCost,
          estimated_cost_raw: emailTender.estimated_cost_raw || null,
          emd: emd,
          emd_raw: emailTender.emd_raw || null,
          document_fee: docFee,
          document_fee_raw: emailTender.document_fee_raw || null,
          location: emailTender.location || null,
          sector: null,
          due_date: emailTender.due_date ? parseDateString(emailTender.due_date) : null,
          opening_date: null,
          document_url: null, // We can scrape this dynamically when clicked
          original_url: link,
          scraped_at: new Date().toISOString()
        };
      } else {
        // Scrape details from URL
        details = await scrapeTender(link);
      }

      if (details.title && details.title.includes('Utility/Non-Tender')) {
        // Skip utility link
        skipped.push(link);
        continue;
      }

      // Merge email table metadata and scraped details
      const isScrapeFailed = !isListApi && (!details.title || details.title.startsWith('Blocked/Failed') || details.title.startsWith('Failed to scrape'));

      const mergedTitle = isScrapeFailed 
        ? emailTender.title 
        : (details.title || emailTender.title);

      const mergedAuthority = details.authority || emailTender.authority || null;
      
      const mergedCost = details.estimated_cost || 
        (emailTender.estimated_cost_raw ? parseMoneyValue(emailTender.estimated_cost_raw) : null);
      
      const mergedCostRaw = details.estimated_cost_raw || emailTender.estimated_cost_raw || null;

      const mergedLocation = details.location || emailTender.location || null;

      const mergedDueDate = details.due_date || 
        (emailTender.due_date ? parseDateString(emailTender.due_date) : null);

      const notes = details.notes || (isScrapeFailed ? 'Enriched from email table due to scraping failure.' : '');
      const scrapedAt = details.scraped_at || new Date().toISOString();

      // Compute default business metadata
      let prodName = details.product_name_as_per_tender || emailTender.highlighted_text || null;
      if (!prodName && emailKeywords && emailKeywords.length > 0) {
        prodName = matchKeywordsInText(mergedTitle, emailKeywords) || null;
      }

      const tempTender = {
        title: mergedTitle,
        ref_no: details.ref_no || null,
        location: mergedLocation,
        original_url: link,
        product_name_as_per_tender: prodName
      };
      const defaults = computeDefaultBusinessMetadata(tempTender);

      // If duplicate exists and not replacing tracking slug, check for corrigendum / due date changes
      if (existing && !isTrackingSlugReplacement) {
        const isCorrigendumIncoming = mergedTitle.toLowerCase().includes('corrigendum') || 
                                      (details.corrigendum_remark && details.corrigendum_remark.toLowerCase() === 'yes');
        const isDueDateChanged = mergedDueDate && existing.due_date && mergedDueDate !== existing.due_date;

        if (isCorrigendumIncoming || isDueDateChanged) {
          console.log(`[Corrigendum/Update Detected] Updating existing tender ${existing.id}.`);
          
          let updatedNotes = existing.notes || '';
          const dateStr = new Date().toLocaleDateString('en-IN');
          const changeLog = [];
          if (isCorrigendumIncoming && existing.corrigendum_remark !== 'Yes') {
            changeLog.push('marked as corrigendum');
          }
          if (isDueDateChanged) {
            changeLog.push(`due date updated from ${existing.due_date} to ${mergedDueDate}`);
          }
          if (changeLog.length === 0) {
            changeLog.push('details refreshed');
          }
          
          const logPrefix = `\n[System Alert] Corrigendum processed on ${dateStr}: ${changeLog.join(', ')}. Status reset to Issued.`;
          updatedNotes = updatedNotes ? updatedNotes + logPrefix : logPrefix.trim();

          const updateStmt = db.prepare(`
            UPDATE tenders SET
              title = ?,
              authority = ?,
              estimated_cost = ?,
              estimated_cost_raw = ?,
              emd = ?,
              emd_raw = ?,
              document_fee = ?,
              document_fee_raw = ?,
              location = ?,
              due_date = ?,
              status = 'Issued',
              corrigendum_remark = 'Yes',
              notes = ?,
              scraped_at = ?,
              product_name_as_per_tender = COALESCE(product_name_as_per_tender, ?),
              product_name_as_per_marken = COALESCE(product_name_as_per_marken, ?),
              ai_details_summary = NULL,
              ai_history_summary = NULL
            WHERE id = ?
          `);

          let updatedProdName = details.product_name_as_per_tender || emailTender.highlighted_text || null;
          if (!updatedProdName && emailKeywords && emailKeywords.length > 0) {
            updatedProdName = matchKeywordsInText(mergedTitle, emailKeywords) || null;
          }
          updateStmt.run(
            mergedTitle,
            mergedAuthority,
            mergedCost,
            mergedCostRaw,
            details.emd || existing.emd,
            details.emd_raw || existing.emd_raw,
            details.document_fee || existing.document_fee,
            details.document_fee_raw || existing.document_fee_raw,
            mergedLocation,
            mergedDueDate,
            updatedNotes,
            scrapedAt,
            updatedProdName,
            updatedProdName || defaults.vertical_name,
            existing.id
          );

          tendersUpdated.push(existing.id);

          // Trigger document download to fetch new corrigendum files
          if (/^\d+$/.test(existing.id)) {
            downloadAndSaveTenderDocuments(existing.id).catch(err => {
              console.error(`Background document download failed for tender ${existing.id}:`, err);
            });
          }
        } else {
          skipped.push(link);
        }
        continue;
      }

      // Insert into database
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO tenders (
          id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
          emd, emd_raw, document_fee, document_fee_raw, location, sector,
          due_date, opening_date, document_url, original_url, status, scraped_at, notes,
          entry_date, mis_executive, source, source_id, vertical_name, place, state,
          tender_type, publish_date, start_date, time, pre_bid_date, corrigendum_remark,
          product_name_as_per_tender, product_name_as_per_marken, bid_qty, quoted_qty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(
        id,
        details.ref_no || null,
        mergedTitle,
        mergedAuthority,
        mergedCost,
        mergedCostRaw,
        details.emd || null,
        details.emd_raw || null,
        details.document_fee || null,
        details.document_fee_raw || null,
        mergedLocation,
        details.sector || null,
        mergedDueDate,
        details.opening_date || null,
        details.document_url || null,
        link,
        'Issued',
        scrapedAt,
        notes,
        defaults.entry_date,
        defaults.mis_executive,
        defaults.source,
        defaults.source_id,
        defaults.vertical_name,
        defaults.place,
        defaults.state,
        defaults.tender_type,
        defaults.publish_date,
        defaults.start_date,
        defaults.time,
        defaults.pre_bid_date,
        defaults.corrigendum_remark,
        defaults.product_name_as_per_tender,
        defaults.product_name_as_per_marken,
        defaults.bid_qty,
        defaults.quoted_qty
      );

      if (isScrapeFailed) {
        failed.push(link);
      } else {
        tendersAdded.push(id);
      }

      // Trigger background document download
      if (/^\d+$/.test(id)) {
        downloadAndSaveTenderDocuments(id).catch(err => {
          console.error(`Background document download failed for tender ${id}:`, err);
        });
      }
    }

    // Save processed email log
    if (subject || sender) {
      const emailId = Buffer.from(`${subject}-${sender}-${receivedAt || ''}`).toString('base64').substring(0, 32);
      try {
        const emailStmt = db.prepare(`
          INSERT OR REPLACE INTO processed_emails (id, subject, sender, received_at, processed_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        emailStmt.run(emailId, subject || null, sender || null, receivedAt || null, new Date().toISOString());
      } catch (e) {
        console.error('Failed to save processed email record:', e);
      }
    }

    return NextResponse.json({
      success: true,
      linksFound: emailTenders.length,
      tendersAdded,
      tendersUpdated,
      skipped,
      failed,
      message: `Successfully processed email. Extracted ${emailTenders.length} tender(s). Added ${tendersAdded.length} new, updated ${tendersUpdated.length} corrigendum/due-date changes, skipped ${skipped.length} duplicate(s), failed ${failed.length}.`
    });
  } catch (error) {
    console.error('Error processing email endpoint:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
