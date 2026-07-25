package com.tenderpocket.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
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
        System.out.println(String.format("Connecting to IMAP mail server at %s:%d...", imapHost, imapPort));

        Properties properties = new Properties();
        properties.put("mail.store.protocol", "imaps");
        properties.put("mail.imaps.host", imapHost);
        properties.put("mail.imaps.port", String.valueOf(imapPort));
        properties.put("mail.imaps.ssl.enable", "true");

        Session emailSession = Session.getDefaultInstance(properties);
        Store store = emailSession.getStore("imaps");
        
        int retries = 3;
        for (int i = 0; i < retries; i++) {
            try {
                store.connect(imapHost, imapUsername, imapPassword);
                break;
            } catch (Exception e) {
                if (i == retries - 1) throw e;
                System.out.println(String.format("[Network Retry] IMAP connection failed: %s. Retrying in 10s...", e.getMessage()));
                Thread.sleep(10000);
            }
        }

        try {
            Folder inbox = store.getFolder("INBOX");
            inbox.open(Folder.READ_WRITE);

            SearchTerm unreadTerm = new FlagTerm(new Flags(Flags.Flag.SEEN), false);
            SearchTerm searchTerm = unreadTerm;
            if (senderFilter != null && !senderFilter.isEmpty()) {
                searchTerm = new AndTerm(unreadTerm, new FromStringTerm(senderFilter));
            }

            Message[] messages = inbox.search(searchTerm);
            System.out.println(String.format("Found %d unread message(s) matching filter.", messages.length));

            for (Message msg : messages) {
                String subject = msg.getSubject();
                String from = msg.getFrom()[0].toString();
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

                    if (id == null || link == null) continue;

                    Optional<Tender> existing = tenderRepository.findById(id);
                    if (existing.isPresent()) {
                        continue;
                    }

                    Tender tender = new Tender();
                    tender.setId(id);
                    tender.setRefNo(tData.getOrDefault("ref_no", ""));
                    tender.setTitle(tData.getOrDefault("title", "Tender " + id));
                    tender.setAuthority(tData.getOrDefault("authority", ""));
                    tender.setEstimatedCost(null);
                    tender.setEstimatedCostRaw(tData.getOrDefault("estimated_cost_raw", "N/A"));
                    tender.setEmd(null);
                    tender.setEmdRaw("N/A");
                    tender.setDocumentFee(null);
                    tender.setDocumentFeeRaw("N/A");
                    tender.setLocation(tData.getOrDefault("location", "N/A"));
                    tender.setSector(null);
                    tender.setDueDate(tData.getOrDefault("due_date", ""));
                    tender.setOpeningDate(null);
                    tender.setDocumentUrl(null);
                    tender.setOriginalUrl(link);
                    tender.setStatus("Issued");
                    tender.setScrapedAt(new Date().toString());
                    tender.setEntryDate(LocalDate.now().format(DateTimeFormatter.ofPattern("d MMM yyyy")));
                    tender.setSource("Tender247");
                    tender.setTenderType("Non GeM");

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
                if (href != null && href.contains("key=")) {
                    String key = href.substring(href.indexOf("key=") + 4);
                    return fetchTendersFromT247Api(key);
                }
            }

            // Fallback table parser
            Elements tables = doc.select("table");
            for (Element table : tables) {
                if (table.text().contains("TENDER DETAILS")) {
                    Elements rows = table.select("tbody > tr, tr");
                    for (Element tr : rows) {
                        Elements cells = tr.select("td");
                        if (cells.size() < 3) continue;

                        String cell1Text = cells.get(0).text();
                        if (cell1Text.contains("T247 ID")) {
                            Map<String, String> t = new HashMap<>();
                            
                            Pattern p = Pattern.compile("T247\\s+ID\\s*:\\s*(\\d+)", Pattern.CASE_INSENSITIVE);
                            Matcher m = p.matcher(cell1Text);
                            String id = m.find() ? m.group(1) : "";
                            
                            Element a = cells.get(0).selectFirst("a");
                            String url = a != null ? a.absUrl("href") : "";
                            String title = a != null ? a.text() : "";

                            if (!id.isEmpty() && !url.isEmpty()) {
                                t.put("id", id);
                                t.put("url", url);
                                t.put("title", title);
                                t.put("authority", cells.get(1).select("strong, b").text());
                                t.put("location", cells.get(1).text().replace(t.get("authority"), "").trim());
                                tenders.add(t);
                            }
                        }
                    }
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
            String securityCode = doc.has("security_code") ? doc.get("security_code").asText() : "";
            String spaUrl = String.format("https://www.tender247.com/auth/tender/%s/%s/%s", tenderId, securityCode, userId);

            Map<String, String> t = new HashMap<>();
            t.put("id", tenderId);
            t.put("url", spaUrl);
            t.put("title", doc.get("requirement_workbrief").asText());
            t.put("authority", doc.get("organization_name").asText());
            t.put("location", doc.get("site_location").asText());
            t.put("due_date", doc.get("submission_enddate").asText());
            tenders.add(t);
        }

        return tenders;
    }
}
