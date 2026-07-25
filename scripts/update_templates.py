import re
import os

def update_file(file_path, update_css=False):
    print(f"Updating file: {file_path}")
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Define the 15 page classes in order
    page_classes = [
        "page-doc-1",  # 1: Bid Form
        "page-doc-2",  # 2: Bid Security
        "page-doc-3",  # 3: Bidder Particulars
        "page-doc-4",  # 4: Local Content
        "page-doc-5",  # 5: Availability of Spares
        "page-doc-6",  # 6: Country of Origin
        "page-doc-7",  # 7: Demonstration
        "page-doc-8",  # 8: Non-blacklisting
        "page-doc-9",  # 9: Warranty Undertaking Standard
        "page-doc-10", # 10: Acceptance of Tender Terms
        "page-doc-11", # 11: Price Declaration
        "page-doc-12", # 12: Financial Standing
        "page-doc-13", # 13: Special Warranty
        "page-doc-14", # 14: Details of After Sales
        "page-doc-15", # 15: Escalation Matrix
    ]

    # If update_css is True, let's first update the style block and wrapPage definition in test-pdf-generation.js
    if update_css:
        # 1. Update wrapPage signature and div
        old_wrap = "const wrapPage = (content, title) => `\n    <div class=\"page\">"
        new_wrap = "const wrapPage = (content, title, pageClass = '') => `\n    <div class=\"page ${pageClass}\">"
        if old_wrap in content:
            content = content.replace(old_wrap, new_wrap, 1)
        else:
            # Try regex
            content = re.sub(r'const wrapPage = \(([^)]+)\) => `\s*<div class="page">', r'const wrapPage = (\1, pageClass = "") => `\n    <div class="page ${pageClass}">', content, 1)

        # 2. Update CSS styles block
        # We find from `.page {` to `tr { page-break-inside: avoid; }` (or similar)
        # Let's locate the CSS block inside <style>
        css_start_idx = content.find('.page {')
        css_end_idx = content.find('tr {\n          page-break-inside: avoid;\n        }')
        if css_start_idx != -1 and css_end_idx != -1:
            css_end_idx += len('tr {\n          page-break-inside: avoid;\n        }')
            new_css = """.page {
          box-sizing: border-box;
          width: 210mm;
          padding: 30px 42.5px 40px 42.5px;
          position: relative;
          page-break-after: always;
          font-family: 'Cambria', serif;
          font-size: 11pt;
          line-height: 1.25;
          color: #000000;
        }
        .page-doc-1 { font-size: 11pt; }
        .page-doc-2 { font-size: 14pt; }
        .page-doc-3 { font-size: 14pt; }
        .page-doc-4 { font-size: 11pt; }
        .page-doc-5 { font-size: 12pt; }
        .page-doc-6 { font-size: 14pt; }
        .page-doc-7 { font-size: 11pt; }
        .page-doc-8 { font-size: 12pt; }
        .page-doc-9 { font-size: 12pt; }
        .page-doc-10 { font-size: 12pt; }
        .page-doc-11 { font-size: 12pt; }
        .page-doc-12 { font-size: 12pt; }
        .page-doc-13 { font-size: 12pt; }
        .page-doc-14 { font-size: 11pt; }
        .page-doc-15 { font-size: 12pt; }

        .page-doc-1 .document-title { font-size: 12pt; }
        .page-doc-2 .document-title { font-size: 16pt; }
        .page-doc-3 .document-title { font-size: 16pt; }
        .page-doc-4 .document-title { font-size: 11pt; }
        .page-doc-6 .document-title { font-size: 16pt; }
        .page-doc-8 .document-title { font-size: 12pt; }
        .page-doc-9 .document-title { font-size: 14pt; }
        .page-doc-11 .document-title { font-size: 12pt; }
        .page-doc-12 .document-title { font-size: 14pt; }
        .page-doc-13 .document-title { font-size: 14pt; }
        .page-doc-14 .document-title { font-size: 14pt; }

        .page-doc-2 .address-block { font-size: 12pt; }
        .page-doc-3 .address-block { font-size: 14pt; }
        .page-doc-6 .address-block { font-size: 14pt; }

        p {
          margin-top: 0;
          margin-bottom: 8px;
        }
        /* Style for letterhead */
        .letterhead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          min-height: 75px;
          font-family: 'Calibri', sans-serif;
          color: #000000;
        }
        .logo-container {
          width: 90px;
        }
        .logo-img {
          width: 90px;
          max-height: 75px;
        }
        .partner-container {
          width: 105px;
        }
        .partner-img {
          width: 105px;
          max-height: 75px;
        }
        .header-text {
          flex: 1;
          margin-left: 15px;
          margin-right: 15px;
          text-align: left;
        }
        .company-title {
          font-family: 'Calibri-Bold', 'Calibri', sans-serif;
          font-size: 22pt;
          font-weight: bold;
          margin: 0;
          line-height: 1.1;
          color: #4472c4;
        }
        .company-addr {
          font-size: 10pt;
          margin: 2px 0 0 0;
          line-height: 1.1;
          color: #000000;
        }
        .company-info {
          font-size: 10pt;
          margin: 2px 0 0 0;
          line-height: 1.1;
          color: #000000;
        }
        .header-divider {
          border: none;
          border-top: 0.75pt solid #4472c4;
          margin: 6px 0 10px 0;
        }
        .date-row {
          text-align: right;
          font-size: 11pt;
          margin-bottom: 10px;
        }
        .document-title {
          text-align: center;
          text-decoration: underline;
          font-size: 12pt;
          font-weight: bold;
          margin-top: 10px;
          margin-bottom: 15px;
          text-transform: uppercase;
        }
        .address-block {
          text-align: left;
          font-size: 11pt;
          margin-bottom: 15px;
          line-height: 1.35;
        }
        .subject-ref-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
        }
        .subject-ref-table td {
          padding: 2px 0;
          vertical-align: top;
          border: none;
        }
        .justify {
          text-align: justify;
        }
        .font-bold {
          font-weight: bold;
        }
        /* Tables */
        .bidder-particulars-table {
          width: 100%;
          border-collapse: collapse;
          margin: 15px 0;
        }
        .bidder-particulars-table td {
          border: none;
          padding: 5px 0;
          vertical-align: top;
          font-family: 'Cambria', serif;
          font-size: 14pt;
        }
        .bidder-particulars-table th {
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 14pt;
          font-weight: bold;
        }
        .bordered-table {
          width: 100%;
          border-collapse: collapse;
          margin: 15px 0;
        }
        .bordered-table th, .bordered-table td {
          border: 0.5pt solid #4472c4;
          padding: 6px 8px;
          text-align: left;
          vertical-align: top;
        }
        .bordered-table th {
          background-color: #c6d9f1;
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 10pt;
          font-weight: bold;
        }
        .bordered-table td {
          font-family: 'Cambria', serif;
          font-size: 10pt;
        }
        .service-table td {
          font-family: 'Cambria', serif;
          font-size: 10pt;
          line-height: 1.25;
        }
        .service-table th {
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 10pt;
          font-weight: bold;
        }
        .escalation-table td {
          font-family: 'Cambria', serif;
          font-size: 12pt;
          line-height: 1.25;
        }
        .escalation-table th {
          font-family: 'Cambria-Bold', 'Cambria', serif;
          font-size: 12pt;
          font-weight: bold;
        }
        tr {
          page-break-inside: avoid;
        }"""
            content = content[:css_start_idx] + new_css + content[css_end_idx:]
            print("CSS block updated successfully.")
        else:
            print("Warning: CSS styles block not found in test script.")

    # Split the file by 'pages.push(wrapPage(' and reconstruct it.
    parts = content.split('pages.push(wrapPage(')
    if len(parts) != 16:
        print(f"Error: expected 15 pages.push(wrapPage( statements, but found {len(parts) - 1} in {file_path}")
        return False

    new_content = parts[0]
    for i in range(1, 16):
        part = parts[i]
        page_class = page_classes[i - 1]
        
        # Match template closing string:
        title_match = re.search(r'`\s*,\s*\'([^\']+)\'\s*\)\s*\)\s*;', part)
        if title_match:
            title = title_match.group(1)
            old_str = f"`, '{title}'));"
            new_str = f"`, '{title}', '{page_class}'));"
            if old_str in part:
                part = part.replace(old_str, new_str, 1)
            else:
                part = re.sub(r'`\s*,\s*\'([^\']+)\'\s*\)\s*\)\s*;', f"`, '\\1', '{page_class}'));", part, 1)
        else:
            old_str = "`));"
            new_str = f"`, undefined, '{page_class}'));"
            if old_str in part:
                part = part.replace(old_str, new_str, 1)
            else:
                part = re.sub(r'`\s*\)\s*\)\s*;', f"`, undefined, '{page_class}'));", part, 1)
                
        new_content += 'pages.push(wrapPage(' + part

    # Update Escalation Matrix table class name in Document 15
    old_table = '<table class="bordered-table service-table">'
    new_table = '<table class="bordered-table escalation-table">'
    table_index = new_content.rfind(old_table)
    if table_index != -1:
        new_content = new_content[:table_index] + new_table + new_content[table_index + len(old_table):]
        print("Updated Escalation Matrix table class successfully.")
    else:
        print("Warning: Escalation table tag not found.")

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print(f"Successfully updated {file_path}\n")
    return True

if __name__ == "__main__":
    # We only run update_file on test-pdf-generation.js here, as src/lib/documentTemplates.ts was already updated.
    # But just in case, we can run on test-pdf-generation.js with update_css=True.
    update_file("scripts/test-pdf-generation.js", update_css=True)
