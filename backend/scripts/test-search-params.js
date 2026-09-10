const axios = require('axios');

async function testParams(rawKey) {
  const key = rawKey.replace(/ /g, '+');
  console.log(`\n============================`);
  console.log(`Testing key: "${key}"`);
  
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

    if (!loginRes.data?.Success) {
      console.log("Login failed:", loginRes.data);
      return;
    }

    const loginData = loginRes.data?.Data?.[0];
    const token = loginData?.token;
    const userId = loginData?.user_id;
    const mailDate = loginData?.mail_date;
    const qId = loginData?.user_query_id;

    console.log(`User ID: ${userId}, Mail Date: ${mailDate}, Query ID: ${qId}`);
    headers['Authorization'] = `Bearer ${token}`;

    // Test different tab_status values: 1, 2, 3
    for (const tabStatus of [1, 2, 3]) {
      // Test different tab_ids: 1, 2
      for (const tabId of [1, 2]) {
        const countRes = await axios.post(
          "https://t247_api.tender247.com/apigateway/T247Tender/mail/api/tender/auth/tender-search-count",
          {
            tab_id: tabId,
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
            user_email_service_query_id: qId,
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
            tab_status: tabStatus,
            is_ai_summary: false,
            boq: 0,
            is_grace: false,
            surety_bond: false,
            limited_tender: false
          },
          { headers }
        );

        const count = countRes.data?.Data?.[0]?.tendercount;
        console.log(`tab_id: ${tabId}, tab_status: ${tabStatus}, mail_date: "${mailDate}" => count: ${count}`);

        // Try without mail_date
        const countNoDate = await axios.post(
          "https://t247_api.tender247.com/apigateway/T247Tender/mail/api/tender/auth/tender-search-count",
          {
            tab_id: tabId,
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
            user_email_service_query_id: qId,
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
            mail_date: "",
            tab_status: tabStatus,
            is_ai_summary: false,
            boq: 0,
            is_grace: false,
            surety_bond: false,
            limited_tender: false
          },
          { headers }
        );
        const countND = countNoDate.data?.Data?.[0]?.tendercount;
        console.log(`tab_id: ${tabId}, tab_status: ${tabStatus}, mail_date: "" => count: ${countND}`);
      }
    }
  } catch (err) {
    console.error("Error testing params:", err.message);
  }
}

async function run() {
  await testParams("l0bojs+ejxR2Sk+cm3rflm548i636KTdgHayDOKSty8=");
  await testParams("l0bojs+ejxR2Sk+cm3rflqRxMjsQgnnuhZqqJXBR9DU=");
}

run();
