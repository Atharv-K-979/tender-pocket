import axios from 'axios';

async function testSearchList() {
  const key = "W0c04dLJGvPRHOQg0U2TJowR1J7x/bXH+Y0S4tSQznA=";
  
  const headers: any = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Referer': 'https://www.tender247.com/'
  };

  console.log("1. Authenticating with key...");
  const loginRes = await axios.post(
    "https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/login/user/key",
    { key },
    { headers }
  );

  const loginData = loginRes.data?.Data?.[0];
  const token = loginData?.token;
  const userId = loginData?.user_id;
  const queryId = loginData?.user_query_id;
  const mailDate = loginData?.mail_date || "2026-05-22";

  if (!token || !userId || !queryId) {
    console.error("Authentication failed. Missing details:", { token: !!token, userId, queryId });
    return;
  }

  console.log("Success! Authenticated User:", loginData.person_name);
  console.log("User ID:", userId);
  console.log("Query ID:", queryId);
  console.log("Mail Date:", mailDate);

  // Set the Bearer token for subsequent requests
  headers['Authorization'] = `Bearer ${token}`;

  console.log("\n2. Fetching search counts...");
  const countRes = await axios.post(
    "https://t247_api.tender247.com/apigateway/T247Tender/mail/api/tender/auth/tender-search-count",
    {
      tab_id: 1,
      tender_id: 0,
      tender_number: "",
      search_text: "",
      refine_search_text: "",
      tender_value_operator: 0,
      tender_value_from: 0,
      tender_value_to: 0,
      publication_date_from: "",
      publication_date_to: "",
      closing_date_from: "",
      closing_date_to: "",
      search_by_location: false,
      statezone_ids: "",
      city_ids: "",
      state_ids: "",
      organization_ids: "",
      organization_name: "",
      sort_by: 1,
      sort_type: 2,
      page_no: 1,
      record_per_page: 20,
      keyword_id: "",
      mfa: "",
      nameof_website: "",
      tender_typeid: 0,
      is_tender_doc_uploaded: false,
      user_id: userId,
      user_email_service_query_id: queryId,
      exact_search: false,
      exact_search_text: false,
      search_by_split_word: false,
      product_id: "",
      organization_type_id: "",
      sub_industry_id: "",
      search_by: 0,
      guest_user_id: 0,
      quantity: "",
      quantity_operator: 0,
      msme_exemption: 0,
      startup_exemption: 0,
      gem: 0,
      mail_date: mailDate,
      tab_status: 2,
      is_ai_summary: false,
      boq: 0,
      is_grace: false,
      surety_bond: false,
      limited_tender: false
    },
    { headers }
  );

  console.log("Count Response Data:", JSON.stringify(countRes.data, null, 2));
  const totalTendersCount = countRes.data?.Data?.[0]?.tendercount || 0;
  console.log(`\nTotal Tenders matching query: ${totalTendersCount}`);

  console.log("\n3. Querying search results...");
  const searchRes = await axios.post(
    "https://t247_api.tender247.com/apigateway/T247Tender/mail/api/tender/auth/search-tender",
    {
      tab_id: 1,
      tender_id: 0,
      tender_number: "",
      search_text: "",
      refine_search_text: "",
      tender_value_operator: 0,
      tender_value_from: 0,
      tender_value_to: 0,
      publication_date_from: "",
      publication_date_to: "",
      closing_date_from: "",
      closing_date_to: "",
      search_by_location: false,
      statezone_ids: "",
      city_ids: "",
      state_ids: "",
      organization_ids: "",
      organization_name: "",
      sort_by: 1,
      sort_type: 2,
      page_no: 1,
      record_per_page: Math.max(totalTendersCount, 50), // Request all of them!
      keyword_id: "",
      mfa: "",
      nameof_website: "",
      tender_typeid: 0,
      is_tender_doc_uploaded: false,
      user_id: userId,
      user_email_service_query_id: queryId,
      exact_search: false,
      exact_search_text: false,
      search_by_split_word: false,
      product_id: "",
      organization_type_id: "",
      sub_industry_id: "",
      search_by: 0,
      guest_user_id: 0,
      quantity: "",
      quantity_operator: 0,
      msme_exemption: 0,
      startup_exemption: 0,
      gem: 0,
      mail_date: mailDate,
      tab_status: 2,
      is_ai_summary: false,
      boq: 0,
      is_grace: false,
      surety_bond: false,
      limited_tender: false
    },
    { headers }
  );

  console.log("Search Result Status:", searchRes.status);
  console.log("Search Success Status:", searchRes.data?.Success);
  console.log("Tenders Received:", searchRes.data?.Data?.length);

  if (searchRes.data?.Data && searchRes.data.Data.length > 0) {
    console.log("\nFull Tender Payload Structure:");
    console.log(JSON.stringify(searchRes.data.Data[0], null, 2));
  }
}

testSearchList().catch(console.error);
