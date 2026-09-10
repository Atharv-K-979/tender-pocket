const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const path = require('path');

// Read environment variables
const smtpUser = process.env.SMTP_USER || process.env.IMAP_USER;
const smtpPass = process.env.SMTP_PASSWORD || process.env.IMAP_PASSWORD;
const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
const smtpSecure = process.env.SMTP_SECURE !== 'false';
const managerEmail = process.env.MANAGER_EMAIL || smtpUser;

if (!smtpUser || !smtpPass) {
  console.error('CRITICAL: IMAP_USER/IMAP_PASSWORD or SMTP_USER/SMTP_PASSWORD env variables are required to send email alerts.');
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'tenders.db');
const db = new Database(dbPath);

console.log('--- TenderPocket Alert Engine Started ---');
console.log(`Using SMTP Config: Host=${smtpHost}, Port=${smtpPort}, Secure=${smtpSecure}, User=${smtpUser}`);
console.log(`Alert Recipient (Manager Email): ${managerEmail}`);

// Helper to compute local IST Date string (YYYY-MM-DD)
function getISTDate() {
  const now = new Date();
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-IN', options);
  const parts = formatter.formatToParts(now);
  const day = parts.find(p => p.type === 'day').value;
  const month = parts.find(p => p.type === 'month').value;
  const year = parts.find(p => p.type === 'year').value;
  return `${year}-${month}-${day}`;
}

// Helper to parse any date string (YYYY-MM-DD or DD Mon YYYY) into a UTC Date object representing midnight of that day
function parseToUTCDate(dateStr) {
  if (!dateStr) return null;
  
  // Try YYYY-MM-DD
  const ymdMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    return new Date(Date.UTC(parseInt(ymdMatch[1], 10), parseInt(ymdMatch[2], 10) - 1, parseInt(ymdMatch[3], 10)));
  }
  
  // Try D Month YYYY (e.g. 7 Jun 2026)
  const dmyMatch = dateStr.match(/^(\d{1,2})\s+([a-zA-Z]{3,})\s+(\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const monthStr = dmyMatch[2].toLowerCase().substring(0, 3);
    const year = parseInt(dmyMatch[3], 10);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIdx = months.indexOf(monthStr);
    if (monthIdx !== -1) {
      return new Date(Date.UTC(year, monthIdx, day));
    }
  }

  // Fallback: parse using default parser but construct UTC from it
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    const isISO = dateStr.includes('-') && !dateStr.includes(' ');
    if (isISO) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    } else {
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  }
  return null;
}

const todayISTStr = getISTDate();
const todayUTC = parseToUTCDate(todayISTStr);

console.log(`Today's IST Date: ${todayISTStr}`);

// Helper to compute days diff from todayUTC
function getDaysDiff(dueDateStr) {
  if (!dueDateStr) return null;
  try {
    const dueUTC = parseToUTCDate(dueDateStr);
    if (!dueUTC || !todayUTC) return null;
    const diffTime = dueUTC.getTime() - todayUTC.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  } catch (e) {
    return null;
  }
}

// Helper to compute elapsed days between two date strings
function getDaysDiffBetween(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return null;
  try {
    const d1 = parseToUTCDate(dateStr1);
    const d2 = parseToUTCDate(dateStr2);
    if (!d1 || !d2) return null;
    const diffTime = d1.getTime() - d2.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  } catch (e) {
    return null;
  }
}

// Fetch active tenders
const tenders = db.prepare("SELECT * FROM tenders WHERE status IN ('Issued', 'Participating')").all();

const slaAlerts = [];
const dueIssuedAlerts = [];
const dueReadyAlerts = []; // We will map Participating tenders to this list for alerts layout

for (const t of tenders) {
  // 1. Issue Date SLA check: Send alert at T+3 days if status is still 'Issued'
  if (t.status === 'Issued' && t.entry_date) {
    const elapsedDays = getDaysDiffBetween(todayISTStr, t.entry_date);
    if (elapsedDays === 3) {
      slaAlerts.push({ tender: t, elapsedDays });
    }
  }

  // 2. Due Date warnings: Send warning at T2-3 and T2 days for both 'Issued' and 'Participating'
  const diffDays = getDaysDiff(t.due_date);
  if (diffDays !== null) {
    if (diffDays === 3 || diffDays === 0) {
      if (t.status === 'Issued') {
        dueIssuedAlerts.push({ tender: t, diffDays });
      } else if (t.status === 'Participating') {
        dueReadyAlerts.push({ tender: t, diffDays });
      }
    }
  }
}

console.log(`Analyzed ${tenders.length} active tenders.`);
console.log(`- SLA Alerts (T+3): ${slaAlerts.length}`);
console.log(`- Due Alerts (T2-3 / T2) for Issued Tenders: ${dueIssuedAlerts.length}`);
console.log(`- Due Alerts (T2-3 / T2) for Ready to File Tenders: ${dueReadyAlerts.length}`);

if (slaAlerts.length === 0 && dueIssuedAlerts.length === 0 && dueReadyAlerts.length === 0) {
  console.log('No tenders matching alert thresholds today. Exiting.');
  process.exit(0);
}

// Compile HTML Email Body
const style = `
  body { font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; background-color: #0b0f19; color: #f8fafc; padding: 20px; }
  .container { max-width: 650px; margin: 0 auto; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(30, 41, 59, 0.8); border-radius: 12px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
  h1 { font-family: 'Outfit', sans-serif; color: #818cf8; font-size: 24px; border-bottom: 2px solid rgba(129, 140, 248, 0.2); padding-bottom: 12px; margin-top: 0; }
  h2 { font-family: 'Outfit', sans-serif; font-size: 18px; margin-top: 24px; margin-bottom: 12px; }
  .sla-header { color: #f87171; }
  .issued-header { color: #fbbf24; }
  .ready-header { color: #a78bfa; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; background: rgba(30, 41, 59, 0.4); border-radius: 6px; overflow: hidden; }
  th { background-color: rgba(129, 140, 248, 0.1); color: #818cf8; text-align: left; padding: 10px; font-size: 13px; font-weight: 600; border-bottom: 1px solid rgba(226,232,240,0.1); }
  td { padding: 10px; font-size: 13px; border-bottom: 1px solid rgba(226,232,240,0.05); color: #cbd5e1; }
  .urgent-badge { background: rgba(239, 68, 68, 0.2); color: #f87171; font-weight: bold; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  .warning-badge { background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-weight: bold; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  .info-badge { background: rgba(56, 189, 248, 0.2); color: #38bdf8; font-weight: bold; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
  .btn { display: inline-block; background: #6366f1; color: #ffffff; text-decoration: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: bold; }
  .footer { margin-top: 30px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid rgba(226,232,240,0.1); padding-top: 12px; }
`;

let htmlContent = `
<html>
<head>
  <style>${style}</style>
</head>
<body>
  <div class="container">
    <h1>TenderPocket Action Alerts Digest</h1>
    <p style="color: #94a3b8; font-size: 14px;">The following tenders require attention today (IST Date: ${todayISTStr}).</p>
`;

if (slaAlerts.length > 0) {
  htmlContent += `
    <h2 class="sla-header">⚠️ Action Required: Pending Acceptance/Rejection (Issue Date T+3)</h2>
    <p style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">These tenders have been in 'Issued' state for 3 days without being accepted or rejected.</p>
    <table>
      <thead>
        <tr>
          <th>Bid Number / ID</th>
          <th>Tender Title</th>
          <th>Authority</th>
          <th>Issue Date</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
  `;
  for (const { tender, elapsedDays } of slaAlerts) {
    htmlContent += `
      <tr>
        <td><strong>${tender.ref_no || tender.id}</strong></td>
        <td>${tender.title}</td>
        <td>${tender.authority || 'N/A'}</td>
        <td>${tender.entry_date}</td>
        <td><span class="urgent-badge">Pending 3 Days</span></td>
      </tr>
    `;
  }
  htmlContent += `
      </tbody>
    </table>
  `;
}

if (dueIssuedAlerts.length > 0) {
  htmlContent += `
    <h2 class="issued-header">⏳ Issued Bids Nearing Due Date (T2-3, T2)</h2>
    <table>
      <thead>
        <tr>
          <th>Bid Number / ID</th>
          <th>Tender Title</th>
          <th>Authority</th>
          <th>Due Date</th>
          <th>Days Left</th>
        </tr>
      </thead>
      <tbody>
  `;
  for (const { tender, diffDays } of dueIssuedAlerts) {
    const badge = diffDays === 0 ? '<span class="urgent-badge">TODAY (T2)</span>' : '<span class="warning-badge">T2-3 Days</span>';
    htmlContent += `
      <tr>
        <td><strong>${tender.ref_no || tender.id}</strong></td>
        <td>${tender.title}</td>
        <td>${tender.authority || 'N/A'}</td>
        <td>${tender.due_date}</td>
        <td>${badge}</td>
      </tr>
    `;
  }
  htmlContent += `
      </tbody>
    </table>
  `;
}

if (dueReadyAlerts.length > 0) {
  htmlContent += `
    <h2 class="ready-header">📦 Participating Bids Nearing Due Date (T2-3, T2)</h2>
    <table>
      <thead>
        <tr>
          <th>Bid Number / ID</th>
          <th>Tender Title</th>
          <th>Authority</th>
          <th>Due Date</th>
          <th>Templates</th>
          <th>Days Left</th>
        </tr>
      </thead>
      <tbody>
  `;
  for (const { tender, diffDays } of dueReadyAlerts) {
    const badge = diffDays === 0 ? '<span class="urgent-badge">TODAY (T2)</span>' : '<span class="warning-badge">T2-3 Days</span>';
    const zipName = `Tender_Templates_${tender.id}.zip`;
    const zipUrl = `http://localhost:3000/documents/${tender.id}/${zipName}`;
    htmlContent += `
      <tr>
        <td><strong>${tender.ref_no || tender.id}</strong></td>
        <td>${tender.title}</td>
        <td>${tender.authority || 'N/A'}</td>
        <td>${tender.due_date}</td>
        <td><a href="${zipUrl}" class="btn">Get ZIP</a></td>
        <td>${badge}</td>
      </tr>
    `;
  }
  htmlContent += `
      </tbody>
    </table>
  `;
}

htmlContent += `
    <div class="footer">
      This is an automated warning alert sent by TenderPocket.<br/>
      Workspace directory: <code>/Users/anuthibhansali/.gemini/antigravity/scratch/tender-pocket</code>
    </div>
  </div>
</body>
</html>
`;

// Set up Nodemailer transporter
const transporterOptions = {
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: smtpUser,
    pass: smtpPass
  }
};

if (smtpHost === 'smtp.gmail.com') {
  transporterOptions.service = 'gmail';
}

const transporter = nodemailer.createTransport(transporterOptions);

async function sendEmail() {
  const mailOptions = {
    from: smtpUser,
    to: managerEmail,
    subject: `[TenderPocket Alert] Action Required: Tender Deadlines & Pending SLA (IST: ${todayISTStr})`,
    html: htmlContent
  };

  console.log('Sending email alert via nodemailer...');
  let retries = 3;
  for (let i = 0; i < retries; i++) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`Alert email sent successfully. Message ID: ${info.messageId}`);
      process.exit(0);
    } catch (error) {
      if (i === retries - 1) {
        console.error('Failed to send email alert after all retries:', error);
        process.exit(1);
      }
      console.warn(`[Network Retry] Email sending failed: ${error.message}. Retrying in 10s (attempt ${i + 1}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

sendEmail();
