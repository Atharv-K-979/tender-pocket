package com.tenderpocket.services;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.utils.TenderClassifier;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class EmailSyncServiceTest {

    @Mock
    private TenderRepository tenderRepository;

    @Mock
    private RestTemplate restTemplate;

    @InjectMocks
    private EmailSyncService emailSyncService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(emailSyncService, "restTemplate", restTemplate);
        ReflectionTestUtils.setField(emailSyncService, "tenderRepository", tenderRepository);
    }

    @Test
    @DisplayName("Tender247 API response with GeM tender_number is extracted and classified as GeM")
    void testT247ApiIngestionWithGemTenderNumber() throws Exception {
        String key = "test-auth-key";

        // Mock Login Response
        ObjectNode loginData = objectMapper.createObjectNode();
        loginData.put("token", "jwt-token-123");
        loginData.put("user_id", "1003059");
        loginData.put("user_query_id", "qry-999");
        loginData.put("mail_date", "2026-05-22");
        ArrayNode loginArray = objectMapper.createArrayNode();
        loginArray.add(loginData);
        ObjectNode loginRoot = objectMapper.createObjectNode();
        loginRoot.set("Data", loginArray);

        when(restTemplate.postForEntity(contains("/api/auth/login/user/key"), any(), eq(com.fasterxml.jackson.databind.JsonNode.class)))
                .thenReturn(new ResponseEntity<>(loginRoot, HttpStatus.OK));

        // Mock Search Response containing GeM tender_number
        ObjectNode tenderDoc = objectMapper.createObjectNode();
        tenderDoc.put("tender_id", 100575724);
        tenderDoc.put("security_code", "sec-123");
        tenderDoc.put("requirement_workbrief", "operation and maintenance of hvac system");
        tenderDoc.put("organization_name", "All India Institute Of Medical Sciences");
        tenderDoc.put("site_location", "Raipur");
        tenderDoc.put("submission_enddate", "12-06-2026");
        tenderDoc.put("tender_number", "GEM/2026/B/7570015");
        tenderDoc.put("nameof_website", "https://bidplus.gem.gov.in");
        tenderDoc.put("tender_estimatedcost", 14402554);

        ArrayNode searchArray = objectMapper.createArrayNode();
        searchArray.add(tenderDoc);
        ObjectNode searchRoot = objectMapper.createObjectNode();
        searchRoot.set("Data", searchArray);

        when(restTemplate.postForEntity(contains("/api/tender/auth/search-tender"), any(), eq(com.fasterxml.jackson.databind.JsonNode.class)))
                .thenReturn(new ResponseEntity<>(searchRoot, HttpStatus.OK));

        // Execute fetchTendersFromT247Api via reflection
        Method fetchMethod = EmailSyncService.class.getDeclaredMethod("fetchTendersFromT247Api", String.class);
        fetchMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        List<Map<String, String>> result = (List<Map<String, String>>) fetchMethod.invoke(emailSyncService, key);

        assertEquals(1, result.size());
        Map<String, String> item = result.get(0);
        assertEquals("100575724", item.get("id"));
        assertEquals("GEM/2026/B/7570015", item.get("ref_no"));
        assertEquals("https://bidplus.gem.gov.in", item.get("nameof_website"));
    }

    @Test
    @DisplayName("HTML table parser extracts GeM bid number from title or ID cell")
    void testHtmlTableParserExtractsGemBid() throws Exception {
        String html = "<html><body><table>" +
                "<tr><td>TENDER DETAILS</td><td>ORGANIZATION & LOCATION</td><td>VALUE & DEADLINE</td></tr>" +
                "<tr>" +
                "<td>T247 ID : 100575724<br><a href='https://r.tenders.bidsnrfp.com/tr/cl/xyz'>Supply of Deep Freezer (GEM/2026/B/7439555)</a></td>" +
                "<td><b>AIIMS</b><br>Raipur</td>" +
                "<td>1.44 Cr<br>12-06-2026</td>" +
                "</tr>" +
                "</table></body></html>";

        Method parseMethod = EmailSyncService.class.getDeclaredMethod("extractTendersFromEmailHtml", String.class);
        parseMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        List<Map<String, String>> tenders = (List<Map<String, String>>) parseMethod.invoke(emailSyncService, html);

        assertEquals(1, tenders.size());
        Map<String, String> t = tenders.get(0);
        assertEquals("100575724", t.get("id"));
        assertEquals("GEM/2026/B/7439555", t.get("ref_no"));
        assertEquals("12-06-2026", t.get("due_date"));
        assertEquals("1.44 Cr", t.get("estimated_cost_raw"));
    }

    @Test
    @DisplayName("Detail API timeout does not throw exception and falls back safely")
    void testDetailApiTimeoutSafeFallback() throws Exception {
        when(restTemplate.postForEntity(contains("/tender-detail/"), any(), eq(com.fasterxml.jackson.databind.JsonNode.class)))
                .thenThrow(new ResourceAccessException("Connection timed out"));

        Method detailMethod = EmailSyncService.class.getDeclaredMethod("fetchTenderDetailSafe", String.class, String.class, String.class);
        detailMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        Map<String, String> result = (Map<String, String>) detailMethod.invoke(emailSyncService, "99999", "sec", "tok");

        assertNotNull(result);
        assertTrue(result.isEmpty());
    }

    @Test
    @DisplayName("Cross-source enrichment: existing record with provisional Non GeM is upgraded to GeM")
    void testExistingRecordEnrichmentUpgradesToGem() throws Exception {
        Tender existing = new Tender();
        existing.setId("7458129");
        existing.setRefNo("GEM/2026/B/7570015");
        existing.setTenderType("Non GeM"); // Provisionally incorrect
        existing.setCurrentStage("NEW");
        existing.setStatus("Issued");
        existing.setOriginalUrl("https://r.tenders.bidsnrfp.com/tracking");

        Map<String, String> tData = new HashMap<>();
        tData.put("id", "100575724");
        tData.put("authority", "AIIMS Raipur");
        tData.put("location", "Raipur, Chhattisgarh");
        tData.put("estimated_cost_raw", "1.44 Cr");
        tData.put("nameof_website", "https://bidplus.gem.gov.in");

        Method enrichMethod = EmailSyncService.class.getDeclaredMethod("enrichExistingRecordFromTender247",
                Tender.class, Map.class, String.class, String.class, String.class);
        enrichMethod.setAccessible(true);
        enrichMethod.invoke(emailSyncService, existing, tData, "GEM/2026/B/7570015", "GeM", "https://bidplus.gem.gov.in/showbidDocument/7458129");

        // Identity and workflow state preserved
        assertEquals("7458129", existing.getId());
        assertEquals("NEW", existing.getCurrentStage());
        assertEquals("Issued", existing.getStatus());

        // Corrected to authoritative GeM
        assertEquals("GeM", existing.getTenderType());
        assertEquals("GEM/2026/B/7570015", existing.getRefNo());
        assertEquals("AIIMS Raipur", existing.getAuthority());
        assertEquals("1.44 Cr", existing.getEstimatedCostRaw());
        assertEquals("https://bidplus.gem.gov.in/showbidDocument/7458129", existing.getOriginalUrl());
    }

    @Test
    @DisplayName("Existing verified GeM tender is NEVER downgraded by weak incoming evidence")
    void testExistingGemNotDowngraded() throws Exception {
        Tender existing = new Tender();
        existing.setId("7458129");
        existing.setRefNo("GEM/2026/B/7570015");
        existing.setTenderType("GeM");
        existing.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/7458129");

        Map<String, String> tData = new HashMap<>();
        tData.put("id", "100575724");

        Method enrichMethod = EmailSyncService.class.getDeclaredMethod("enrichExistingRecordFromTender247",
                Tender.class, Map.class, String.class, String.class, String.class);
        enrichMethod.setAccessible(true);
        enrichMethod.invoke(emailSyncService, existing, tData, "", "Unverified", "https://r.tenders.bidsnrfp.com/xyz");

        // Preserves GeM
        assertEquals("GeM", existing.getTenderType());
        assertEquals("https://bidplus.gem.gov.in/showbidDocument/7458129", existing.getOriginalUrl());
    }

    @Test
    @DisplayName("Tender with insufficient evidence is classified as Unverified")
    void testInsufficientEvidenceClassifiedAsUnverified() throws Exception {
        Tender existing = new Tender();
        existing.setId("100111");
        existing.setTenderType(null);

        Map<String, String> tData = new HashMap<>();
        tData.put("id", "100111");

        Method enrichMethod = EmailSyncService.class.getDeclaredMethod("enrichExistingRecordFromTender247",
                Tender.class, Map.class, String.class, String.class, String.class);
        enrichMethod.setAccessible(true);
        enrichMethod.invoke(emailSyncService, existing, tData, "", "Unverified", "https://r.tenders.bidsnrfp.com/xyz");

        assertEquals("Unverified", existing.getTenderType());
    }

    @Test
    @DisplayName("extractT247Key strips trailing query parameters and handles URL encoding")
    void testExtractT247KeyStripsTrailingParams() {
        assertEquals("auth-token-123", EmailSyncService.extractT247Key("https://tender247.com/mail?key=auth-token-123&utm_source=email"));
        assertEquals("auth-token-123", EmailSyncService.extractT247Key("https://tender247.com/mail?key=auth-token-123"));
        assertEquals("token+with+plus", EmailSyncService.extractT247Key("https://tender247.com/mail?key=token%2Bwith%2Bplus&other=1"));
        assertNull(EmailSyncService.extractT247Key("https://tender247.com/mail?no_key_here=1"));
        assertNull(EmailSyncService.extractT247Key(null));
    }

    @Test
    @DisplayName("isLegitimateT247Match rejects coincidental numeric ID collision from GeM namespace")
    void testIsLegitimateT247MatchRejectsIdCollisionFromGeM() throws Exception {
        Tender existingGeM = new Tender();
        existingGeM.setId("7458129");
        existingGeM.setSource("GeM");
        existingGeM.setRefNo("GEM/2026/B/1111111");

        Method matchMethod = EmailSyncService.class.getDeclaredMethod("isLegitimateT247Match",
                Tender.class, String.class, String.class);
        matchMethod.setAccessible(true);

        // When Tender247 email arrives with same ID 7458129 but different refNo
        boolean isMatch = (boolean) matchMethod.invoke(emailSyncService, existingGeM, "7458129", "2024_CPPP_22222");
        assertFalse(isMatch, "Tender247 ID must never match an unrelated GeM tender merely because numeric IDs are equal");
    }

    @Test
    @DisplayName("isLegitimateT247Match accepts cross-source match when official GeM bid number matches")
    void testIsLegitimateT247MatchAcceptsMatchingRefNo() throws Exception {
        Tender existingGeM = new Tender();
        existingGeM.setId("gem-7458129");
        existingGeM.setSource("GeM");
        existingGeM.setRefNo("GEM/2026/B/7570015");

        Method matchMethod = EmailSyncService.class.getDeclaredMethod("isLegitimateT247Match",
                Tender.class, String.class, String.class);
        matchMethod.setAccessible(true);

        boolean isMatch = (boolean) matchMethod.invoke(emailSyncService, existingGeM, "100575724", "GEM/2026/B/7570015");
        assertTrue(isMatch, "Should accept cross-source match when official GeM bid number matches reliably");
    }

    @Test
    @DisplayName("Placeholder reference number (N/A) does not overwrite existing valid refNo")
    void testPlaceholderRefNoDoesNotOverwriteValidRefNo() throws Exception {
        Tender existing = new Tender();
        existing.setId("100575724");
        existing.setRefNo("GEM/2026/B/7570015");

        Map<String, String> tData = new HashMap<>();

        Method enrichMethod = EmailSyncService.class.getDeclaredMethod("enrichExistingRecordFromTender247",
                Tender.class, Map.class, String.class, String.class, String.class);
        enrichMethod.setAccessible(true);
        enrichMethod.invoke(emailSyncService, existing, tData, "N/A", "Unverified", "https://tender247.com/xyz");

        assertEquals("GEM/2026/B/7570015", existing.getRefNo(), "Placeholder N/A must not overwrite existing official refNo");
    }

    @Test
    @DisplayName("Sanitized authentic Tender247 HTML email yields exactly 5 unique tenders without subtable corruption")
    void testSanitizedAuthenticTender247EmailExtractsExactFiveTenders() throws Exception {
        String sanitizedHtml =
            "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">" +
            "  <tbody>" +
            "    <tr><td>DownloadiPhone App&amp;Android App</td></tr>" +
            "    <tr><td>Dear Member, Click here to view all (15) Fresh Tenders</td></tr>" +
            "    <tr>" +
            "      <td>" +
            "        <table cellpadding=\"0\" cellspacing=\"0\" style=\"font-family:Arial;border:1px solid #dfdfdf\">" +
            "          <thead>" +
            "            <tr style=\"background-color:#f9f9f9\">" +
            "              <td style=\"width:65%;border-right:1px solid #a69e9e;\"><p><b>TENDER DETAILS</b></p></td>" +
            "              <td style=\"width:20%;border-right:1px solid #a69e9e;\"><p><b>ORGANIZATION &amp; LOCATION</b></p></td>" +
            "              <td style=\"width:15%;\"><p><b>VALUE &amp; DEADLINE</b></p></td>" +
            "            </tr>" +
            "          </thead>" +
            "          <tbody>" +
            "            <tr>" +
            "              <td width=\"65%\">" +
            "                <table><tbody><tr><td width=\"5%\"><strong>1.</strong></td><td width=\"95%\">T247 ID : <label>105136457</label></td></tr></tbody></table>" +
            "                <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-token-1\">spl repair / replacement of refrigerator, water cooler,deep freezer</a>" +
            "              </td>" +
            "              <td width=\"20%\"><p><span style=\"color:#000;font-weight:bold;padding:0px 2px\">Military Engineer Services</span><br/><br/>Firozpur, Punjab, India</p></td>" +
            "              <td width=\"15%\"><p>47.62 Lacs<br/><br/>30-10-2026</p></td>" +
            "            </tr>" +
            "            <tr>" +
            "              <td width=\"65%\">" +
            "                <table><tbody><tr><td width=\"5%\"><strong>2.</strong></td><td width=\"95%\">T247 ID : <label>105137067</label></td></tr></tbody></table>" +
            "                <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-token-2\">operation and fully comprehensive annual maintenance contract</a>" +
            "              </td>" +
            "              <td width=\"20%\"><p><span style=\"color:#000;font-weight:bold;padding:0px 2px\">Public Works Department</span><br/><br/>Ernakulam, Kerala, India</p></td>" +
            "              <td width=\"15%\"><p>29.33 Lacs<br/><br/>17-10-2026</p></td>" +
            "            </tr>" +
            "            <tr>" +
            "              <td width=\"65%\">" +
            "                <table><tbody><tr><td width=\"5%\"><strong>3.</strong></td><td width=\"95%\">T247 ID : <label>105091625</label></td></tr></tbody></table>" +
            "                <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-token-3\">repair of 150trchillerno.1 coil of bluestar make with model</a>" +
            "              </td>" +
            "              <td width=\"20%\"><p><span style=\"color:#000;font-weight:bold;padding:0px 2px\">Public Works Department</span><br/><br/>South Goa, Goa, India</p></td>" +
            "              <td width=\"15%\"><p>24.07 Lacs<br/><br/>17-10-2026</p></td>" +
            "            </tr>" +
            "            <tr>" +
            "              <td width=\"65%\">" +
            "                <table><tbody><tr><td width=\"5%\"><strong>4.</strong></td><td width=\"95%\">T247 ID : <label>105156288</label></td></tr></tbody></table>" +
            "                <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-token-4\">amc &amp; calibration of coal lab instrument - 1st year repair.</a>" +
            "              </td>" +
            "              <td width=\"20%\"><p><span style=\"color:#000;font-weight:bold;padding:0px 2px\">Maharashtra State Power Generation Company Limited</span><br/><br/>Not Classified, Maharashtra, India</p></td>" +
            "              <td width=\"15%\"><p>23.57 Lacs<br/><br/>16-10-2026</p></td>" +
            "            </tr>" +
            "            <tr>" +
            "              <td width=\"65%\">" +
            "                <table><tbody><tr><td width=\"5%\"><strong>5.</strong></td><td width=\"95%\">T247 ID : <label>105152438</label></td></tr></tbody></table>" +
            "                <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-token-5\">comprehensive annual maintenance of ros, water purifiers and</a>" +
            "              </td>" +
            "              <td width=\"20%\"><p><span style=\"color:#000;font-weight:bold;padding:0px 2px\">Indian Institute Of Technology</span><br/><br/>Indore, Madhya Pradesh, India</p></td>" +
            "              <td width=\"15%\"><p>21.99 Lacs<br/><br/>17-10-2026</p></td>" +
            "            </tr>" +
            "          </tbody>" +
            "        </table>" +
            "      </td>" +
            "    </tr>" +
            "  </tbody>" +
            "</table>";

        Method parseMethod = EmailSyncService.class.getDeclaredMethod("extractTendersFromEmailHtml", String.class);
        parseMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        List<Map<String, String>> tenders = (List<Map<String, String>>) parseMethod.invoke(emailSyncService, sanitizedHtml);

        assertEquals(5, tenders.size(), "Must extract exactly 5 unique preview tenders from sanitized authentic email fixture");

        Map<String, String> t0 = tenders.get(0);
        assertEquals("105136457", t0.get("id"));
        assertTrue(t0.get("title").contains("spl repair / replacement"));
        assertEquals("Military Engineer Services", t0.get("authority"));
        assertEquals("Firozpur, Punjab, India", t0.get("location"));
        assertEquals("30-10-2026", t0.get("due_date"));
        assertEquals("47.62 Lacs", t0.get("estimated_cost_raw"));
        assertNull(t0.get("ref_no"), "Missing official reference number must remain empty/null");

        Map<String, String> t1 = tenders.get(1);
        assertEquals("105137067", t1.get("id"));
        assertEquals("Public Works Department", t1.get("authority"));
        assertEquals("Ernakulam, Kerala, India", t1.get("location"));
        assertEquals("17-10-2026", t1.get("due_date"));
        assertEquals("29.33 Lacs", t1.get("estimated_cost_raw"));

        Map<String, String> t2 = tenders.get(2);
        assertEquals("105091625", t2.get("id"));
        assertEquals("Public Works Department", t2.get("authority"));
        assertEquals("South Goa, Goa, India", t2.get("location"));

        Map<String, String> t3 = tenders.get(3);
        assertEquals("105156288", t3.get("id"));
        assertEquals("Maharashtra State Power Generation Company Limited", t3.get("authority"));
        assertEquals("Not Classified, Maharashtra, India", t3.get("location"));

        Map<String, String> t4 = tenders.get(4);
        assertEquals("105152438", t4.get("id"));
        assertEquals("Indian Institute Of Technology", t4.get("authority"));
        assertEquals("Indore, Madhya Pradesh, India", t4.get("location"));

        // Verify aggregator tracking link without official GeM bid number remains Unverified
        for (Map<String, String> item : tenders) {
            String classified = TenderClassifier.classify(item.get("ref_no"), item.get("url"), "", item.get("title"));
            assertEquals("Unverified", classified, "Aggregator-only tracking URL without official bid number must stay Unverified");
        }
    }

    @Test
    @DisplayName("Responsive duplicate desktop and mobile tables are deduplicated to single 5 tenders")
    void testResponsiveDuplicateTableRejection() throws Exception {
        String singleTable =
            "<table cellpadding=\"0\" cellspacing=\"0\">" +
            "  <thead><tr><td>TENDER DETAILS</td><td>ORGANIZATION &amp; LOCATION</td><td>VALUE &amp; DEADLINE</td></tr></thead>" +
            "  <tbody>" +
            "    <tr><td>T247 ID : 101<br><a href=\"https://r.tenders.bidsnrfp.com/1\">Title 1</a></td><td><b>Auth 1</b><br>Loc 1</td><td>10 Lacs 01-01-2026</td></tr>" +
            "    <tr><td>T247 ID : 102<br><a href=\"https://r.tenders.bidsnrfp.com/2\">Title 2</a></td><td><b>Auth 2</b><br>Loc 2</td><td>20 Lacs 02-01-2026</td></tr>" +
            "  </tbody>" +
            "</table>";
        String htmlWithDuplicate = "<div>" + singleTable + "<div class=\"mobile-view\">" + singleTable + "</div></div>";

        Method parseMethod = EmailSyncService.class.getDeclaredMethod("extractTendersFromEmailHtml", String.class);
        parseMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        List<Map<String, String>> tenders = (List<Map<String, String>>) parseMethod.invoke(emailSyncService, htmlWithDuplicate);

        assertEquals(2, tenders.size(), "Deduplication must prevent duplicate records from responsive copies");
    }

    @Test
    @DisplayName("Direct-child table traversal handles multiple direct-child tbody elements safely without nested badge pollution")
    void testMultipleDirectChildTbodyElementsHandledSafely() throws Exception {
        String htmlWithMultipleTbodies =
            "<table cellpadding=\"0\" cellspacing=\"0\">" +
            "  <thead>" +
            "    <tr><td>TENDER DETAILS</td><td>ORGANIZATION &amp; LOCATION</td><td>VALUE &amp; DEADLINE</td></tr>" +
            "  </thead>" +
            "  <tbody>" +
            "    <tr>" +
            "      <td>" +
            "        <table><tbody><tr><td><strong>1.</strong></td><td>T247 ID : <label>201</label></td></tr></tbody></table>" +
            "        <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-1\">Tender from Body 1 A</a>" +
            "      </td>" +
            "      <td><p><span style=\"font-weight:bold\">Authority 1A</span><br/><br/>Location 1A</p></td>" +
            "      <td><p>10 Lacs<br/><br/>01-11-2026</p></td>" +
            "    </tr>" +
            "    <tr>" +
            "      <td>" +
            "        <table><tbody><tr><td><strong>2.</strong></td><td>T247 ID : <label>202</label></td></tr></tbody></table>" +
            "        <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-2\">Tender from Body 1 B</a>" +
            "      </td>" +
            "      <td><p><span style=\"font-weight:bold\">Authority 1B</span><br/><br/>Location 1B</p></td>" +
            "      <td><p>20 Lacs<br/><br/>02-11-2026</p></td>" +
            "    </tr>" +
            "  </tbody>" +
            "  <tbody>" +
            "    <tr>" +
            "      <td>" +
            "        <table><tbody><tr><td><strong>3.</strong></td><td>T247 ID : <label>203</label></td></tr></tbody></table>" +
            "        <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-3\">Tender from Body 2 A</a>" +
            "      </td>" +
            "      <td><p><span style=\"font-weight:bold\">Authority 2A</span><br/><br/>Location 2A</p></td>" +
            "      <td><p>30 Lacs<br/><br/>03-11-2026</p></td>" +
            "    </tr>" +
            "    <tr>" +
            "      <td>" +
            "        <table><tbody><tr><td><strong>4.</strong></td><td>T247 ID : <label>204</label></td></tr></tbody></table>" +
            "        <a href=\"https://r.tenders.bidsnrfp.com/tr/cl/sanitized-4\">Tender from Body 2 B</a>" +
            "      </td>" +
            "      <td><p><span style=\"font-weight:bold\">Authority 2B</span><br/><br/>Location 2B</p></td>" +
            "      <td><p>40 Lacs<br/><br/>04-11-2026</p></td>" +
            "    </tr>" +
            "  </tbody>" +
            "</table>";

        Method parseMethod = EmailSyncService.class.getDeclaredMethod("extractTendersFromEmailHtml", String.class);
        parseMethod.setAccessible(true);
        @SuppressWarnings("unchecked")
        List<Map<String, String>> tenders = (List<Map<String, String>>) parseMethod.invoke(emailSyncService, htmlWithMultipleTbodies);

        assertEquals(4, tenders.size(), "Must extract all 4 tenders across both direct-child tbody elements");
        assertEquals("201", tenders.get(0).get("id"));
        assertEquals("Authority 1A", tenders.get(0).get("authority"));
        assertEquals("202", tenders.get(1).get("id"));
        assertEquals("Authority 1B", tenders.get(1).get("authority"));
        assertEquals("203", tenders.get(2).get("id"));
        assertEquals("Authority 2A", tenders.get(2).get("authority"));
        assertEquals("204", tenders.get(3).get("id"));
        assertEquals("Authority 2B", tenders.get(3).get("authority"));
    }

    @Test
    @DisplayName("Automated regression test against all six sanitized checked-in fixtures from classpath")
    void testSanitizedCheckedInFixturesForSixEmails() throws Exception {
        Map<String, List<String>> expectedFixtureTenders = new LinkedHashMap<>();
        expectedFixtureTenders.put("email-15-other-keyword.eml", List.of("105136457", "105137067", "105091625", "105156288", "105152438"));
        expectedFixtureTenders.put("email-168-medical-equipment.eml", List.of("101507564", "100478794", "100478757", "100807667", "101511271"));
        expectedFixtureTenders.put("email-17-commercial-refrigeration.eml", List.of("105156289", "105166269", "105136457", "105137067", "105091625"));
        expectedFixtureTenders.put("email-179-medical-equipment.eml", List.of("101507564", "105135540", "103322739", "105152980", "105135908"));
        expectedFixtureTenders.put("email-43-blood-bank.eml", List.of("105134070", "105156797", "105156799", "104783034", "105138423"));
        expectedFixtureTenders.put("email-74-office-furniture.eml", List.of("104794114", "105138000", "105134468", "105137605", "105125091"));

        Method parseMethod = EmailSyncService.class.getDeclaredMethod("extractTendersFromEmailHtml", String.class);
        parseMethod.setAccessible(true);

        Method getTextMethod = EmailSyncService.class.getDeclaredMethod("getTextFromMessage", jakarta.mail.Message.class);
        getTextMethod.setAccessible(true);

        Properties props = new Properties();
        Session session = Session.getDefaultInstance(props, null);

        int verifiedFileCount = 0;
        for (Map.Entry<String, List<String>> entry : expectedFixtureTenders.entrySet()) {
            String fixtureName = entry.getKey();
            List<String> expectedIds = entry.getValue();

            try (InputStream is = getClass().getResourceAsStream("/fixtures/" + fixtureName)) {
                assertNotNull(is, "Fixture resource must exist on classpath: /fixtures/" + fixtureName);

                MimeMessage message = new MimeMessage(session, is);
                String html = (String) getTextMethod.invoke(emailSyncService, message);
                assertNotNull(html);
                assertFalse(html.isBlank());

                @SuppressWarnings("unchecked")
                List<Map<String, String>> tenders = (List<Map<String, String>>) parseMethod.invoke(emailSyncService, html);

                assertEquals(5, tenders.size(), "Fixture " + fixtureName + " must yield exactly 5 preview tenders");

                for (int i = 0; i < 5; i++) {
                    Map<String, String> t = tenders.get(i);
                    assertEquals(expectedIds.get(i), t.get("id"), "Tender ID mismatch at index " + i + " in " + fixtureName);
                    assertNotNull(t.get("title"), "Title must not be null");
                    assertFalse(t.get("title").isBlank(), "Title must not be blank");
                    assertNotNull(t.get("authority"), "Authority must not be null");
                    assertFalse(t.get("authority").isBlank(), "Authority must not be blank");
                    assertNotNull(t.get("location"), "Location must not be null");
                    assertNotNull(t.get("due_date"), "Due date must not be null");
                    assertNotNull(t.get("estimated_cost_raw"), "Cost must not be null");

                    // None of the preview emails contain official GeM bid numbers
                    assertNull(t.get("ref_no"), "Preview tender in " + fixtureName + " must not invent ref_no");

                    // Aggregator-only preview records must classify as Unverified
                    String classified = TenderClassifier.classify(t.get("ref_no"), t.get("url"), "", t.get("title"));
                    assertEquals("Unverified", classified, "Aggregator preview without official bid number must stay Unverified");
                }
                verifiedFileCount++;
            }
        }
        assertEquals(6, verifiedFileCount, "All six sanitized checked-in fixtures must be verified");
    }

    @Test
    @DisplayName("Enrichment corrects unverified or erroneously defaulted GeM record when incoming has strong Non-GeM portal evidence")
    void testEnrichmentCorrectsErroneousGemWithAuthoritativeNonGem() {
        Tender existing = new Tender();
        existing.setId("T100");
        existing.setRefNo("N/A"); // placeholder ref
        existing.setOriginalUrl("https://www.tender247.com/keyword/details?id=100");
        existing.setTenderType("GeM"); // erroneously defaulted or legacy
        existing.setStatus("Issued");
        existing.setCurrentStage("SPEC_CLEARANCE");

        Map<String, String> incomingData = Map.of(
                "nameof_website", "eprocure.gov.in",
                "authority", "AIIMS New Delhi",
                "location", "Delhi"
        );
        String incomingLink = "https://eprocure.gov.in/epublish/app?component=view&page=TenderDetails";
        String incomingRef = "2026_AIIMS_12345_1";

        emailSyncService.enrichExistingRecordFromTender247(existing, incomingData, incomingRef, "Non GeM", incomingLink);

        assertEquals("Non GeM", existing.getTenderType(), "Strong verified Non-GeM portal evidence must correct ungrounded GeM label");
        assertEquals("2026_AIIMS_12345_1", existing.getRefNo(), "Placeholder refNo must be updated with incoming official ref");
        assertEquals(incomingLink, existing.getOriginalUrl(), "Aggregator link must be upgraded to verified portal URL");
        assertEquals("Issued", existing.getStatus(), "Workflow status must be preserved");
        assertEquals("SPEC_CLEARANCE", existing.getCurrentStage(), "Workflow stage must be preserved");
    }

    @Test
    @DisplayName("Enrichment preserves verified GeM record against weak or unverified incoming evidence")
    void testEnrichmentPreservesVerifiedGemAgainstWeakEvidence() {
        Tender existing = new Tender();
        existing.setId("T101");
        existing.setRefNo("GEM/2026/B/7570015");
        existing.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/7570015");
        existing.setTenderType("GeM");
        existing.setStatus("Issued");

        Map<String, String> incomingData = Map.of(
                "authority", "Department of Health"
        );
        String incomingLink = "https://www.tender247.com/keyword/details?id=101";

        emailSyncService.enrichExistingRecordFromTender247(existing, incomingData, "", "Unverified", incomingLink);

        assertEquals("GeM", existing.getTenderType(), "Verified GeM record must never be downgraded by unverified evidence");
        assertEquals("GEM/2026/B/7570015", existing.getRefNo());
        assertEquals("https://bidplus.gem.gov.in/showbidDocument/7570015", existing.getOriginalUrl(), "Verified GeM URL must not be replaced by aggregator link");
    }

    @Test
    @DisplayName("Enrichment marks conflicting verified portal sources as Unverified")
    void testEnrichmentMarksConflictingVerifiedPortalsAsUnverified() {
        Tender existing = new Tender();
        existing.setId("T102");
        existing.setRefNo("GEM/2026/B/9999999");
        existing.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/9999999");
        existing.setTenderType("GeM");

        Map<String, String> incomingData = Map.of(
                "nameof_website", "eprocure.gov.in"
        );
        String incomingLink = "https://eprocure.gov.in/epublish/app";

        emailSyncService.enrichExistingRecordFromTender247(existing, incomingData, "2026_CPPP_1111_1", "Non GeM", incomingLink);

        assertEquals("Unverified", existing.getTenderType(), "Direct conflict between verified GeM and verified Non-GeM portals must resolve to Unverified");
    }
}
