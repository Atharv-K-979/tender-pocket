(() => {
  if (window.__complianceProgressLoaded) return;
  window.__complianceProgressLoaded = true;
  const originalFetch = window.fetch.bind(window);
  let timer = null;
  let activeTender = null;
  let uploadState = null;
  let generation = 0;
  let previousJob = null;
  let pollingHeaders = {};
  let pollInFlight = false;
  let latestData = null;
  let baselineKnown = false;
  let reviewNotes = [];
  let reviewDialog = null;
  let reviewOpener = null;

  const style = document.createElement("style");
  style.textContent = `
    #compliance-progress-panel{position:fixed;right:16px;bottom:16px;width:min(460px,calc(100vw - 32px));max-height:85vh;background:#101827;color:#eef2ff;border:1px solid #334155;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.3);z-index:2147483647;font-family:Inter,system-ui,sans-serif;overflow:auto}
    #compliance-progress-panel.cp-inline{position:relative;right:auto;bottom:auto;width:100%;max-height:none;margin-top:10px;box-shadow:none;z-index:auto}
    #compliance-progress-panel *{box-sizing:border-box}#compliance-progress-panel [hidden]{display:none!important}#compliance-progress-panel .cp-head{display:flex;justify-content:space-between;align-items:center;padding:15px 16px;border-bottom:1px solid #334155}
    #compliance-progress-panel .cp-title{font-size:14px;font-weight:750}#compliance-progress-panel .cp-close{border:0;background:transparent;color:#94a3b8;font-size:20px;cursor:pointer}
    #compliance-progress-panel .cp-body{padding:14px 16px}#compliance-progress-panel .cp-message{font-size:13px;line-height:1.45;margin-bottom:10px}
    #compliance-progress-panel .cp-track{height:8px;background:#263449;border-radius:8px;overflow:hidden}#compliance-progress-panel .cp-bar{height:100%;width:0;background:linear-gradient(90deg,#2563eb,#22c55e);transition:width .35s ease}
    #compliance-progress-panel .cp-upload{margin-bottom:12px}#compliance-progress-panel .cp-upload-label{display:flex;justify-content:space-between;margin-bottom:6px;color:#cbd5e1;font-size:11px}#compliance-progress-panel .cp-upload-bar{height:100%;width:0;background:#60a5fa;transition:width .15s linear}
    #compliance-progress-panel .cp-meta{display:flex;justify-content:space-between;margin-top:8px;color:#94a3b8;font-size:11px}
    #compliance-progress-panel .cp-events{margin-top:12px;max-height:270px;overflow:auto;border-top:1px solid #263449;padding-top:8px}
    #compliance-progress-panel .cp-event{font-size:11px;line-height:1.4;color:#cbd5e1;padding:5px 0;border-bottom:1px solid rgba(51,65,85,.45)}
    #compliance-progress-panel .cp-stage{color:#60a5fa;font-weight:700;margin-right:5px}#compliance-progress-panel .cp-failed{color:#fca5a5}#compliance-progress-panel .cp-done{color:#86efac}#compliance-progress-panel .cp-neutral{color:#cbd5e1}
    #compliance-progress-panel .cp-links{display:flex;flex-direction:column;gap:8px;margin-top:12px}#compliance-progress-panel .cp-links a{display:inline-block;margin:4px 8px 0 0;padding:6px;border-radius:4px;background:#2563eb;color:white;text-decoration:none;font-size:12px;font-weight:700}
    #compliance-progress-panel .cp-product{font-size:12px;border-top:1px solid #334155;padding-top:6px}
    #compliance-progress-panel .cp-warning{font-size:12px;color:#fbbf24;margin-top:8px}
    #compliance-progress-panel .cp-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin-top:12px;padding:10px;border:1px solid #334155;border-radius:6px;background:#0b1220;font-size:11px;color:#cbd5e1}
    #compliance-progress-panel .cp-metric-title{grid-column:1/-1;color:#f8fafc;font-weight:750;font-size:12px}
    #compliance-progress-panel .cp-metric strong{display:block;color:#f8fafc;font-size:12px;margin-top:2px}
    #compliance-progress-panel .cp-metric-warnings{grid-column:1/-1;color:#fbbf24;line-height:1.35}
    #compliance-progress-panel .cp-review-actions{margin-top:12px}
    #compliance-progress-panel .cp-review-button{display:inline-flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid #526169;border-radius:5px;background:#202c32;color:#edf4f2;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
    #compliance-progress-panel .cp-review-button:hover{background:#2a383e}
    #compliance-progress-panel .cp-review-count{min-width:24px;text-align:center;padding:2px 6px;border-radius:3px;background:#34464a;color:#bde2d8;font-size:11px}
    .cp-review-dialog{box-sizing:border-box;width:min(740px,calc(100vw - 24px));max-height:85vh;padding:0;border:1px solid #47545a;border-radius:8px;background:#161d22;color:#e8eef0;font:13px Inter,system-ui,sans-serif;box-shadow:0 20px 60px #0008;overflow:hidden}
    .cp-review-dialog[open]{display:flex;flex-direction:column}
    .cp-review-dialog::backdrop{background:rgba(0,0,0,.55)}
    .cp-review-dialog *{box-sizing:border-box;letter-spacing:0}
    .cp-review-heading{display:flex;justify-content:space-between;align-items:start;gap:16px;padding:20px 22px 14px}
    .cp-review-heading h2{font-size:18px;font-weight:650;margin:0 0 6px}
    .cp-review-context{font-size:12px;color:#a7b4bb;overflow-wrap:anywhere}
    .cp-review-close{flex:none;width:32px;height:32px;border:0;border-radius:4px;background:transparent;color:#c4cfd3;font-size:24px;cursor:pointer}
    .cp-review-close:hover{background:#2c363b}
    .cp-review-toolbar{display:flex;flex-wrap:wrap;gap:8px;padding:0 22px 16px;border-bottom:1px solid #364148}
    .cp-review-search{flex:1 1 190px;min-width:0;height:36px;padding:8px 10px;border:1px solid #526169;border-radius:4px;background:#101619;color:#eef2f3;font:inherit}
    .cp-review-search::placeholder{color:#9aabb3}
    .cp-review-download{height:36px;padding:0 12px;border:1px solid #526169;border-radius:4px;background:#26343a;color:#e8eef0;font:inherit;cursor:pointer}
    .cp-review-list{min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 22px 20px}
    .cp-review-group{margin:0;padding:0}
    .cp-review-group h3{display:flex;justify-content:space-between;gap:12px;margin:0;padding:18px 0 10px;color:#a8d5c8;font-size:12px;font-weight:600;overflow-wrap:anywhere}
    .cp-review-group ol{margin:0;padding:0;list-style:none}
    .cp-review-item{padding:12px 0;border-bottom:1px solid #303a40;overflow-wrap:anywhere}
    .cp-review-item h4{margin:0 0 6px;font-size:13px;font-weight:600;color:#edf2f3}
    .cp-review-item p{margin:0;color:#bdc9cf;font-size:13px;line-height:1.6}
    .cp-review-item details{margin-top:8px;color:#98a9b2;font-size:12px}
    .cp-review-item summary{cursor:pointer;width:fit-content}
    .cp-review-item details p{padding-top:8px;font-size:12px;color:#aebdc5}
    .cp-review-empty{padding:24px 0;color:#aebdc5}
    .cp-review-dialog button:focus-visible,.cp-review-dialog input:focus-visible,#compliance-progress-panel .cp-review-button:focus-visible{outline:2px solid #9dd4c3;outline-offset:3px}
    @media(max-width:480px){.cp-review-heading{padding:16px 14px 12px}.cp-review-toolbar{padding:0 14px 12px}.cp-review-list{padding:0 14px 16px}}
  `;
  document.head.appendChild(style);
  document.addEventListener("click", async event => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !/^\/api\/tenders\/[^/]+\/(?:tech-spec-download|documents)\/[^/]+$/.test(url.pathname)) return;
    event.preventDefault();
    try {
      const headers = new Headers();
      const token = localStorage.getItem("token");
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const user = JSON.parse(localStorage.getItem("currentUser") || "null");
      if (user) {
        headers.set("x-user-role", user.role);
        headers.set("x-user-username", user.username);
      }
      const response = await originalFetch(url.href, {headers, cache: "no-store"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      const download = document.createElement("a");
      download.href = objectUrl;
      download.download = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
      download.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      panel().querySelector(".cp-warning").textContent = `Download failed (${error.message}).`;
    }
  }, true);
  // The bundled review UI hides its executive-only controls from Admin. Restore the
  // standalone conversion action without granting clearance or bid-pack controls.
  function restoreAdminUpload() {
    let user;
    try { user = JSON.parse(localStorage.getItem("currentUser") || "null"); } catch (_) {}
    const route = location.pathname.match(/^\/tenders\/([^/]+)\/?$/);
    const existing = document.getElementById("compliance-admin-upload");
    if (user?.role !== "Admin" || !route) {
      existing?.remove();
      return;
    }
    const tenderId = decodeURIComponent(route[1]);
    if (existing?.dataset.tenderId === tenderId) return;
    existing?.remove();
    const heading = Array.from(document.querySelectorAll("h4")).find(node =>
      /Technical Specification (?:Review|Clearance)/.test(node.textContent));
    const card = heading?.parentElement?.parentElement;
    if (!card) return;
    const form = document.createElement("form");
    form.id = "compliance-admin-upload";
    form.dataset.tenderId = tenderId;
    form.style.cssText = "display:flex;flex-wrap:wrap;align-items:end;gap:10px;margin-top:12px";
    const label = document.createElement("label");
    label.style.cssText = "display:flex;flex:1 1 220px;min-width:0;flex-direction:column;gap:6px;font-size:12px";
    label.textContent = "Specification document (PDF / DOCX)";
    const input = document.createElement("input");
    input.type = "file";
    input.id = "compliance-admin-file";
    input.accept = ".pdf,.docx";
    input.required = true;
    input.style.cssText = "width:100%;min-width:0;font-size:12px;color:var(--text-primary)";
    label.appendChild(input);
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "btn btn-primary";
    submit.textContent = "Generate compliance sheets";
    const message = document.createElement("div");
    message.setAttribute("role", "status");
    message.style.cssText = "flex-basis:100%;font-size:12px;overflow-wrap:anywhere";
    form.append(label, submit, message);
    let busy = false;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !input.files?.[0]) return;
      busy = true;
      submit.disabled = true;
      input.disabled = true;
      submit.textContent = "Generating...";
      message.textContent = "";
      try {
        const body = new FormData();
        body.append("file", input.files[0]);
        const headers = new Headers({"x-user-role": user.role, "x-user-username": user.username});
        const token = localStorage.getItem("token");
        if (token) headers.set("Authorization", `Bearer ${token}`);
        const response = await window.fetch(`/api/tenders/${encodeURIComponent(tenderId)}/upload-tech-spec`,
          {method: "POST", headers, body});
        const result = await response.json();
        message.textContent = response.ok && result.success
          ? (result.message || "Compliance sheets are ready.")
          : (result.error || `Upload failed (HTTP ${response.status}).`);
      } catch (error) {
        message.textContent = `Upload failed: ${error.message}`;
      } finally {
        busy = false;
        submit.disabled = false;
        input.disabled = false;
        input.value = "";
        submit.textContent = "Generate compliance sheets";
      }
    });
    card.appendChild(form);
    if (latestData && activeTender === tenderId) render(latestData);
  }
  let uploadControlScheduled = false;
  function scheduleUploadControl() {
    if (uploadControlScheduled) return;
    uploadControlScheduled = true;
    queueMicrotask(() => {
      uploadControlScheduled = false;
      restoreAdminUpload();
    });
  }
  function watchUploadControl() {
    new MutationObserver(scheduleUploadControl).observe(document.body, {childList: true, subtree: true});
    window.addEventListener("popstate", scheduleUploadControl);
    window.addEventListener("hashchange", scheduleUploadControl);
    window.addEventListener("storage", scheduleUploadControl);
    scheduleUploadControl();
  }
  if (document.body) watchUploadControl();
  else document.addEventListener("DOMContentLoaded", watchUploadControl, {once: true});

  document.addEventListener("click", event => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.type === "file"
        && input.id.startsWith("techSpecUpload_")) input.value = "";
  }, true);

  function panel() {
    let root = document.getElementById("compliance-progress-panel");
    if (root) return root;
    root = document.createElement("section");
    root.id = "compliance-progress-panel";
    root.innerHTML = `<div class="cp-head"><div class="cp-title">Compliance sheet progress</div><button class="cp-close" title="Hide">&times;</button></div><div class="cp-body"><div class="cp-upload" hidden><div class="cp-upload-label"><span>Uploading document</span><span class="cp-upload-value">0%</span></div><div class="cp-track"><div class="cp-upload-bar"></div></div></div><div class="cp-message">Starting upload...</div><div class="cp-track"><div class="cp-bar"></div></div><div class="cp-meta"><span class="cp-percent">0%</span><span class="cp-counts"></span></div><div class="cp-metrics" hidden></div><div class="cp-review-actions" hidden><button type="button" class="cp-review-button" aria-haspopup="dialog" aria-controls="compliance-review-dialog">Review notes <span class="cp-review-count">0</span></button></div><div class="cp-events"></div><div class="cp-links"></div></div>`;
    root.querySelector(".cp-review-button").addEventListener("click", event => {
      reviewOpener = event.currentTarget;
      openReviewNotes();
    });
    root.querySelector(".cp-close").addEventListener("click", () => root.remove());
    root.querySelector(".cp-close").type = "button";
    const uploadForm = document.getElementById("compliance-admin-upload");
    if (uploadForm && uploadForm.dataset.tenderId === activeTender) {
      // This subtree belongs to this script, so inline progress cannot cover the upload button.
      root.classList.add("cp-inline");
      root.style.flexBasis = "100%";
      uploadForm.appendChild(root);
    } else document.body.appendChild(root);
    const warning = document.createElement("div");
    warning.className = "cp-warning";
    warning.setAttribute("role", "status");
    root.querySelector(".cp-body").appendChild(warning);
    return root;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
    return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
  }

  function renderUpload(root) {
    const section = root.querySelector(".cp-upload");
    if (!uploadState) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const percent = Math.max(0, Math.min(100, uploadState.percent || 0));
    root.querySelector(".cp-upload-bar").style.width = `${percent}%`;
    root.querySelector(".cp-upload-value").textContent = uploadState.total
      ? `${formatBytes(uploadState.loaded)} / ${formatBytes(uploadState.total)} (${percent}%)`
      : `${formatBytes(uploadState.loaded)} uploaded`;
  }

  function formatDuration(milliseconds) {
    const value = Number(milliseconds || 0);
    if (value < 1000) return `${Math.round(value)} ms`;
    if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
    return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
  }

  function isReviewNote(text) {
    return typeof text === "string" && /review warning:|native PDF reading|source clause numbers|review clause coverage|review required:|included technical clause .*missing from rows|unclear\s*\/\s*requires clarification/i.test(text);
  }

  function cleanReviewNote(text) {
    return text.replace(/^.*?Review warning:\s*/i, "").replace(/^Batch \d+\/\d+:\s*/i, "").trim();
  }

  function collectReviewNotes(root, data) {
    const notes = new Set(reviewNotes);
    (data.metrics?.warnings || []).filter(isReviewNote).forEach(note => notes.add(cleanReviewNote(note)));
    (data.events || []).forEach(event => {
      if (isReviewNote(event.message)) notes.add(cleanReviewNote(event.message));
    });
    const changed = notes.size !== reviewNotes.length;
    reviewNotes = Array.from(notes);
    root.querySelector(".cp-review-actions").hidden = !reviewNotes.length;
    root.querySelector(".cp-review-count").textContent = reviewNotes.length;
    if (changed && reviewDialog?.open) renderReviewNotes();
  }

  function reviewParts(note) {
    const source = note.match(/\[(PDF[^\]]+)\]\s*$/)?.[1] || "General review";
    const clause = note.match(/^Clause\s+([^:]+):/i)?.[1];
    const wording = /native PDF reading/i.test(note);
    const coverage = /source clause numbers|clause coverage/i.test(note);
    return {
      source,
      title: clause ? `Clause ${clause}` : coverage ? "Clause coverage" : "Review note",
      summary: wording ? "Check the wording and numerical values against the source page."
        : coverage ? "Check clause coverage against the tender. Extracted rows have been retained." : note,
      original: note
    };
  }

  function openReviewNotes() {
    if (!reviewDialog) {
      reviewDialog = document.createElement("dialog");
      reviewDialog.id = "compliance-review-dialog";
      reviewDialog.className = "cp-review-dialog";
      reviewDialog.setAttribute("aria-labelledby", "cp-review-title");
      reviewDialog.innerHTML = `<header class="cp-review-heading"><div><h2 id="cp-review-title">Review notes</h2><div class="cp-review-context"></div></div><button type="button" class="cp-review-close" aria-label="Close review notes" title="Close review notes">&times;</button></header><div class="cp-review-toolbar"><input class="cp-review-search" type="search" aria-label="Search review notes" placeholder="Search clause, page or note"><button type="button" class="cp-review-download">Download notes</button></div><div class="cp-review-list"></div>`;
      document.body.appendChild(reviewDialog);
      reviewDialog.querySelector(".cp-review-close").addEventListener("click", () => reviewDialog.close());
      reviewDialog.addEventListener("close", () => {
        if (reviewOpener?.isConnected) reviewOpener.focus({preventScroll: true});
      });
      reviewDialog.addEventListener("click", event => {
        const rect = reviewDialog.getBoundingClientRect();
        if (event.target === reviewDialog && (event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom)) reviewDialog.close();
      });
      reviewDialog.querySelector(".cp-review-search").addEventListener("input", renderReviewNotes);
      reviewDialog.querySelector(".cp-review-download").addEventListener("click", () => {
        const text = `Compliance review notes\nTender: ${activeTender || ""}\n\n`
          + reviewNotes.map((note, index) => `${index + 1}. ${note}`).join("\n\n");
        const url = URL.createObjectURL(new Blob([text], {type: "text/plain;charset=utf-8"}));
        const link = document.createElement("a");
        link.href = url;
        link.download = `Review_notes_${String(activeTender || "tender").replace(/[^a-z0-9_-]/gi, "_")}.txt`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }
    reviewDialog.querySelector(".cp-review-search").value = "";
    renderReviewNotes();
    if (!reviewDialog.open) reviewDialog.showModal();
    reviewDialog.querySelector(".cp-review-search").focus();
  }

  function renderReviewNotes() {
    const query = reviewDialog.querySelector(".cp-review-search").value.trim().toLowerCase();
    const shown = reviewNotes.filter(note => note.toLowerCase().includes(query)).map(reviewParts);
    reviewDialog.querySelector(".cp-review-context").textContent =
      `${shown.length} of ${reviewNotes.length} notes | Tender ${activeTender || ""}`;
    const list = reviewDialog.querySelector(".cp-review-list");
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    const groups = new Map();
    shown.forEach(note => {
      if (!groups.has(note.source)) groups.set(note.source, []);
      groups.get(note.source).push(note);
    });
    const pageNumber = source => Number(source.match(/PDF p\.\s*(\d+)/)?.[1] || Number.MAX_SAFE_INTEGER);
    Array.from(groups).sort(([a], [b]) => pageNumber(a) - pageNumber(b)).forEach(([source, notes]) => {
      const group = document.createElement("section");
      group.className = "cp-review-group";
      const heading = document.createElement("h3");
      heading.textContent = source;
      const count = document.createElement("span");
      count.textContent = `${notes.length} ${notes.length === 1 ? "note" : "notes"}`;
      heading.appendChild(count);
      const items = document.createElement("ol");
      notes.forEach(note => {
        const item = document.createElement("li");
        item.className = "cp-review-item";
        const title = document.createElement("h4");
        title.textContent = note.title;
        const text = document.createElement("p");
        text.textContent = note.summary;
        item.append(title, text);
        if (note.summary !== note.original) {
          const details = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = "Original note";
          const original = document.createElement("p");
          original.textContent = note.original;
          details.append(summary, original);
          item.appendChild(details);
        }
        items.appendChild(item);
      });
      group.append(heading, items);
      list.appendChild(group);
    });
    if (!shown.length) {
      const empty = document.createElement("p");
      empty.className = "cp-review-empty";
      empty.textContent = "No matching review notes.";
      list.appendChild(empty);
    }
    list.scrollTop = query ? 0 : scrollTop;
  }

  function renderMetrics(root, metrics) {
    const section = root.querySelector(".cp-metrics");
    if (!metrics) {
      section.hidden = true;
      section.replaceChildren();
      return;
    }
    section.hidden = false;
    section.replaceChildren();
    const tokens = metrics.tokens || {};
    const retries = metrics.retries || {};
    const durations = metrics.durationsMs || {};
    const documentCounts = metrics.document || {};
    const values = [
      ["Total tokens", Number(tokens.total || 0).toLocaleString("en-IN")],
      ["Input tokens", `${Number(tokens.input || 0).toLocaleString("en-IN")} (${Number(tokens.cachedInput || 0).toLocaleString("en-IN")} cached)`],
      ["Output tokens", `${Number(tokens.output || 0).toLocaleString("en-IN")} (${Number(tokens.reasoning || 0).toLocaleString("en-IN")} reasoning)`],
      ["API calls", `${metrics.successfulModelResponses || 0}/${metrics.apiAttempts || 0} successful`],
      ["Retries", `${retries.validation || 0} validation, ${retries.ocr || 0} OCR, ${retries.split || 0} split, ${retries.rateLimit || 0} rate limit`],
      ["Document", `${documentCounts.pages || 0} pages, ${documentCounts.batches || 0} batches, ${documentCounts.products || 0} products, ${documentCounts.clauses || 0} clauses`],
      ["AI time", formatDuration(durations.api)],
      ["Extraction / rendering", `${formatDuration(durations.extraction)} / ${formatDuration(durations.rendering)}`],
      ["Total time", formatDuration(durations.total)],
      ["Estimated cost", metrics.estimatedCostInr == null ? "Unavailable" : new Intl.NumberFormat("en-IN", {style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 4}).format(metrics.estimatedCostInr)],
      ["Model", metrics.model || "gpt-5-nano"]
    ];
    const title = document.createElement("div");
    title.className = "cp-metric-title";
    title.textContent = "AI usage and timing";
    section.appendChild(title);
    values.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "cp-metric";
      item.append(document.createTextNode(label));
      const strong = document.createElement("strong");
      strong.textContent = value;
      item.appendChild(strong);
      section.appendChild(item);
    });
    const warnings = (metrics.warnings || []).filter(note => !isReviewNote(note));
    if (warnings.length) {
      const warning = document.createElement("div");
      warning.className = "cp-metric-warnings";
      warning.textContent = warnings.join(" ");
      section.appendChild(warning);
    }
  }

  function render(data) {
    latestData = data;
    const root = panel();
    const terminal = data.status === "COMPLETED" || data.status === "FAILED";
    renderUpload(root);
    renderMetrics(root, data.metrics);
    collectReviewNotes(root, data);
    root.querySelector(".cp-message").textContent = isReviewNote(data.message) && !terminal
      ? "Review note recorded." : data.message || "Processing...";
    root.querySelector(".cp-message").className = "cp-message " +
      (data.status === "FAILED" ? "cp-failed" : data.status === "COMPLETED"
        ? (data.generated === false ? "cp-neutral" : "cp-done") : "");
    const percent = Number.isFinite(data.percent) ? data.percent : 0;
    root.querySelector(".cp-bar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
    root.querySelector(".cp-percent").textContent = `Workflow ${percent}%`;
    const batchText = data.totalBatches ? `Batches ${data.completedBatches || 0}/${data.totalBatches}` : "";
    const clauseText = data.clauses ? `${data.clauses} requirements` : "";
    root.querySelector(".cp-counts").textContent = [batchText, clauseText].filter(Boolean).join(" | ");

    const events = root.querySelector(".cp-events");
    events.replaceChildren();
    (data.events || []).filter(event => !isReviewNote(event.message)).slice(-30).forEach(event => {
      const row = document.createElement("div");
      row.className = "cp-event";
      const stage = document.createElement("span");
      stage.className = "cp-stage";
      stage.textContent = `[${String(event.stage || "WORKING").replaceAll("_", " ")}]`;
      row.append(stage, document.createTextNode(` ${event.message || ""}`));
      events.appendChild(row);
    });
    events.scrollTop = events.scrollHeight;

    const links = root.querySelector(".cp-links");
    links.replaceChildren();
    if (data.combined && data.generated !== false) {
      const name = document.createElement("div");
      name.textContent = "Combined technical specifications";
      links.appendChild(name);
      if (data.pdfDownloadUrl) links.appendChild(downloadLink(data.pdfDownloadUrl, "PDF"));
      if (data.docxDownloadUrl) links.appendChild(downloadLink(data.docxDownloadUrl, "Word DOCX"));
      if (data.xlsxDownloadUrl) links.appendChild(downloadLink(data.xlsxDownloadUrl, "Excel XLSX"));
    } else if (data.products && data.products.length) {
      data.products.forEach(product => {
        const group = document.createElement("div");
        group.className = "cp-product";
        const name = document.createElement("div");
        name.textContent = `Schedule ${product.scheduleNumber}: ${product.productName}`;
        group.appendChild(name);
        group.appendChild(downloadLink(product.pdfDownloadUrl, "PDF"));
        group.appendChild(downloadLink(product.docxDownloadUrl, "Word DOCX"));
        group.appendChild(downloadLink(product.xlsxDownloadUrl, "Excel XLSX"));
        links.appendChild(group);
      });
    } else {
      if (data.pdfDownloadUrl) links.appendChild(downloadLink(data.pdfDownloadUrl, "Download PDF"));
      if (data.docxDownloadUrl) links.appendChild(downloadLink(data.docxDownloadUrl, "Download DOCX"));
      if (data.xlsxDownloadUrl) links.appendChild(downloadLink(data.xlsxDownloadUrl, "Download XLSX"));
    }
    return terminal;
  }

  function downloadLink(href, label) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.setAttribute("download", "");
    return link;
  }

  async function poll() {
    if (!activeTender || pollInFlight) return;
    const current = generation;
    pollInFlight = true;
    try {
      const response = await originalFetch(`/api/tenders/${encodeURIComponent(activeTender)}/tech-spec-progress`,
        {cache: "no-store", headers: pollingHeaders});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (current !== generation) return;
      panel().querySelector(".cp-warning").textContent = "";
      if (data.status !== "NOT_STARTED" && (!previousJob || data.jobId !== previousJob)) {
        if (!baselineKnown && (data.status === "COMPLETED" || data.status === "FAILED")) return;
        const done = render(data);
        if (done) {
          clearInterval(timer);
          timer = null;
        }
      }
    } catch (error) {
      if (current === generation) panel().querySelector(".cp-warning").textContent =
        `Progress temporarily unavailable (${error.message}). Retrying...`;
    } finally { pollInFlight = false; }
  }

  function xhrUpload(url, init, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(init.method || "POST", url, true);
      xhr.responseType = "blob";
      const headers = new Headers(init.headers || {});
      headers.forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.upload.addEventListener("progress", event => {
        const total = event.lengthComputable ? event.total : (uploadState && uploadState.total) || 0;
        const percent = total ? Math.round((event.loaded / total) * 100) : 0;
        onProgress(event.loaded, total, percent);
      });
      xhr.upload.addEventListener("load", () => {
        const total = (uploadState && uploadState.total) || 0;
        onProgress(total, total, 100);
      });
      xhr.onerror = () => reject(new TypeError("Network request failed"));
      xhr.onabort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      xhr.onload = () => {
        const total = (uploadState && uploadState.total) || 0;
        onProgress(total, total, 100);
        const responseHeaders = new Headers();
        xhr.getAllResponseHeaders().trim().split(/[\r\n]+/).forEach(line => {
          const separator = line.indexOf(":");
          if (separator > 0) responseHeaders.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
        });
        resolve(new Response(xhr.response, {status: xhr.status, statusText: xhr.statusText, headers: responseHeaders}));
      };
      if (init.signal) {
        if (init.signal.aborted) return reject(new DOMException("The operation was aborted.", "AbortError"));
        init.signal.addEventListener("abort", () => xhr.abort(), {once: true});
      }
      xhr.send(init.body);
    });
  }

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input && input.url;
    const match = url && url.match(/\/api\/tenders\/([^/]+)\/upload-tech-spec(?:\?|$)/);
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!match || method !== "POST") return originalFetch(input, init);

    activeTender = decodeURIComponent(match[1]);
    const current = ++generation;
    reviewNotes = [];
    if (reviewDialog?.open) reviewDialog.close();
    pollingHeaders = new Headers(init.headers || {});
    pollingHeaders.delete("Content-Type");
    try {
      const token = localStorage.getItem("token");
      if (token && !pollingHeaders.has("Authorization")) pollingHeaders.set("Authorization", `Bearer ${token}`);
    } catch (_) {}
    const file = init.body instanceof FormData ? init.body.get("file") : null;
    uploadState = {loaded: 0, total: file instanceof Blob ? file.size : 0, percent: 0};
    render({status: "UPLOADING", message: "Uploading tender document...", percent: 0, events: []});
    clearInterval(timer);
    try {
      // Capture the previous job before POST so its completed status cannot terminate this upload.
      previousJob = null;
      baselineKnown = false;
      try {
        const baseline = await originalFetch(`/api/tenders/${encodeURIComponent(activeTender)}/tech-spec-progress`,
          {cache: "no-store", headers: pollingHeaders, signal: AbortSignal.timeout(3000)});
        if (baseline.ok) {
          previousJob = (await baseline.json()).jobId || null;
          baselineKnown = true;
        }
      } catch (_) {}
      if (current !== generation) return originalFetch(input, init);
      timer = setInterval(poll, 1000);
      const response = init.body instanceof FormData
        ? await xhrUpload(url, init, (loaded, total, percent) => {
            if (current !== generation) return;
            uploadState = {loaded, total, percent};
            if (latestData && latestData.status !== "UPLOADING") renderUpload(panel());
            else render({status: "UPLOADING", message: percent === 100
              ? "Upload complete. Waiting for extraction..." : "Uploading tender document...", percent: 0, events: []});
          })
        : await originalFetch(input, init);
      if (current !== generation) return response;
      const result = await response.clone().json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        clearInterval(timer); timer = null;
        render({...result, status: "FAILED", message: result.error || `Conversion failed (HTTP ${response.status}).`,
          percent: latestData?.percent || 0, events: latestData?.events || []});
      } else if (result.success) {
        clearInterval(timer); timer = null;
        render({...result, status: "COMPLETED", percent: 100,
          message: result.message, events: latestData?.events || []});
      } else setTimeout(poll, 100);
      return response;
    } catch (error) {
      if (current !== generation) throw error;
      clearInterval(timer);
      timer = null;
      render({status: "FAILED", message: `Upload failed: ${error.message}`, percent: 0, events: []});
      throw error;
    }
  };
})();
