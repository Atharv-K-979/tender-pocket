import axios from 'axios';
import db from '@/lib/db';

export async function syncGeMTenders(): Promise<{ success: boolean; importedCount: number; message: string }> {
  console.log("=== [GeM Sync Engine] Fetching Live GeM Portal Tenders ===");
  let newlyImportedCount = 0;

  try {
    const mainUrl = "https://bidplus.gem.gov.in/all-bids";
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    const res = await axios.get(mainUrl, { headers, timeout: 10000 });
    const cookies = res.headers['set-cookie'] || [];
    const cookieHeader = cookies.map((c: string) => c.split(';')[0]).join('; ');
    
    const html = res.data || '';
    const match = html.match(/'csrf_bd_gem_nk'\s*:\s*'([a-f0-9]+)'/i);
    const csrfHash = match ? match[1] : '';

    if (!csrfHash) {
      return { success: false, importedCount: 0, message: 'Could not obtain GeM CSRF token' };
    }

    const postData = {
      param: { searchBid: "", searchType: "fullText" },
      filter: {
        bidStatusType: "ongoing_bids",
        byType: "all",
        highBidValue: "",
        byEndDate: { from: "", to: "" },
        sort: "Bid-End-Date-Oldest"
      }
    };

    const params = new URLSearchParams();
    params.append('payload', JSON.stringify(postData));
    params.append('csrf_bd_gem_nk', csrfHash);

    const apiRes = await axios.post(
      "https://bidplus.gem.gov.in/all-bids-data",
      params.toString(),
      {
        headers: {
          'User-Agent': headers['User-Agent'],
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': 'https://bidplus.gem.gov.in/all-bids',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': cookieHeader
        },
        timeout: 12000
      }
    );

    const docs = apiRes.data?.response?.response?.docs || [];
    console.log(`[GeM Sync Engine] Fetched ${docs.length} live GeM bids!`);

    const todayISO = new Date().toISOString();
    const todayDateOnly = todayISO.split('T')[0];

    const insertStmt = db.prepare(`
      INSERT INTO tenders (
        id, ref_no, title, authority, estimated_cost, estimated_cost_raw,
        emd, emd_raw, document_fee, document_fee_raw, location, sector,
        due_date, opening_date, document_url, original_url, status, notes,
        scraped_at, downloaded_docs, entry_date, mis_executive, source, source_id,
        vertical_name, place, state, tender_type, publish_date, start_date, time,
        pre_bid_date, corrigendum_remark, product_name_as_per_tender, product_name_as_per_marken,
        bid_qty, quoted_qty, payment_status, verification_status, submission_status,
        outcome_status, spec_verification_status
      ) VALUES (
        @id, @ref_no, @title, @authority, @estimated_cost, @estimated_cost_raw,
        @emd, @emd_raw, @document_fee, @document_fee_raw, @location, @sector,
        @due_date, @opening_date, @document_url, @original_url, @status, @notes,
        @scraped_at, @downloaded_docs, @entry_date, @mis_executive, @source, @source_id,
        @vertical_name, @place, @state, @tender_type, @publish_date, @start_date, @time,
        @pre_bid_date, @corrigendum_remark, @product_name_as_per_tender, @product_name_as_per_marken,
        @bid_qty, @quoted_qty, @payment_status, @verification_status, @submission_status,
        @outcome_status, @spec_verification_status
      )
    `);

    for (const doc of docs) {
      const id = String(doc.id || doc.b_id?.[0]);
      if (!id) continue;

      const existing = db.prepare('SELECT id FROM tenders WHERE id = ?').get(id);
      if (existing) continue;

      const refNo = doc.b_bid_number?.[0] || `GEM/${id}`;
      const title = doc.b_category_name?.[0] || doc.bd_category_name?.[0] || 'GeM Bid Package';
      const ministry = doc.ba_official_details_minName?.[0] || 'Government Portal';
      const dept = doc.ba_official_details_deptName?.[0] || 'Department of GeM Procurement';
      const authority = `${dept}, ${ministry}`;
      const qty = doc.b_total_quantity?.[0] || 1;

      const rawEndDate = doc.final_end_date_sort?.[0] || '';
      const rawStartDate = doc.final_start_date_sort?.[0] || '';

      const dueDateFormatted = rawEndDate ? rawEndDate.replace('T', ' ').replace('Z', '') : `${todayDateOnly} 18:00:00`;
      const startDateFormatted = rawStartDate ? rawStartDate.replace('T', ' ').replace('Z', '') : `${todayDateOnly} 10:00:00`;
      const publishDate = rawStartDate ? rawStartDate.split('T')[0] : todayDateOnly;

      const originalUrl = `https://bidplus.gem.gov.in/showbidDocument/${id}`;
      const docUrl = `/documents/${id}/Bid_Document_${id}.pdf`;

      const downloadedDocsJson = JSON.stringify([
        {
          name: "GeM RA / Bid Document",
          filename: `Bid_Document_${id}.pdf`,
          local_path: docUrl,
          created_date: todayDateOnly
        }
      ]);

      try {
        insertStmt.run({
          id,
          ref_no: refNo,
          title,
          authority,
          estimated_cost: 0,
          estimated_cost_raw: 'As per GeM Bid Document',
          emd: 0,
          emd_raw: 'Refer to GeM PDF',
          document_fee: 0,
          document_fee_raw: 'Exempted / Free',
          location: 'India / Multi-Location',
          sector: 'Medical Equipment / Healthcare',
          due_date: dueDateFormatted,
          opening_date: dueDateFormatted,
          document_url: docUrl,
          original_url: originalUrl,
          status: 'New',
          notes: `Live GeM Portal Bid. Total Quantity: ${qty}`,
          scraped_at: todayISO,
          downloaded_docs: downloadedDocsJson,
          entry_date: todayDateOnly,
          mis_executive: 'Unassigned',
          source: 'GeM Portal',
          source_id: id,
          vertical_name: 'Medical Equipment',
          place: 'India',
          state: 'Maharashtra',
          tender_type: 'GeM Bid',
          publish_date: publishDate,
          start_date: startDateFormatted,
          time: '18:00:00',
          pre_bid_date: 'N/A',
          corrigendum_remark: '',
          product_name_as_per_tender: title,
          product_name_as_per_marken: title,
          bid_qty: qty,
          quoted_qty: qty,
          payment_status: 'None',
          verification_status: 'None',
          submission_status: 'None',
          outcome_status: 'None',
          spec_verification_status: 'None'
        });
        newlyImportedCount++;
      } catch (insertErr) {
        console.error(`[GeM Sync Engine] Error inserting tender ${id}:`, insertErr);
      }
    }

    return {
      success: true,
      importedCount: newlyImportedCount,
      message: `GeM portal sync complete. ${newlyImportedCount} new tenders added.`
    };
  } catch (error: any) {
    console.error("[GeM Sync Engine] Error during sync:", error);
    return {
      success: false,
      importedCount: 0,
      message: `GeM sync error: ${error.message}`
    };
  }
}
