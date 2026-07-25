import axios from 'axios';

async function testListApi() {
  const key = "W0c04dLJGvPRHOQg0U2TJowR1J7x/bXH+Y0S4tSQznA=";
  
  const headers = {
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

  console.log("Login Status:", loginRes.status);

  if (!loginRes.data?.Success || !loginRes.data.Data) {
    console.error("Login failed!");
    return;
  }

  const userId = loginRes.data.Data.user_id || 1003059;
  console.log(`\nExtracted User ID: ${userId}`);

  console.log("\n2. Fetching query ID...");
  const queryRes = await axios.post(
    "https://t247_api.tender247.com/apigateway/T247Tender/api/tender/auth/tender-user-count",
    { user_id: userId, status: 2 },
    { headers }
  );

  console.log("Query ID Status:", queryRes.status);

  const queryData = queryRes.data?.Data?.[0];
  const queryId = queryData?.user_email_service_query_id ? Number(queryData.user_email_service_query_id) : 93568;
  console.log(`\nExtracted Query ID: ${queryId}`);

  console.log("\n3. Fetching search count...");
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
      mail_date: "2026-05-22",
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

  console.log("\n4. Fetching all tenders...");
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
      record_per_page: 100, // Get all 38 tenders in one go
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
      mail_date: "2026-05-22",
      tab_status: 2,
      is_ai_summary: false,
      boq: 0,
      is_grace: false,
      surety_bond: false,
      limited_tender: false
    },
    { headers }
  );

  console.log("Search API Status:", searchRes.status);
  console.log("Search API Success:", searchRes.data?.Success);
  console.log("Total Records Returned:", searchRes.data?.Data?.length);
  if (searchRes.data?.Data && searchRes.data.Data.length > 0) {
    console.log("\nFirst 5 Tenders fetched:");
    searchRes.data.Data.slice(0, 5).forEach((t: any, idx: number) => {
      console.log(`\n#${idx + 1}:`);
      console.log(`- ID: ${t.tender_id}`);
      console.log(`- Title: ${t.requirement_workbrief}`);
      console.log(`- Org: ${t.organization_name}`);
      console.log(`- Cost: ${t.tender_estimatedcost}`);
      console.log(`- Due Date: ${t.tender_endsubmission_datetime}`);
    });
  }
}

testListApi().catch(console.error);
