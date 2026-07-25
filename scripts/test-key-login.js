const axios = require('axios');

async function testKey(rawKey) {
  const key = rawKey.replace(/ /g, '+');
  console.log(`\nTesting key: "${key}"`);
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Referer': 'https://www.tender247.com/'
  };

  try {
    const loginRes = await axios.post(
      "https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/login/user/key",
      { key },
      { headers }
    );

    console.log("Login Success:", loginRes.data?.Success);
    if (!loginRes.data?.Success) {
      console.log("Login Message:", loginRes.data?.Message);
      console.log("Login Full Data:", JSON.stringify(loginRes.data, null, 2));
      return;
    }

    const loginData = loginRes.data?.Data?.[0];
    const token = loginData?.token;
    const userId = loginData?.user_id;
    const queryId = loginData?.user_query_id;
    const mailDate = loginData?.mail_date;

    console.log(`Auth details: User ID: ${userId}, Query ID: ${queryId}, Mail Date: ${mailDate}`);
    
    headers['Authorization'] = `Bearer ${token}`;

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

    const count = countRes.data?.Data?.[0]?.tendercount || 0;
    console.log(`Tender Count: ${count}`);

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
        record_per_page: count || 100,
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

    console.log(`Tenders Returned: ${searchRes.data?.Data?.length}`);
  } catch (err) {
    console.error("Error testing key:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

async function run() {
  await testKey("l0bojs ejxR2Sk cm3rflm548i636KTdgHayDOKSty8=");
  await testKey("l0bojs ejxR2Sk cm3rflqRxMjsQgnnuhZqqJXBR9DU=");
}

run();
