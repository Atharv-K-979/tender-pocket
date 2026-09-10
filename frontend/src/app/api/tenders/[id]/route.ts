import { NextResponse } from 'next/server';
import db, { addActivityLog } from '@/lib/db';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch tender
    const tenderStmt = db.prepare('SELECT * FROM tenders WHERE id = ?');
    const tender = tenderStmt.get(id) as any;

    if (!tender) {
      return NextResponse.json(
        { success: false, error: 'Tender not found' },
        { status: 404 }
      );
    }

    const userRole = request.headers.get('x-user-role');
    const username = request.headers.get('x-user-username');

    if (userRole === 'Specification Team' && tender.assigned_mis_member_spec && tender.assigned_mis_member_spec !== username) {
      return NextResponse.json(
        { success: false, error: 'Access denied: This tender is assigned to another Specification Team member' },
        { status: 403 }
      );
    }

    // Fetch history
    let history = db.prepare('SELECT * FROM status_history WHERE tender_id = ? ORDER BY changed_at ASC').all(id) as any[];

    // Fallback default history if none exists in db
    if (history.length === 0) {
      history = [{
        id: 0,
        tender_id: id,
        from_status: null,
        to_status: tender.status || 'Issued',
        changed_at: tender.scraped_at || new Date().toISOString(),
        notes: tender.notes?.includes('Imported automatically') ? tender.notes : 'Tender imported.'
      }];
    }

    // Resolve date and statuses to plain English
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-IN', options as any);
    const parts = formatter.formatToParts(new Date());
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const todayISTString = `${year}-${month}-${day}`;

    const isLapsed = (publishDateStr: string | null | undefined, todayISTStr: string): boolean => {
      if (!publishDateStr || publishDateStr === 'N/A') return false;
      const date = new Date(publishDateStr);
      if (isNaN(date.getTime())) return false;
      
      const today = new Date(todayISTStr + 'T00:00:00+05:30');
      const publishDate = new Date(date);
      publishDate.setHours(0,0,0,0);
      
      const diffTime = today.getTime() - publishDate.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      return diffDays > 3;
    };

    const resolveStatus = (t: any, todayIST: string): string => {
      const hasPassedDueDate = t.due_date && t.due_date < todayIST;

      if (t.status === 'Awarded') return 'Won';
      if (t.status === 'Not Awarded') return 'Lost';
      if (t.status === 'Filed') return 'Submitted';

      if (hasPassedDueDate) {
        if (t.status === 'Not Participating') {
          return 'Missed Opportunity';
        }
        if (t.status === 'Issued' || t.status === 'Participating' || !t.status) {
          return 'Missed Deadline';
        }
      }

      if (t.status === 'Not Participating') return 'Not Participating';
      if (t.status === 'Participating') return 'Participating';

      if (isLapsed(t.publish_date, todayIST)) {
        return 'Lapsed';
      }
      return 'New';
    };

    const mapDbStatusToPlainEnglish = (statusStr: string | null): string | null => {
      if (!statusStr) return null;
      if (statusStr === 'Issued') return 'New';
      if (statusStr === 'Lapsed (Unreviewed)') return 'Lapsed';
      if (statusStr === 'Filed') return 'Submitted';
      if (statusStr === 'Awarded') return 'Won';
      if (statusStr === 'Not Awarded') return 'Lost';
      if (statusStr === 'Business Loss due to Non-Submission') return 'Missed Deadline';
      if (statusStr === 'Business Loss due to Non-Participation') return 'Missed Opportunity';
      return statusStr;
    };

    tender.status = resolveStatus(tender, todayISTString);
    history = history.map(h => ({
      ...h,
      from_status: mapDbStatusToPlainEnglish(h.from_status),
      to_status: mapDbStatusToPlainEnglish(h.to_status) || 'New'
    }));

    // Fetch cached summaries if they exist
    if (tender.ai_details_summary && tender.ai_history_summary) {
      return NextResponse.json({
        success: true,
        tender,
        history,
        summaries: {
          detailsSummary: tender.ai_details_summary,
          statusHistorySummary: tender.ai_history_summary
        }
      });
    }

    // Generate local template-based summaries instantly for immediate response
    const fallbackDetails = generateDetailsSummary(tender);
    const fallbackHistory = generateStatusHistorySummary(history, tender.status || 'New');

    // Generate and cache the AI summaries asynchronously in the background
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      generateAiSummary(tender, history).then(({ detailsSummary, statusHistorySummary }) => {
        try {
          db.prepare('UPDATE tenders SET ai_details_summary = ?, ai_history_summary = ? WHERE id = ?')
            .run(detailsSummary, statusHistorySummary, id);
          console.log(`Cached background AI summaries for tender ${id}`);
        } catch (err) {
          console.error('Failed to cache background AI summaries:', err);
        }
      }).catch(err => {
        console.error('Background AI summary generation failed:', err);
      });
    }

    return NextResponse.json({
      success: true,
      tender,
      history,
      summaries: {
        detailsSummary: fallbackDetails,
        statusHistorySummary: fallbackHistory
      }
    });
  } catch (error) {
    console.error('Error fetching tender details:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const userRole = request.headers.get('x-user-role') || 'Unknown';
    const username = request.headers.get('x-user-username') || 'system';



    const body = await request.json();
    const { 
      status, 
      notes, 
      quoted_qty, 
      bid_qty, 
      mis_executive,
      working_path,
      assigned_mis_member,
      emd_amount_actual,
      emd_payment_mode,
      emd_payment_ref,
      emd_payment_date,
      loss_reason,
      payment_status,
      verification_status,
      submission_status,
      outcome_status,
      assigned_mis_member_emd,
      assigned_mis_member_docs,
      assigned_mis_member_submission,
      assigned_mis_member_spec,
      spec_verification_status
    } = body;

    // Check if tender exists
    const checkStmt = db.prepare('SELECT * FROM tenders WHERE id = ?');
    const oldTender = checkStmt.get(id) as any;

    if (!oldTender) {
      return NextResponse.json(
        { success: false, error: 'Tender not found' },
        { status: 404 }
      );
    }

    if (userRole === 'Specification Team' && oldTender.assigned_mis_member_spec !== username) {
      return NextResponse.json(
        { success: false, error: 'Access denied: This tender is not assigned to your Specification Team account' },
        { status: 403 }
      );
    }

    let query = 'UPDATE tenders SET';
    const updateParams: any[] = [];
    const fieldsToUpdate: string[] = [];
    const logDetails: string[] = [];

    if (status !== undefined && status !== oldTender.status) {
      fieldsToUpdate.push('status = ?');
      updateParams.push(status);
      logDetails.push(`status changed from '${oldTender.status}' to '${status}'`);
    }

    if (notes !== undefined && notes !== oldTender.notes) {
      fieldsToUpdate.push('notes = ?');
      updateParams.push(notes);
      logDetails.push(`notes updated`);
    }

    if (quoted_qty !== undefined && quoted_qty !== oldTender.quoted_qty) {
      fieldsToUpdate.push('quoted_qty = ?');
      updateParams.push(quoted_qty);
      logDetails.push(`quoted qty changed from ${oldTender.quoted_qty || 0} to ${quoted_qty}`);
    }

    if (bid_qty !== undefined && bid_qty !== oldTender.bid_qty) {
      fieldsToUpdate.push('bid_qty = ?');
      updateParams.push(bid_qty);
      logDetails.push(`bid qty changed from ${oldTender.bid_qty || 0} to ${bid_qty}`);
    }

    if (mis_executive !== undefined && mis_executive !== oldTender.mis_executive) {
      fieldsToUpdate.push('mis_executive = ?');
      updateParams.push(mis_executive || null);

      fieldsToUpdate.push('assigned_by = ?');
      updateParams.push(mis_executive ? username : null);

      fieldsToUpdate.push('assigned_at = ?');
      updateParams.push(mis_executive ? new Date().toISOString() : null);

      // Auto-participate if currently New, Issued, or Lapsed
      if (mis_executive && (!oldTender.status || oldTender.status === 'Issued' || oldTender.status === 'New' || oldTender.status === 'Lapsed' || oldTender.status === 'Lapsed (Unreviewed)')) {
        fieldsToUpdate.push('status = ?');
        updateParams.push('Participating');
        logDetails.push(`status auto-changed to 'Participating' on assignment`);
      }

      logDetails.push(mis_executive ? `assigned to executive '${mis_executive}'` : `unassigned executive`);
    }

    if (working_path !== undefined && working_path !== oldTender.working_path) {
      fieldsToUpdate.push('working_path = ?');
      updateParams.push(working_path || null);
      logDetails.push(`working path updated`);
    }

    if (assigned_mis_member !== undefined && assigned_mis_member !== oldTender.assigned_mis_member) {
      fieldsToUpdate.push('assigned_mis_member = ?');
      updateParams.push(assigned_mis_member || null);
      logDetails.push(`assigned MIS member changed to '${assigned_mis_member}'`);
    }

    if (assigned_mis_member_emd !== undefined && assigned_mis_member_emd !== oldTender.assigned_mis_member_emd) {
      fieldsToUpdate.push('assigned_mis_member_emd = ?');
      updateParams.push(assigned_mis_member_emd || null);
      logDetails.push(`assigned MIS member for EMD changed to '${assigned_mis_member_emd}'`);
    }

    if (assigned_mis_member_docs !== undefined && assigned_mis_member_docs !== oldTender.assigned_mis_member_docs) {
      fieldsToUpdate.push('assigned_mis_member_docs = ?');
      updateParams.push(assigned_mis_member_docs || null);
      logDetails.push(`assigned MIS member for Docs changed to '${assigned_mis_member_docs}'`);
    }

    if (assigned_mis_member_submission !== undefined && assigned_mis_member_submission !== oldTender.assigned_mis_member_submission) {
      fieldsToUpdate.push('assigned_mis_member_submission = ?');
      updateParams.push(assigned_mis_member_submission || null);
      logDetails.push(`assigned MIS member for Submission changed to '${assigned_mis_member_submission}'`);
    }

    if (emd_amount_actual !== undefined && emd_amount_actual !== oldTender.emd_amount_actual) {
      fieldsToUpdate.push('emd_amount_actual = ?');
      updateParams.push(emd_amount_actual === null ? null : emd_amount_actual);
      logDetails.push(`emd actual amount changed to ${emd_amount_actual}`);
    }

    if (emd_payment_mode !== undefined && emd_payment_mode !== oldTender.emd_payment_mode) {
      fieldsToUpdate.push('emd_payment_mode = ?');
      updateParams.push(emd_payment_mode || null);
      logDetails.push(`emd payment mode changed to '${emd_payment_mode}'`);
    }

    if (emd_payment_ref !== undefined && emd_payment_ref !== oldTender.emd_payment_ref) {
      fieldsToUpdate.push('emd_payment_ref = ?');
      updateParams.push(emd_payment_ref || null);
      logDetails.push(`emd payment ref changed`);
    }

    if (emd_payment_date !== undefined && emd_payment_date !== oldTender.emd_payment_date) {
      fieldsToUpdate.push('emd_payment_date = ?');
      updateParams.push(emd_payment_date || null);
      logDetails.push(`emd payment date changed`);
    }

    if (loss_reason !== undefined && loss_reason !== oldTender.loss_reason) {
      fieldsToUpdate.push('loss_reason = ?');
      updateParams.push(loss_reason || null);
      logDetails.push(`loss reason updated`);
    }

    if (payment_status !== undefined && payment_status !== oldTender.payment_status) {
      fieldsToUpdate.push('payment_status = ?');
      updateParams.push(payment_status);
      logDetails.push(`payment status changed from '${oldTender.payment_status}' to '${payment_status}'`);
    }

    if (verification_status !== undefined && verification_status !== oldTender.verification_status) {
      fieldsToUpdate.push('verification_status = ?');
      updateParams.push(verification_status);
      logDetails.push(`verification status changed from '${oldTender.verification_status}' to '${verification_status}'`);
    }

    if (submission_status !== undefined && submission_status !== oldTender.submission_status) {
      fieldsToUpdate.push('submission_status = ?');
      updateParams.push(submission_status);
      logDetails.push(`submission status changed from '${oldTender.submission_status}' to '${submission_status}'`);
    }

    if (outcome_status !== undefined && outcome_status !== oldTender.outcome_status) {
      fieldsToUpdate.push('outcome_status = ?');
      updateParams.push(outcome_status);
      logDetails.push(`outcome status changed from '${oldTender.outcome_status}' to '${outcome_status}'`);
    }

    if (spec_verification_status !== undefined && spec_verification_status !== oldTender.spec_verification_status) {
      fieldsToUpdate.push('spec_verification_status = ?');
      updateParams.push(spec_verification_status);
      logDetails.push(`spec verification status changed from '${oldTender.spec_verification_status}' to '${spec_verification_status}'`);
    }

    if (assigned_mis_member_spec !== undefined && assigned_mis_member_spec !== oldTender.assigned_mis_member_spec) {
      fieldsToUpdate.push('assigned_mis_member_spec = ?');
      updateParams.push(assigned_mis_member_spec || null);
      logDetails.push(`assigned Specification Team member changed to '${assigned_mis_member_spec}'`);
    }

    if (fieldsToUpdate.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Invalidate cached AI summaries since the tender state has changed
    fieldsToUpdate.push('ai_details_summary = NULL');
    fieldsToUpdate.push('ai_history_summary = NULL');

    query += ' ' + fieldsToUpdate.join(', ') + ' WHERE id = ?';
    updateParams.push(id);

    const updateStmt = db.prepare(query);
    updateStmt.run(...updateParams);

    // Log the activity to activity_log
    const logAction = (mis_executive !== undefined && mis_executive !== oldTender.mis_executive)
      ? 'Assigned Tender'
      : 'Updated Tender';
    addActivityLog(username, userRole, logAction, id, logDetails.join(', '));

    return NextResponse.json({ success: true, message: 'Tender updated successfully' });
  } catch (error) {
    console.error('Error updating tender:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const userRole = request.headers.get('x-user-role') || 'Unknown';
    const username = request.headers.get('x-user-username') || 'system';



    // Get tender title before deleting
    const tenderStmt = db.prepare('SELECT title FROM tenders WHERE id = ?');
    const tender = tenderStmt.get(id) as any;
    const title = tender ? tender.title : 'Unknown';

    const stmt = db.prepare('DELETE FROM tenders WHERE id = ?');
    const result = stmt.run(id);

    if (result.changes === 0) {
      return NextResponse.json(
        { success: false, error: 'Tender not found' },
        { status: 404 }
      );
    }

    // Log the activity to activity_log
    addActivityLog(username, userRole, 'Deleted Tender', null, `Deleted tender: ${title} (${id})`);

    return NextResponse.json({ success: true, message: 'Tender deleted successfully' });
  } catch (error) {
    console.error('Error deleting tender:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

function generateDetailsSummary(tender: any): string {
  const parts: string[] = [];
  
  const title = tender.title || 'Untitled Tender';
  const authority = tender.authority ? `issued by the ${tender.authority}` : '';
  const product = tender.product_name_as_per_tender || tender.title || 'specified goods/services';
  const vertical = tender.vertical_name ? `under the ${tender.vertical_name} vertical` : '';
  const sector = tender.sector ? `(${tender.sector} sector)` : '';
  
  let intro = `This tender, titled "${title}", ${authority ? authority + ' ' : ''}is for procuring "${product}"`;
  if (vertical || sector) {
    intro += ` ${vertical} ${sector}`;
  }
  intro += '.';
  parts.push(intro);

  const cost = tender.estimated_cost_raw && tender.estimated_cost_raw !== 'N/A' 
    ? `estimated value of ${tender.estimated_cost_raw}` 
    : '';
  const loc = tender.location && tender.location !== 'N/A' 
    ? `located at ${tender.location}` 
    : '';
  
  if (cost || loc) {
    let details = 'The project is';
    if (loc) details += ` ${loc}`;
    if (cost) details += loc ? ` with an ${cost}` : ` valued at ${cost}`;
    details += '.';
    parts.push(details);
  }

  const type = tender.tender_type ? `This is classified as a ${tender.tender_type} tender.` : '';
  if (type) parts.push(type);

  const due = tender.due_date ? `The final submission due date is scheduled for ${tender.due_date}.` : '';
  if (due) parts.push(due);

  const emd = tender.emd_raw && tender.emd_raw !== 'N/A' ? `EMD requirement is ${tender.emd_raw}` : '';
  const fee = tender.document_fee_raw && tender.document_fee_raw !== 'N/A' ? `document fee is ${tender.document_fee_raw}` : '';
  if (emd || fee) {
    let financial = 'Financial requirements include';
    if (emd) financial += ` an ${emd}`;
    if (fee) financial += emd ? ` and a ${fee}` : ` a ${fee}`;
    financial += '.';
    parts.push(financial);
  }

  const corrigendum = tender.corrigendum_remark === 'Yes' 
    ? 'Note: One or more corrigendum updates have been processed for this tender.' 
    : '';
  if (corrigendum) parts.push(corrigendum);

  return parts.join(' ');
}

function generateStatusHistorySummary(history: any[], currentStatus: string): string {
  if (history.length === 0) {
    return `This tender is currently in "${currentStatus}" status. No status transitions have been recorded yet.`;
  }

  const parts: string[] = [];
  const initial = history[0];
  const formattedInitialDate = formatDbDate(initial.changed_at);

  parts.push(`The tender was initially registered with status "${initial.to_status}" on ${formattedInitialDate}.`);

  const statusChanges = history.filter(h => h.from_status !== null && h.from_status !== h.to_status);
  if (statusChanges.length > 0) {
    const changeNarratives = statusChanges.map(change => {
      const dateStr = formatDbDate(change.changed_at);
      return `moved from "${change.from_status}" to "${change.to_status}" on ${dateStr}`;
    });
    parts.push(`It subsequently progressed through the following transitions: ${changeNarratives.join('; ')}.`);
  }

  const corrigendums = history.filter(h => h.notes && h.notes.includes('Corrigendum'));
  if (corrigendums.length > 0) {
    parts.push(`During its lifecycle, the system detected ${corrigendums.length} corrigendum/system alert updates.`);
  }

  parts.push(`The current active status is "${currentStatus}".`);

  return parts.join(' ');
}

function formatDbDate(dbDateStr: string): string {
  try {
    const date = new Date(dbDateStr.includes(' ') && !dbDateStr.includes('T') ? dbDateStr.replace(' ', 'T') + 'Z' : dbDateStr);
    if (isNaN(date.getTime())) {
      return dbDateStr;
    }
    return date.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (e) {
    return dbDateStr;
  }
}

// Generates professional AI summaries using Gemini (gemini-2.5-flash) with a structured JSON response
async function generateAiSummary(
  tender: any,
  history: any[]
): Promise<{ detailsSummary: string; statusHistorySummary: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Fallback standard summaries with setup tip
    const details = generateDetailsSummary(tender);
    const timeline = generateStatusHistorySummary(history, tender.status || 'New');
    return {
      detailsSummary: details,
      statusHistorySummary: timeline + "\n\n(Tip: Add GEMINI_API_KEY to your .env file to enable AI-powered summaries.)"
    };
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const prompt = `
      You are an expert bid analyst reviewing a tender for a business development team. Your goal is to write a highly insightful, professional, and natural-sounding AI summary.
      
      Analyze the provided tender details and status history, and return a JSON object with exactly two fields:
      - "detailsSummary": A professional, natural-language executive summary of the tender (3-5 sentences). Avoid rigid boilerplate starters like "This tender, reference ..., is issued by...". Instead, write like a smart analyst explaining the key points (e.g., what is being bought, who is buying it, estimated costs, location, EMD, fee, and due dates). Highlight any notable requirements, remaining deadline urgency, or key financial details.
      - "statusHistorySummary": An analytical progression summary (2-4 sentences). Summarize the tender's lifecycle from initial registration to its current status, highlighting any system updates, corrigendums, or if the status has remained unchanged since import. Do not use markdown headings or bullet points.

      Tender Details JSON:
      ${JSON.stringify(tender)}

      Status History JSON:
      ${JSON.stringify(history)}
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    const parsed = JSON.parse(text);

    return {
      detailsSummary: parsed.detailsSummary || generateDetailsSummary(tender),
      statusHistorySummary: parsed.statusHistorySummary || generateStatusHistorySummary(history, tender.status || 'New')
    };
  } catch (err) {
    console.error('AI Summary generation failed, falling back to templates:', err);
    return {
      detailsSummary: generateDetailsSummary(tender),
      statusHistorySummary: generateStatusHistorySummary(history, tender.status || 'New')
    };
  }
}
