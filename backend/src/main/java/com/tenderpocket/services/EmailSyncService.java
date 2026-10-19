package com.tenderpocket.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import com.tenderpocket.utils.TenderClassifier;
import jakarta.mail.*;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.search.*;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class EmailSyncService {

    @Autowired
    private TenderRepository tenderRepository;

    @Value("${imap.host}")
    private String imapHost;

    @Value("${imap.port}")
    private int imapPort;

    @Value("${imap.username}")
    private String imapUsername;

    @Value("${imap.password}")
    private String imapPassword;

    @Value("${imap.sender-filter}")
    private String senderFilter;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public int syncEmails() throws Exception {
        int tendersImported = 0;
        if (imapUsername == null || imapUsername.isEmpty() || imapPassword == null || imapPassword.isEmpty()) {
            System.out.println("[EmailSync] IMAP credentials not configured. Skipping email sync.");
            return 0;
        }

        System.out.println(String.format("Connecting to IMAP mail server at %s:%d...", imapHost, imapPort));

        Properties properties = new Properties();
        properties.put("mail.store.protocol", "imaps");
        properties.put("mail.imaps.host", imapHost);
        properties.put("mail.imaps.port", String.valueOf(imapPort));
        properties.put("mail.imaps.ssl.enable", "true");
        properties.put("mail.imaps.connectiontimeout", "5000");
        properties.put("mail.imaps.timeout", "5000");

        Session emailSession = Session.getInstance(properties);
        Store store = emailSession.getStore("imaps");
        
        int retries = 2;
        for (int i = 0; i < retries; i++) {
            try {
                store.connect(imapHost, imapUsername, imapPassword);
                break;
            } catch (Exception e) {
                if (i == retries - 1) throw e;
                System.out.println(String.format("[Network Retry] IMAP connection failed: %s. Retrying in 3s...", e.getMessage()));
                Thread.sleep(3000);
            }
        }

        try {
            Folder inbox = store.getFolder("INBOX");
            inbox.open(Folder.READ_WRITE);

            LocalDate todayIST = LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
            LocalDate cutoffDate = todayIST.minusDays(1); // Last 2 days: today and yesterday
            Date cutoffDateObj = Date.from(cutoffDate.atStartOfDay(java.time.ZoneId.of("Asia/Kolkata")).toInstant());

            SearchTerm unreadTerm = new FlagTerm(new Flags(Flags.Flag.SEEN), false);
            SearchTerm searchTerm = unreadTerm;
            if (senderFilter != null && !senderFilter.isEmpty()) {
                searchTerm = new AndTerm(unreadTerm, new FromStringTerm(senderFilter));
            }

            try {
                SearchTerm dateTerm = new ReceivedDateTerm(ComparisonTerm.GE, cutoffDateObj);
                searchTerm = new AndTerm(searchTerm, dateTerm);
            } catch (Exception ignored) {}

            Message[] messages;
            try {
                messages = inbox.search(searchTerm);
            } catch (Exception e) {
                System.out.println("[EmailSync] IMAP search with date term failed (" + e.getMessage() + "). Falling back to unread term search.");
                SearchTerm fallbackSearch = unreadTerm;
                if (senderFilter != null && !senderFilter.isEmpty()) {
                    fallbackSearch = new AndTerm(unreadTerm, new FromStringTerm(senderFilter));
                }
                messages = inbox.search(fallbackSearch);
            }

            System.out.println(String.format("Found %d unread message(s) matching filter. Processing only last 2 days (since %s IST)...", messages.length, cutoffDate));

            for (Message msg : messages) {
                String subject = msg.getSubject();
                String from = (msg.getFrom() != null && msg.getFrom().length > 0) ? msg.getFrom()[0].toString() : "Unknown";

                // Enforce 2-day cutoff (Asia/Kolkata) on message received / sent date
                Date msgDate = msg.getReceivedDate() != null ? msg.getReceivedDate() : msg.getSentDate();
                if (msgDate != null) {
                    LocalDate emailLocalDate = msgDate.toInstant().atZone(java.time.ZoneId.of("Asia/Kolkata")).toLocalDate();
                    if (emailLocalDate.isBefore(cutoffDate)) {
                        System.out.println(String.format("Email \"%s\" from %s dated %s is older than 2-day cutoff (%s). Marking as read and skipping.",
                                subject, from, emailLocalDate, cutoffDate));
                        msg.setFlag(Flags.Flag.SEEN, true);
                        continue;
                    }
                }

                System.out.println(String.format("Processing email: %s from %s", subject, from));

                if (senderFilter != null && !senderFilter.isEmpty() && !from.toLowerCase().contains(senderFilter.toLowerCase())) {
                    System.out.println("Email does not match sender filter. Skipping.");
                    continue;
                }

                String content = getTextFromMessage(msg);
                List<Map<String, String>> tenders = extractTendersFromEmailHtml(content);
                System.out.println(String.format("Extracted %d tenders from email.", tenders.size()));

                for (Map<String, String> tData : tenders) {
                    String id = tData.get("id");
                    String link = tData.get("url");
                    String refNo = tData.getOrDefault("ref_no", "").trim();
                    String title = tData.getOrDefault("title", "Tender " + id);
                    String nameofWebsite = tData.getOrDefault("nameof_website", "");

                    if (id == null || link == null) continue;

                    // If refNo is still blank, attempt to extract a GeM bid number from the title or link
                    if (refNo.isEmpty()) {
                        String extracted = TenderClassifier.extractGemBidNumber(title, link);
                        if (extracted != null) {
                            refNo = extracted;
                        }
                    }

                    // Evidence-based platform classification
                    String classifiedType = TenderClassifier.classify(refNo, link, nameofWebsite, title);

                    // Cross-source deduplication check:
                    // 1) Match by official refNo (e.g. GeM bid number) if available and not a placeholder
                    // 2) Match by primary key id (Tender247 ID) ONLY if existing record belongs to Tender247 namespace or refNo matches
                    // 3) Match by sourceId ONLY if existing record belongs to Tender247 namespace or refNo matches
                    Optional<Tender> existingOpt = Optional.empty();
                    if (!TenderClassifier.isPlaceholderRefNo(refNo)) {
                        existingOpt = tenderRepository.findFirstByRefNo(refNo);
                    }
                    if (existingOpt.isEmpty() && id != null && !id.isBlank()) {
                        Optional<Tender> byId = tenderRepository.findById(id);
                        if (byId.isPresent() && isLegitimateT247Match(byId.get(), id, refNo)) {
                            existingOpt = byId;
                        }
                    }
                    if (existingOpt.isEmpty() && id != null && !id.isBlank()) {
                        Optional<Tender> bySourceId = tenderRepository.findFirstBySourceId(id);
                        if (bySourceId.isPresent() && isLegitimateT247Match(bySourceId.get(), id, refNo)) {
                            existingOpt = bySourceId;
                        }
                    }

                    if (existingOpt.isPresent()) {
                        Tender existing = existingOpt.get();
                        enrichExistingRecordFromTender247(existing, tData, refNo, classifiedType, link);
                        tenderRepository.save(existing);
                        System.out.println(String.format("[EmailSync] Enriched existing tender id=%s refNo=%s with classification=%s",
                                existing.getId(), existing.getRefNo(), existing.getTenderType()));
                        continue;
                    }

                    // Prevent primary key collision with unrelated tender from another namespace
                    String tenderId = id;
                    if (tenderRepository.existsById(id)) {
                        tenderId = "t247-" + id;
                    }

                    Tender tender = new Tender();
                    tender.setId(tenderId);
                    tender.setSourceId(id);
                    tender.setRefNo(refNo);
                    tender.setTitle(title);
                    tender.setAuthority(tData.getOrDefault("authority", ""));
                    tender.setEstimatedCost(null);
                    tender.setEstimatedCostRaw(tData.getOrDefault("estimated_cost_raw", "N/A"));
                    tender.setEmd(null);
                    tender.setEmdRaw(tData.getOrDefault("emd_raw", "N/A"));
                    tender.setDocumentFee(null);
                    tender.setDocumentFeeRaw(tData.getOrDefault("document_fee_raw", "N/A"));
                    tender.setLocation(tData.getOrDefault("location", "N/A"));
                    tender.setSector(nameofWebsite.isEmpty() ? null : nameofWebsite);
                    tender.setDueDate(tData.getOrDefault("due_date", ""));
                    tender.setOpeningDate(null);
                    tender.setDocumentUrl(null);
                    tender.setOriginalUrl(link);
                    tender.setStatus("Issued");
                    tender.setScrapedAt(new Date().toString());
                    tender.setEntryDate(LocalDate.now().format(DateTimeFormatter.ofPattern("d MMM yyyy")));
                    tender.setSource("Tender247");
                    tender.setTenderType(classifiedType);

                    tenderRepository.save(tender);
                    tendersImported++;
                }

                // Mark processed email as read
                msg.setFlag(Flags.Flag.SEEN, true);
            }

            inbox.close(true);
        } finally {
            store.close();
            System.out.println("Disconnected from IMAP store.");
        }

        return tendersImported;
    }

    private String getTextFromMessage(Message message) throws MessagingException, IOException {
        if (message.isMimeType("text/plain")) {
            return message.getContent().toString();
        } else if (message.isMimeType("text/html")) {
            return message.getContent().toString();
        } else if (message.isMimeType("multipart/*")) {
            MimeMultipart mimeMultipart = (MimeMultipart) message.getContent();
            return getTextFromMimeMultipart(mimeMultipart);
        }
        return "";
    }

    private String getTextFromMimeMultipart(MimeMultipart mimeMultipart) throws MessagingException, IOException {
        StringBuilder result = new StringBuilder();
        int count = mimeMultipart.getCount();
        for (int i = 0; i < count; i++) {
            BodyPart bodyPart = mimeMultipart.getBodyPart(i);
            if (bodyPart.isMimeType("text/plain")) {
                result.append(bodyPart.getContent());
            } else if (bodyPart.isMimeType("text/html")) {
                result.append(bodyPart.getContent());
            } else if (bodyPart.getContent() instanceof MimeMultipart) {
                result.append(getTextFromMimeMultipart((MimeMultipart) bodyPart.getContent()));
            }
        }
        return result.toString();
    }

    private List<Map<String, String>> extractTendersFromEmailHtml(String html) {
        List<Map<String, String>> tenders = new ArrayList<>();
        try {
            Document doc = Jsoup.parse(html);
            // Search for Tender247 View All link or parse tables directly
            Element viewAll = doc.selectFirst("a:contains(View All), a:contains(Fresh Tenders)");
            if (viewAll != null) {
                String href = viewAll.absUrl("href");
                String key = extractT247Key(href);
                if (key != null && !key.isBlank()) {
                    return fetchTendersFromT247Api(key);
                }
            }

            // Fallback table parser
            Set<String> seenIds = new HashSet<>();
            Elements tables = doc.select("table");
            for (Element table : tables) {
                // Check if this table has a direct header row for tender details
                Element header = table.selectFirst("> thead > tr");
                if (header == null) {
                    header = table.selectFirst("> tbody > tr, > tr");
                }
                if (header == null) continue;

                Elements headerCells = header.children();
                if (headerCells.size() < 3) continue;

                String c0Hdr = headerCells.get(0).text().toUpperCase();
                String c1Hdr = headerCells.get(1).text().toUpperCase();
                if (!c0Hdr.contains("TENDER DETAILS") || !c1Hdr.contains("ORGANIZATION")) {
                    continue;
                }

                // Genuine tender details table found: collect rows from all direct-child tbody elements
                Elements tbodies = table.select("> tbody");
                Elements rows = new Elements();
                if (!tbodies.isEmpty()) {
                    for (Element tb : tbodies) {
                        rows.addAll(tb.children());
                    }
                } else {
                    rows.addAll(table.children());
                }

                for (Element tr : rows) {
                    if (tr == header) continue;

                    Elements cells = tr.children();
                    if (cells.size() < 3) continue;

                    Element cell0 = cells.get(0);
                    Element cell1 = cells.get(1);
                    Element cell2 = cells.get(2);

                    String cell0Text = cell0.text();
                    Pattern p = Pattern.compile("T247\\s+ID\\s*:\\s*(\\d+)", Pattern.CASE_INSENSITIVE);
                    Matcher m = p.matcher(cell0Text);
                    if (!m.find()) continue;
                    String id = m.group(1);
                    if (id.isEmpty() || seenIds.contains(id)) continue;

                    Element a = cell0.selectFirst("a");
                    String url = a != null ? a.attr("href") : "";
                    if (url.isEmpty() && a != null) {
                        url = a.absUrl("href");
                    }
                    String title = a != null ? a.text().replaceAll("\\s+", " ").trim() : "";

                    Map<String, String> t = new HashMap<>();
                    t.put("id", id);
                    t.put("url", url);
                    t.put("title", title);

                    // Extract authority and location from cell1
                    Element authEl = cell1.selectFirst("span[style*=bold], strong, b");
                    String authority = "";
                    String location = "";
                    if (authEl != null) {
                        authority = authEl.text().replaceAll("\\s+", " ").trim();
                        location = cell1.text().replace(authEl.text(), "").replaceAll("\\s+", " ").trim();
                    } else {
                        String[] parts = cell1.text().split("\\n");
                        if (parts.length > 1) {
                            authority = parts[0].trim();
                            location = parts[1].trim();
                        } else {
                            authority = cell1.text().trim();
                            location = "N/A";
                        }
                    }
                    t.put("authority", authority);
                    t.put("location", location);

                    // Extract official bid number from title or cell0 text if present
                    String bidNo = TenderClassifier.extractGemBidNumber(title, cell0Text);
                    if (bidNo != null && !bidNo.isBlank()) {
                        t.put("ref_no", bidNo);
                    }

                    // Extract due date & cost from cell2
                    String cell2Text = cell2.text().replaceAll("\\s+", " ").trim();
                    Matcher dateMatcher = Pattern.compile("\\b(\\d{2}-\\d{2}-\\d{4})\\b").matcher(cell2Text);
                    if (dateMatcher.find()) {
                        t.put("due_date", dateMatcher.group(1));
                    }
                    String costRaw = cell2Text.replaceAll("\\b\\d{2}-\\d{2}-\\d{4}\\b", "").trim();
                    if (!costRaw.isEmpty()) {
                        t.put("estimated_cost_raw", costRaw);
                    }

                    seenIds.add(id);
                    tenders.add(t);
                }
            }
        } catch (Exception e) {
            System.err.println("Error parsing HTML email body: " + e.getMessage());
        }
        return tenders;
    }

    private List<Map<String, String>> fetchTendersFromT247Api(String key) throws Exception {
        String tokenUrl = "https://t247_api.tender247.com/apigateway/T247ApiTender/api/auth/login/user/key";
        String searchUrl = "https://t247_api.tender247.com/apigateway/T247Tender/mail/api/tender/auth/search-tender";

        Map<String, String> loginPayload = Map.of("key", key.replace(" ", "+"));
        
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.set("User-Agent", "Mozilla/5.0");

        HttpEntity<Map<String, String>> loginRequest = new HttpEntity<>(loginPayload, headers);
        ResponseEntity<JsonNode> loginResponse = restTemplate.postForEntity(tokenUrl, loginRequest, JsonNode.class);
        JsonNode dataNode = loginResponse.getBody().get("Data").get(0);

        String token = dataNode.get("token").asText();
        String userId = dataNode.get("user_id").asText();
        String queryId = dataNode.get("user_query_id").asText();
        String mailDate = dataNode.get("mail_date").asText();

        headers.setBearerAuth(token);

        Map<String, Object> searchPayload = new HashMap<>();
        searchPayload.put("tab_id", 1);
        searchPayload.put("tender_id", 0);
        searchPayload.put("page_no", 1);
        searchPayload.put("record_per_page", 100);
        searchPayload.put("user_id", userId);
        searchPayload.put("user_email_service_query_id", queryId);
        searchPayload.put("mail_date", mailDate);
        searchPayload.put("tab_status", 3);

        HttpEntity<Map<String, Object>> searchRequest = new HttpEntity<>(searchPayload, headers);
        ResponseEntity<JsonNode> searchResponse = restTemplate.postForEntity(searchUrl, searchRequest, JsonNode.class);
        
        List<Map<String, String>> tenders = new ArrayList<>();
        JsonNode docs = searchResponse.getBody().get("Data");
        for (JsonNode doc : docs) {
            String tenderId = doc.get("tender_id").asText();
            String securityCode = doc.has("security_code") && !doc.get("security_code").isNull() ? doc.get("security_code").asText() : "";
            String spaUrl = String.format("https://www.tender247.com/auth/tender/%s/%s/%s", tenderId, securityCode, userId);

            Map<String, String> t = new HashMap<>();
            t.put("id", tenderId);
            t.put("url", spaUrl);
            t.put("title", doc.has("requirement_workbrief") && !doc.get("requirement_workbrief").isNull() ? doc.get("requirement_workbrief").asText() : "");
            t.put("authority", doc.has("organization_name") && !doc.get("organization_name").isNull() ? doc.get("organization_name").asText() : "");
            t.put("location", doc.has("site_location") && !doc.get("site_location").isNull() ? doc.get("site_location").asText() : "");
            t.put("due_date", doc.has("submission_enddate") && !doc.get("submission_enddate").isNull() ? doc.get("submission_enddate").asText() : "");

            String tenderNumber = doc.has("tender_number") && !doc.get("tender_number").isNull() ? doc.get("tender_number").asText("").trim() : "";
            String nameofWebsite = doc.has("nameof_website") && !doc.get("nameof_website").isNull() ? doc.get("nameof_website").asText("").trim() : "";

            if (doc.has("tender_estimatedcost") && !doc.get("tender_estimatedcost").isNull()) {
                t.put("estimated_cost_raw", doc.get("tender_estimatedcost").asText());
            }
            if (doc.has("earnest_money_deposite") && !doc.get("earnest_money_deposite").isNull()) {
                t.put("emd_raw", doc.get("earnest_money_deposite").asText());
            }
            if (doc.has("document_fees") && !doc.get("document_fees").isNull()) {
                t.put("document_fee_raw", doc.get("document_fees").asText());
            }

            // If tender_number or nameof_website is missing, fetch from tender-detail endpoint safely
            if (tenderNumber.isEmpty() || nameofWebsite.isEmpty()) {
                Map<String, String> detail = fetchTenderDetailSafe(tenderId, securityCode, token);
                if (tenderNumber.isEmpty() && detail.containsKey("tender_number")) {
                    tenderNumber = detail.get("tender_number");
                }
                if (nameofWebsite.isEmpty() && detail.containsKey("nameof_website")) {
                    nameofWebsite = detail.get("nameof_website");
                }
                if (!t.containsKey("estimated_cost_raw") && detail.containsKey("estimated_cost_raw")) {
                    t.put("estimated_cost_raw", detail.get("estimated_cost_raw"));
                }
                if (!t.containsKey("emd_raw") && detail.containsKey("emd_raw")) {
                    t.put("emd_raw", detail.get("emd_raw"));
                }
                if (!t.containsKey("document_fee_raw") && detail.containsKey("document_fee_raw")) {
                    t.put("document_fee_raw", detail.get("document_fee_raw"));
                }
            }

            if (!tenderNumber.isEmpty()) {
                t.put("ref_no", tenderNumber);
            }
            if (!nameofWebsite.isEmpty()) {
                t.put("nameof_website", nameofWebsite);
            }

            tenders.add(t);
        }

        return tenders;
    }

    private Map<String, String> fetchTenderDetailSafe(String tenderId, String securityCode, String token) {
        if (tenderId == null || tenderId.isBlank()) return Collections.emptyMap();
        try {
            String detailUrl = "https://t247_api.tender247.com/apigateway/T247Tender/api/tender/tender-detail/" + tenderId;
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("User-Agent", "Mozilla/5.0");
            headers.set("Referer", "https://www.tender247.com/");
            if (token != null && !token.isBlank()) {
                headers.setBearerAuth(token);
            }

            Map<String, Object> payload = new HashMap<>();
            payload.put("guest_user_id", 0);
            payload.put("security_code", securityCode != null ? securityCode : "");
            payload.put("ip", "");

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(payload, headers);
            ResponseEntity<JsonNode> response = restTemplate.postForEntity(detailUrl, request, JsonNode.class);
            if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null && response.getBody().has("Data")) {
                JsonNode data = response.getBody().get("Data");
                if (data.isArray() && data.size() > 0) {
                    JsonNode detail = data.get(0);
                    Map<String, String> res = new HashMap<>();
                    if (detail.has("tender_number") && !detail.get("tender_number").isNull()) {
                        res.put("tender_number", detail.get("tender_number").asText("").trim());
                    }
                    if (detail.has("nameof_website") && !detail.get("nameof_website").isNull()) {
                        res.put("nameof_website", detail.get("nameof_website").asText("").trim());
                    }
                    if (detail.has("tender_estimatedcost") && !detail.get("tender_estimatedcost").isNull()) {
                        res.put("estimated_cost_raw", detail.get("tender_estimatedcost").asText());
                    }
                    if (detail.has("earnest_money_deposite") && !detail.get("earnest_money_deposite").isNull()) {
                        res.put("emd_raw", detail.get("earnest_money_deposite").asText());
                    }
                    if (detail.has("document_fees") && !detail.get("document_fees").isNull()) {
                        res.put("document_fee_raw", detail.get("document_fees").asText());
                    }
                    return res;
                }
            }
        } catch (Exception e) {
            System.out.println(String.format("[T247Detail] Warning: Failed to fetch detail for tender %s: %s", tenderId, e.getMessage()));
        }
        return Collections.emptyMap();
    }

    public static String extractT247Key(String href) {
        if (href == null || !href.contains("key=")) return null;
        int start = href.indexOf("key=") + 4;
        int end = href.indexOf('&', start);
        String rawKey = (end != -1) ? href.substring(start, end) : href.substring(start);
        try {
            return java.net.URLDecoder.decode(rawKey, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception ignored) {
            return rawKey;
        }
    }

    private boolean isLegitimateT247Match(Tender existing, String t247Id, String refNo) {
        if (existing == null) return false;
        // 1. Authoritative official bid number matches
        if (!TenderClassifier.isPlaceholderRefNo(refNo) && !TenderClassifier.isPlaceholderRefNo(existing.getRefNo())) {
            if (refNo.equalsIgnoreCase(existing.getRefNo())) {
                return true;
            }
        }
        // 2. Same source namespace ("Tender247")
        if ("Tender247".equalsIgnoreCase(existing.getSource())) {
            if (t247Id != null && (t247Id.equalsIgnoreCase(existing.getId()) || t247Id.equalsIgnoreCase(existing.getSourceId()))) {
                return true;
            }
        }
        // If existing record belongs to another source (e.g. GeM) and refNo does not match, reject match
        return false;
    }

    void enrichExistingRecordFromTender247(Tender existing, Map<String, String> tData, String refNo, String classifiedType, String link) {
        // 1. Official reference / bid number
        if ((existing.getRefNo() == null || existing.getRefNo().isBlank() || TenderClassifier.isPlaceholderRefNo(existing.getRefNo()))
                && !TenderClassifier.isPlaceholderRefNo(refNo)) {
            existing.setRefNo(refNo);
        }

        // 2. Classification enrichment & precedence:
        // - Verified official source evidence takes precedence.
        // - Strong incoming Non-GeM evidence can correct an unverified or erroneously defaulted "GeM" record,
        //   provided the existing record does NOT have verified GeM evidence (valid GeM bid number or official GeM domain).
        // - Strong incoming GeM evidence upgrades existing records unless the existing record has verified Non-GeM evidence.
        // - Direct conflict between verified official sources resolves to "Unverified".
        // - Weak or unverified incoming evidence never overwrites existing verified classifications.
        boolean existingHasVerifiedGem = TenderClassifier.isValidGemBidNumber(existing.getRefNo())
                || TenderClassifier.isOfficialGemDomain(existing.getOriginalUrl());
        boolean existingHasVerifiedNonGem = TenderClassifier.isVerifiedNonGemDomain(existing.getOriginalUrl())
                || TenderClassifier.isVerifiedNonGemDomain(existing.getSector());

        boolean incomingHasVerifiedGem = "GeM".equalsIgnoreCase(classifiedType)
                && (TenderClassifier.isValidGemBidNumber(refNo)
                || TenderClassifier.isOfficialGemDomain(link)
                || TenderClassifier.isOfficialGemDomain(tData.get("nameof_website")));
        boolean incomingHasVerifiedNonGem = "Non GeM".equalsIgnoreCase(classifiedType)
                && (TenderClassifier.isVerifiedNonGemDomain(link)
                || TenderClassifier.isVerifiedNonGemDomain(tData.get("nameof_website")));

        if (incomingHasVerifiedGem && existingHasVerifiedNonGem) {
            existing.setTenderType("Unverified");
        } else if (incomingHasVerifiedNonGem && existingHasVerifiedGem) {
            existing.setTenderType("Unverified");
        } else if (incomingHasVerifiedGem) {
            existing.setTenderType("GeM");
        } else if (incomingHasVerifiedNonGem) {
            if (!existingHasVerifiedGem) {
                existing.setTenderType("Non GeM");
            }
        } else if ("GeM".equalsIgnoreCase(classifiedType)) {
            if (!existingHasVerifiedNonGem && (existing.getTenderType() == null || existing.getTenderType().isBlank() || "Unverified".equalsIgnoreCase(existing.getTenderType()))) {
                existing.setTenderType("GeM");
            }
        } else if ("Non GeM".equalsIgnoreCase(classifiedType)) {
            if (!existingHasVerifiedGem && (existing.getTenderType() == null || existing.getTenderType().isBlank() || "Unverified".equalsIgnoreCase(existing.getTenderType()))) {
                existing.setTenderType("Non GeM");
            }
        } else if (existing.getTenderType() == null || existing.getTenderType().isBlank()) {
            existing.setTenderType(classifiedType);
        }

        // 3. Original URL enrichment:
        // If incoming has an official portal URL (e.g. gem.gov.in) and existing is an aggregator link or blank
        if (TenderClassifier.isOfficialGemDomain(link) || TenderClassifier.isVerifiedNonGemDomain(link)) {
            existing.setOriginalUrl(link);
        }

        // 4. Metadata non-destructive enrichment: do not overwrite populated values with blank/null
        if (existing.getAuthority() == null || existing.getAuthority().isBlank()) {
            existing.setAuthority(tData.getOrDefault("authority", ""));
        }
        if (existing.getLocation() == null || existing.getLocation().isBlank() || "N/A".equalsIgnoreCase(existing.getLocation())) {
            existing.setLocation(tData.getOrDefault("location", "N/A"));
        }
        if (existing.getDueDate() == null || existing.getDueDate().isBlank()) {
            existing.setDueDate(tData.getOrDefault("due_date", ""));
        }
        if ((existing.getEstimatedCostRaw() == null || "N/A".equalsIgnoreCase(existing.getEstimatedCostRaw())) && tData.containsKey("estimated_cost_raw")) {
            existing.setEstimatedCostRaw(tData.get("estimated_cost_raw"));
        }
        if ((existing.getEmdRaw() == null || "N/A".equalsIgnoreCase(existing.getEmdRaw())) && tData.containsKey("emd_raw")) {
            existing.setEmdRaw(tData.get("emd_raw"));
        }
        if ((existing.getDocumentFeeRaw() == null || "N/A".equalsIgnoreCase(existing.getDocumentFeeRaw())) && tData.containsKey("document_fee_raw")) {
            existing.setDocumentFeeRaw(tData.get("document_fee_raw"));
        }
        if ((existing.getSector() == null || existing.getSector().isBlank()) && tData.containsKey("nameof_website")) {
            existing.setSector(tData.get("nameof_website"));
        }
    }
}
