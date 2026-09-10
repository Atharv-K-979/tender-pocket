import pypdf

reader = pypdf.PdfReader('template.pdf')
print("Total pages:", len(reader.pages))

for idx in range(len(reader.pages)):
    page = reader.pages[idx]
    print(f"\nPage {idx+1}:")
    try:
        resources = page['/Resources']
        if '/XObject' in resources:
            xobjects = resources['/XObject']
            for name in xobjects:
                xobj = xobjects[name]
                print(f"  Name: {name}, Subtype: {xobj.get('/Subtype')}, Width: {xobj.get('/Width')}, Height: {xobj.get('/Height')}")
        else:
            print("  No XObjects found.")
    except Exception as e:
        print(f"  Error: {e}")
