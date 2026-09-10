const axios = require('axios');
const cheerio = require('cheerio');

async function fetchGeMBids() {
  console.log("1. Fetching GeM all-bids page to get CSRF token and cookies...");
  
  const mainUrl = "https://bidplus.gem.gov.in/all-bids";
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  try {
    const res = await axios.get(mainUrl, { headers, timeout: 8000 });
    
    // Get cookies
    const cookies = res.headers['set-cookie'] || [];
    console.log("Cookies received:", cookies.length);
    const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ');
    
    // Parse CSRF token
    const html = res.data;
    const $ = cheerio.load(html);
    
    // Find CSRF hash in scripts or page source
    // In our previous grep, we saw: data: {'payload': ..., 'csrf_bd_gem_nk': '47998446722265b890ce9709d67a113e'}
    // Let's use regex to find the hash value for 'csrf_bd_gem_nk'
    const csrfRegex = /'csrf_bd_gem_nk'\s*:\s*'([a-f0-9]+)'/i;
    const match = html.match(csrfRegex);
    let csrfHash = '';
    if (match) {
      csrfHash = match[1];
      console.log("Found CSRF Hash via regex:", csrfHash);
    } else {
      console.log("Failed to parse CSRF Hash from script variables, searching in inputs...");
      // Try to find a hidden input or similar
      const inputVal = $('input[name="csrf_bd_gem_nk"]').val() || $('#csrf_bd_gem_nk').val();
      if (inputVal) {
        csrfHash = inputVal;
        console.log("Found CSRF Hash in input element:", csrfHash);
      }
    }

    if (!csrfHash) {
      // Let's try to look for any 32-character hex strings in script content
      const anyHashMatch = html.match(/'csrf_bd_gem_nk'\s*,\s*'([a-f0-9]+)'/i) || html.match(/csrf_bd_gem_nk=([a-f0-9]+)/i);
      if (anyHashMatch) {
        csrfHash = anyHashMatch[1];
        console.log("Found CSRF Hash via fallback regex:", csrfHash);
      }
    }

    if (!csrfHash) {
      console.error("Could not extract CSRF token.");
      return;
    }

    console.log("\n2. Querying all-bids-data API endpoint...");
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

    const postHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Referer': 'https://bidplus.gem.gov.in/all-bids',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieHeader
    };

    // Construct form urlencoded body
    const params = new URLSearchParams();
    params.append('payload', JSON.stringify(postData));
    params.append('csrf_bd_gem_nk', csrfHash);

    const apiRes = await axios.post(
      "https://bidplus.gem.gov.in/all-bids-data",
      params.toString(),
      { headers: postHeaders, timeout: 8000 }
    );

    console.log("API Response Status:", apiRes.status);
    console.log("API Response Code:", apiRes.data?.code);
    console.log("API Success Response:", JSON.stringify(apiRes.data?.response?.response?.numFound));
    
    if (apiRes.data?.response?.response?.docs) {
      console.log(`\nSuccessfully fetched ${apiRes.data.response.response.docs.length} GeM bids!`);
      console.log("\nFirst 3 Bids:");
      apiRes.data.response.response.docs.slice(0, 3).forEach((doc, idx) => {
        console.log(`\n#${idx + 1}:`);
        console.log(`- Bid Number: ${doc.b_bid_number}`);
        console.log(`- Items: ${doc.b_category_name?.join(', ')}`);
        console.log(`- Quantity: ${doc.b_total_quantity}`);
        console.log(`- End Date: ${doc.final_end_date_sort}`);
        console.log(`- Dept: ${doc.ba_official_details_deptName}`);
      });
    } else {
      console.log("No bids docs returned:", apiRes.data);
    }

  } catch (err) {
    console.error("Error fetching GeM bids:", err.message);
    if (err.response) {
      console.error("Response status:", err.response.status);
      console.error("Response data:", err.response.data);
    }
  }
}

fetchGeMBids().catch(console.error);
