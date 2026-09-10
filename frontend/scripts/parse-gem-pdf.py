import pypdf
import sys
import json
import re

STATES = [
    "Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana",
    "Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur",
    "Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu",
    "Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Jammu","Kashmir",
    "Ladakh","Puducherry","Chandigarh"
]

# Mapping of known districts/cities to their states for GeM validation
CITY_TO_STATE = {
    "sonitpur": "Assam",
    "tezpur": "Assam",
    "nakyo gg": "Arunachal Pradesh",
    "itanagar": "Arunachal Pradesh",
    "tawang": "Arunachal Pradesh",
    "mumbai": "Maharashtra",
    "pune": "Maharashtra",
    "nagpur": "Maharashtra",
    "thane": "Maharashtra",
    "nashik": "Maharashtra",
    "dhule": "Maharashtra",
    "bengaluru": "Karnataka",
    "bangalore": "Karnataka",
    "mysore": "Karnataka",
    "chennai": "Tamil Nadu",
    "coimbatore": "Tamil Nadu",
    "madurai": "Tamil Nadu",
    "hyderabad": "Telangana",
    "secunderabad": "Telangana",
    "ahmedabad": "Gujarat",
    "surat": "Gujarat",
    "vadodara": "Gujarat",
    "rajkot": "Gujarat",
    "jaipur": "Rajasthan",
    "jodhpur": "Rajasthan",
    "udaipur": "Rajasthan",
    "kota": "Rajasthan",
    "ajmer": "Rajasthan",
    "bikaner": "Rajasthan",
    "lucknow": "Uttar Pradesh",
    "kanpur": "Uttar Pradesh",
    "noida": "Uttar Pradesh",
    "greater noida": "Uttar Pradesh",
    "ghaziabad": "Uttar Pradesh",
    "agra": "Uttar Pradesh",
    "varanasi": "Uttar Pradesh",
    "allahabad": "Uttar Pradesh",
    "prayagraj": "Uttar Pradesh",
    "meerut": "Uttar Pradesh",
    "patna": "Bihar",
    "gaya": "Bihar",
    "ranchi": "Jharkhand",
    "jamshedpur": "Jharkhand",
    "bhubaneswar": "Odisha",
    "cuttack": "Odisha",
    "kolkata": "West Bengal",
    "calcutta": "West Bengal",
    "howrah": "West Bengal",
    "guwahati": "Assam",
    "dispur": "Assam",
    "shillong": "Meghalaya",
    "kohima": "Nagaland",
    "imphal": "Manipur",
    "aizawl": "Mizoram",
    "agartala": "Tripura",
    "gangtok": "Sikkim",
    "dehradun": "Uttarakhand",
    "nainital": "Uttarakhand",
    "shimla": "Himachal Pradesh",
    "dharamshala": "Himachal Pradesh",
    "chandigarh": "Punjab",
    "amritsar": "Punjab",
    "ludhiana": "Punjab",
    "jalandhar": "Punjab",
    "jammu": "Jammu & Kashmir",
    "srinagar": "Jammu & Kashmir",
    "leh": "Ladakh",
    "bhopal": "Madhya Pradesh",
    "indore": "Madhya Pradesh",
    "gwalior": "Madhya Pradesh",
    "jabalpur": "Madhya Pradesh",
    "raipur": "Chhattisgarh",
    "bilaspur": "Chhattisgarh",
    "panaji": "Goa",
    "vasco da gama": "Goa",
    "thiruvananthapuram": "Kerala",
    "trivandrum": "Kerala",
    "kochi": "Kerala",
    "cochin": "Kerala",
    "kozhikode": "Kerala",
    "calicut": "Kerala"
}

def parse_pdf(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    
    # 1. Extract links (annotations)
    links = []
    for page in reader.pages:
        if "/Annots" in page:
            annots = page["/Annots"]
            for annot in annots:
                obj = annot.get_object()
                if obj.get("/Subtype") == "/Link":
                    action = obj.get("/A")
                    if action and action.get("/URI"):
                        uri = action["/URI"]
                        if uri not in links:
                            links.append(uri)
                            
    # 2. Extract full text and normalize whitespaces
    full_text_pages = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            full_text_pages.append(text)
    full_text_raw = "\n".join(full_text_pages)
    
    # Normalize whitespaces (replaces tabs, newlines, multiple spaces with a single space)
    clean_text = " ".join(full_text_raw.split())

    # 3. Parse Dates and Times
    due_date = None
    due_time = None
    bid_end_match = re.search(
        r'(?:Bid\s+End\s+Date/Time|बंद\s+होने\s+क\s+तार\s*ख/समय)\s*[:\/\s-]*\s*(\d{2}-\d{2}-\d{4})\s*(\d{2}:\d{2}:\d{2})', 
        clean_text, 
        re.IGNORECASE
    )
    if bid_end_match:
        due_date = bid_end_match.group(1)
        due_time = bid_end_match.group(2)
        parts = due_date.split('-')
        if len(parts) == 3:
            due_date = f"{parts[2]}-{parts[1]}-{parts[0]}"

    # Opening Date/Time
    opening_date = None
    opening_time = None
    opening_match = re.search(
        r'(?:Bid\s+Opening\s+Date/Time|खुलने\s+क\s+तार\s*ख/समय)\s*[:\/\s-]*\s*(\d{2}-\d{2}-\d{4})\s*(\d{2}:\d{2}:\d{2})', 
        clean_text, 
        re.IGNORECASE
    )
    if opening_match:
        opening_date = opening_match.group(1)
        opening_time = opening_match.group(2)
        parts = opening_date.split('-')
        if len(parts) == 3:
            opening_date = f"{parts[2]}-{parts[1]}-{parts[0]}"

    # Bid Validity
    validity = None
    # Matches patterns like: Bid Offer Validity (From End Date) 180 (Days) OR बड पेशकश वैधता (बंद होने क तार ख से) 180
    validity_match = re.search(
        r'(?:Bid\s+Offer\s+Validity|बड\s+पेशकश\s+वैधता)[^\d]*?(\d+)\s*(?:\(Days\)|days)?', 
        clean_text, 
        re.IGNORECASE
    )
    if validity_match:
        validity = int(validity_match.group(1))

    # Bid Number
    bid_number = None
    bid_num_match = re.search(
        r'(?:Bid\s+Number|बड\s+सं<या)\s*[:\/\s-]*\s*(GEM/\d{4}/[A-Z]/\d+)', 
        clean_text, 
        re.IGNORECASE
    )
    if bid_num_match:
        bid_number = bid_num_match.group(1)

    # 4. Extract Locations (Place and State)
    detected_state = "N/A"
    detected_place = "N/A"

    # Scan for known cities first
    found_city = None
    for city_name in CITY_TO_STATE.keys():
        # Match city name as word boundary (e.g. \bSonitpur\b or \bNakyo GG\b)
        pattern = r'\b' + re.escape(city_name) + r'\b'
        if re.search(pattern, clean_text, re.IGNORECASE):
            found_city = city_name
            detected_place = city_name.title()
            detected_state = CITY_TO_STATE[city_name]
            break

    # If no city matched, scan for state names and extract context
    if detected_state == "N/A":
        for state in STATES:
            if re.search(r'\b' + re.escape(state) + r'\b', clean_text, re.IGNORECASE):
                detected_state = state
                # Look for city preceding the state (e.g., "Nakyo GG, Arunachal Pradesh" or "City Name, State")
                context_matches = re.findall(r'([A-Za-z0-9\s.-]+),\s*' + re.escape(state), clean_text, re.IGNORECASE)
                if context_matches:
                    cleaned_place = context_matches[0].strip()
                    # Clean prefix/suffix
                    cleaned_place = re.sub(r'^(?:Asset|Qty|Delivery|Loc|Address|S\.No|Job\s*No)\b', '', cleaned_place, flags=re.IGNORECASE).strip()
                    cleaned_place = cleaned_place.split()[-2:] # take last 2 words of candidate
                    cleaned_place = " ".join(cleaned_place).strip()
                    if len(cleaned_place) > 2 and len(cleaned_place) < 30:
                        detected_place = cleaned_place.title()
                break

    # Fallback to consignee pattern matching *******PlaceName
    if detected_place == "N/A":
        consignee_addr_match = re.findall(r'\*{5,}([A-Za-z0-9\s]+)', clean_text)
        if consignee_addr_match:
            candidates = [c.strip() for c in consignee_addr_match if c.strip()]
            for cand in candidates:
                cand_clean = cand.split()[0] # take first word
                if len(cand_clean) > 2 and not cand_clean.lower().startswith('qty') and not cand_clean.lower().startswith('quant'):
                    detected_place = cand_clean.title()
                    # Check if place matches any state in our mapping
                    for city_name, state_name in CITY_TO_STATE.items():
                        if city_name in cand_clean.lower():
                            detected_state = state_name
                            break
                    break

    # 5. Extract EMD & ePBG details
    emd_amount = None
    emd_bank = None
    epbg_percent = None
    epbg_bank = None

    # Slice clean_text into blocks to prevent cross-table matching and paragraph matches
    emd_block = ""
    emd_start_match = re.search(r'(?:EMD\s+Detail|ईएमड\s+ववरण)', clean_text, re.IGNORECASE)
    if emd_start_match:
        start_idx = emd_start_match.start()
        end_match = re.search(r'(?:ePBG\s+Detail|ईपीबीजी\s+ववरण|Splitting|बोली\s+वभाजन|Purchase\s+Preference|खरद\s+वरयता)', clean_text[start_idx:], re.IGNORECASE)
        if end_match:
            emd_block = clean_text[start_idx : start_idx + end_match.start()]
        else:
            emd_block = clean_text[start_idx : start_idx + 1000]

    epbg_block = ""
    epbg_start_match = re.search(r'(?:ePBG\s+Detail|ईपीबीजी\s+ववरण)', clean_text, re.IGNORECASE)
    if epbg_start_match:
        start_idx = epbg_start_match.start()
        end_match = re.search(r'(?:Splitting|बोली\s+वभाजन|Purchase\s+Preference|खरद\s+वरयता|MII|एमएसई)', clean_text[start_idx:], re.IGNORECASE)
        if end_match:
            epbg_block = clean_text[start_idx : start_idx + end_match.start()]
        else:
            epbg_block = clean_text[start_idx : start_idx + 1000]

    # Check EMD Required status
    emd_required = True
    if emd_block:
        emd_req_match = re.search(
            r'(?:Required|आवOयकता)\s*[:\/\s-]*\s*(Yes|No|हां|नहं)', 
            emd_block, 
            re.IGNORECASE
        )
        if emd_req_match:
            val = emd_req_match.group(1).lower()
            if 'no' in val or 'नहं' in val:
                emd_required = False

    # Extract EMD details if required
    if emd_required and emd_block:
        # Matches EMD Amount
        emd_amount_match = re.search(
            r'(?:EMD\s+Amount|ईएमड\s+रािश)[^\d]*?(\d+)', 
            emd_block, 
            re.IGNORECASE
        )
        if emd_amount_match:
            emd_amount = int(emd_amount_match.group(1))

        # Matches EMD Advisory Bank
        emd_bank_match = re.search(
            r'(?:Advisory\s+Bank|एडवाइजर\s+बKक)\s*(.*?)\s*(?:EMD\s+Amount|ईएमड|ईएमड\s+रािश)', 
            emd_block, 
            re.IGNORECASE
        )
        if emd_bank_match:
            raw_bank = emd_bank_match.group(1).replace('/', '').strip()
            raw_bank = re.sub(r'[^\x00-\x7F]+', ' ', raw_bank) # remove non-ASCII
            raw_bank = re.sub(r'[^a-zA-Z0-9\s.,()&-]', '', raw_bank)
            raw_bank = re.sub(r'\s+\d+\s*$', '', raw_bank).strip() # remove trailing garbage numbers
            emd_bank = " ".join(raw_bank.split()).strip()

    # Extract ePBG details from epbg_block
    if epbg_block:
        # Matches ePBG Percentage(%)
        epbg_percent_match = re.search(
            r'(?:ePBG\s+Percentage|ईपीबीजी\s+ितशत)[^\d]*?(\d+(?:\.\d+)?)', 
            epbg_block, 
            re.IGNORECASE
        )
        if epbg_percent_match:
            epbg_percent = float(epbg_percent_match.group(1))

        # Matches ePBG Advisory Bank
        epbg_bank_match = re.search(
            r'(?:Advisory\s+Bank|एडवाइजर\s+बKक)\s*(.*?)\s*(?:ePBG\s+Percentage|ईपीबीजी|ईपीबीजी\s+ितशत)', 
            epbg_block, 
            re.IGNORECASE
        )
        if epbg_bank_match:
            raw_bank = epbg_bank_match.group(1).replace('/', '').strip()
            raw_bank = re.sub(r'[^\x00-\x7F]+', ' ', raw_bank) # remove non-ASCII
            raw_bank = re.sub(r'[^a-zA-Z0-9\s.,()&-]', '', raw_bank)
            raw_bank = re.sub(r'\s+\d+\s*$', '', raw_bank).strip() # remove trailing garbage numbers
            epbg_bank = " ".join(raw_bank.split()).strip()

    result = {
        "links": links,
        "due_date": due_date,
        "due_time": due_time,
        "opening_date": opening_date,
        "opening_time": opening_time,
        "validity": validity,
        "place": detected_place,
        "state": detected_state,
        "emd_amount": emd_amount,
        "emd_bank": emd_bank,
        "epbg_percent": epbg_percent,
        "epbg_bank": epbg_bank,
        "bid_number": bid_number
    }

    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)
        
    try:
        data = parse_pdf(sys.argv[1])
        print(json.dumps(data, indent=2))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
