package com.tenderpocket.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.TenderRepository;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class GeMScraperService {

    @Autowired
    private TenderRepository tenderRepository;

    @Value("${gemini.api.key}")
    private String geminiApiKey;

    private final RestTemplate restTemplate = new RestTemplate();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private String cachedCookieHeader = null;
    private String cachedCsrfHash = null;

    private static final List<String> RAW_KEYWORDS = Arrays.asList(
            "EXAMINATION TABLE", "Active Cold Box", "BIPAP", "Blood Bag Sealer", "Blood Bag Tube Sealer", 
            "Boyle's Machine", "C-ARM Machine", "Cautery Machine", "Cell Counter", "Chemistry Analyser", 
            "Colorimeter", "Colour Doppler", "CPAP", "Crash Cart", "CTG Machine", "Defibrillator", 
            "Ward Plain Bed", "Dielectric Sealer", "Digital Analytical Balance", "Digital X-Ray", 
            "Double Pan Balance", "Dressing Drum", "Dressing Trolley", "DVT Pump", "ECG Machine", 
            "Electric Bed", "Electro Surgical Unit", "Electrolyte", "Electrosurgical Device", 
            "Examination Couch", "Fetal Doppler", "Fogger Machine", "Foot Step", "Four Seater Chair Cushion", 
            "Fowler Bed", "Gel Card Incubator", "Haematology Analyzer", "Hematology Analyzer", 
            "Hemoglobin Analyzer", "Hemoglobinometer", "Holder Machine", "Hospital Bed", "Hospital Chair", 
            "Hospital Furniture", "Hospital Table", "Hospital Trolley", "ICU Bed", "Instrument Trolley", 
            "IV Rod", "Modular Operation Theatre", "Laminar Cabinet", "Laparoscopy Set", "Laparoscopy Trolley", 
            "LDR Bed", "Mattress for ICU", "Mattress for Semi Fowler", "Medical Equipment", 
            "Medical Gas Pipeline System", "Medical Hospital Lamps", "Microscope", "Modular Multipara Monitor", 
            "Office Chair", "Operating Theatre Pendant", "Operation Table", "OT LED Light Double Dome", 
            "OT Pendant", "OT Table Electric cum Manual", "Over Bed Table", "Oxygen Concentrator", 
            "Patient Monitor", "Pediatric Bed", "PH Meter", "Plain Bed", "Pulse Oximeter", "Radiant Warmer", 
            "Radiology & Imaging", "Recovery Trolley Hydraulic", "Revolving Stool", "RH View Box", 
            "Rolling Hypothermia Treatment Carts", "Fradi", "Semi Auto Analyser", "Semi Fowler Bed", 
            "Sterile Connecting Device", "Stretcher", "Suction Machine", "Syringe Pump", "Thermometer", 
            "Three Seater Chair", "TMT Machine", "Tube Stripper", "Ultrasonic Cleaner", "Ultrasound Machine", 
            "Ultrasound USG Machine", "USG Machine", "VDRL Shaker", "Ventilator", "Visi Cooler", 
            "Visual Light Box", "Volumetric Infusion Pump", "Weighing Scale", "X-Ray Machine", "IVD Pathology", 
            "Laproscopy and endoscopy", "Commercial Refrigeration", "Freezer / Deep Freezer", "Chest Freezer", 
            "Chiller", "Insulated Truck / Vehicles", "Insulated Van / Vehicles", "Refrigerated Vans / Trucks / Vehicles", 
            "Refrigerator", "Remote Temperature Monitoring Device (WHO Tested)", 
            "Solar Walk In Cooler and Freezer / Cold Room", "Walk-In-Freezer / Cold Room", "Steel Cupboards & Funriture Range", 
            "3 door steel cupboards", "2 door steel cupboards", "Office steel cupboards", 
            "Particle Board Box bed Particle Board", "Particle Board Single Bed", "Particle Board Double Bed", 
            "Particle Board Diwan", "Particle Board 3 Door Cupboard", "Particle Board 2 Door Cupboard", 
            "Particle Board Dressing Table", "Particle Board TV Showcase", "Particle Board Office Table", 
            "Steel Funriture", "ALMIRAH"
    );

    public int syncTenders(boolean allDates, List<String> customKeywords) throws Exception {
        List<String> keywords = customKeywords != null && !customKeywords.isEmpty() ? customKeywords : RAW_KEYWORDS;
        int importCount = 0;

        System.out.println("--- GeM Java Sync Engine Started ---");
        System.out.println("Processing keyword count: " + keywords.size());

        for (int i = 0; i < keywords.size(); i++) {
            String keyword = keywords.get(i).trim();
            if (keyword.length() < 3) continue;
            System.out.println(String.format("[%d/%d] Querying GeM for: \"%s\"...", i + 1, keywords.size(), keyword));

            try {
                JsonNode docs = searchKeyword(keyword);
                System.out.println(String.format("  - Found %d ongoing bid(s) for \"%s\"", docs.size(), keyword));

                for (JsonNode doc : docs) {
                    String bId = getJsonString(doc, "b_id");
                    String bidNo = getJsonString(doc, "b_bid_number");

                    if (bId == null || bidNo == null) continue;

                    // Deduplication check
                    Optional<Tender> existing = tenderRepository.findById(bId);
                    if (existing.isPresent()) {
                        continue;
                    }

                    String start = getJsonString(doc, "final_start_date_sort");
                    String formattedStartDate = (start != null && start.contains("T")) ? start.split("T")[0] : "";

                    // Date filter
                    String todayStr = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
                    if (!allDates && !formattedStartDate.equals(todayStr)) {
                        continue;
                    }

                    String items = getJsonString(doc, "b_category_name");
                    String dept = getJsonString(doc, "ba_official_details_deptName");

                    // Require at least 2 matching keywords before fetching/importing tender from GeM portal
                    String fullSearchableText = (items != null ? items : "") + " " + (dept != null ? dept : "") + " " + doc.toString();
                    int keywordMatches = countMatchingKeywords(fullSearchableText, keywords);
                    if (keywordMatches < 2) {
                        System.out.println(String.format("  - Skipping GeM Bid %s (\"%s\"): Only matched %d keyword(s) (Minimum 2 keywords required).", bidNo, items, keywordMatches));
                        continue;
                    }

                    importCount++;
                    String qty = getJsonString(doc, "b_total_quantity");
                    String end = getJsonString(doc, "final_end_date_sort");

                    String bIdParent = getJsonString(doc, "b_id_parent");
                    String docDownloadId = bIdParent != null ? bIdParent : bId;
                    String url = "https://bidplus.gem.gov.in/showbidDocument/" + docDownloadId;

                    String bidNoParent = getJsonString(doc, "b_bid_number_parent");
                    String officialRefNo = bidNoParent != null ? bidNoParent : bidNo;

                    Map<String, String> loc = parseLocationFromDept(dept);
                    Map<String, String> defaults = computeDefaultBusinessMetadata(items, officialRefNo, loc.get("place") + ", " + loc.get("state"), url);

                    String startDateTimeStr = formatDateTime(start);
                    String endDateTimeStr = end != null ? formatDateTime(end) : defaults.get("due_date");

                    Tender tender = new Tender();
                    tender.setId(bId);
                    tender.setRefNo(officialRefNo);
                    tender.setTitle(items);
                    tender.setAuthority(dept);
                    tender.setEstimatedCost(null);
                    tender.setEstimatedCostRaw("N/A");
                    tender.setEmd(null);
                    tender.setEmdRaw("N/A");
                    tender.setDocumentFee(null);
                    tender.setDocumentFeeRaw("N/A");
                    tender.setLocation(loc.get("place") + ", " + loc.get("state"));
                    tender.setSector(null);
                    tender.setDueDate(endDateTimeStr);
                    tender.setOpeningDate(null);
                    tender.setDocumentUrl(null);
                    tender.setOriginalUrl(url);
                    tender.setStatus("Issued");
                    tender.setScrapedAt(new Date().toString());
                    tender.setNotes(String.format("Imported automatically by daily GeM Sync job matching keyword \"%s\".", keyword));
                    tender.setEntryDate(defaults.get("entry_date"));
                    tender.setMisExecutive("");
                    tender.setSource("GeM");
                    tender.setSourceId(bidNo);
                    tender.setVerticalName(defaults.get("vertical_name"));
                    tender.setPlace(loc.get("place"));
                    tender.setState(loc.get("state"));
                    tender.setTenderType("GeM");
                    tender.setPublishDate(formattedStartDate);
                    tender.setStartDate(startDateTimeStr);
                    tender.setTime("N/A");
                    tender.setPreBidDate("No");
                    tender.setCorrigendumRemark("No");
                    tender.setProductNameAsPerTender(items);
                    tender.setProductNameAsPerMarken(defaults.get("vertical_name"));
                    tender.setBidQty(qty != null ? Integer.parseInt(qty) : 1);
                    tender.setQuotedQty(qty != null ? Integer.parseInt(qty) : 1);

                    tenderRepository.save(tender);
                    System.out.println(String.format("  - Registered new GeM Bid: %s", bidNo));

                    // Download document PDF and run python PDF parser
                    downloadAndParseGemPdf(bId, url, bidNo, doc);
                }

                // Rate limiting sleep
                Thread.sleep(2500);

            } catch (Exception e) {
                String errorMsg = e.getMessage() != null ? e.getMessage() : e.toString();
                System.err.println(String.format("  - Error syncing GeM for keyword \"%s\": %s", keyword, errorMsg));
                if (errorMsg.contains("CSRF") || errorMsg.contains("session") || errorMsg.contains("non-200")) {
                    cachedCookieHeader = null;
                    cachedCsrfHash = null;
                }
            }
        }

        return importCount;
    }

    private void downloadAndParseGemPdf(String tenderId, String downloadUrl, String bidNo, JsonNode doc) {
        try {
            String localDir = "public/documents/" + tenderId;
            String localFileName = "Bid_Document_" + tenderId + ".pdf";
            String outputPath = localDir + "/" + localFileName;
            String localPath = "/documents/" + tenderId + "/" + localFileName;

            Files.createDirectories(Paths.get(localDir));
            
            System.out.println("  - Downloading Bid PDF to " + outputPath + "...");
            boolean success = downloadFile(downloadUrl, outputPath);
            if (success) {
                // Call external python parser
                ProcessBuilder pb = new ProcessBuilder("python3", "scripts/parse-gem-pdf.py", outputPath);
                Process process = pb.start();
                
                BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                
                int exitCode = process.waitFor();
                if (exitCode == 0) {
                    JsonNode parsed = objectMapper.readTree(sb.toString());
                    String place = parsed.has("place") ? parsed.get("place").asText() : "N/A";
                    String state = parsed.has("state") ? parsed.get("state").asText() : "N/A";
                    String dueDate = parsed.has("due_date") ? parsed.get("due_date").asText() : null;
                    String dueTime = parsed.has("due_time") ? parsed.get("due_time").asText() : null;
                    Double emdAmount = parsed.has("emd_amount") && !parsed.get("emd_amount").isNull() ? parsed.get("emd_amount").asDouble() : null;

                    Optional<Tender> opt = tenderRepository.findById(tenderId);
                    if (opt.isPresent()) {
                        Tender t = opt.get();
                        t.setDocumentUrl(localPath);
                        if (!"N/A".equals(place)) {
                            t.setPlace(place);
                            t.setLocation(place + ", " + state);
                        }
                        if (!"N/A".equals(state)) t.setState(state);
                        if (dueDate != null) {
                            t.setDueDate(dueDate + (dueTime != null ? " " + dueTime : ""));
                        }
                        if (emdAmount != null) {
                            t.setEmd(emdAmount);
                            t.setEmdRaw("₹" + emdAmount);
                        }
                        t.setDownloadedDocs(String.format("[{\"name\":\"Bid Document\",\"filename\":\"%s\",\"local_path\":\"%s\",\"created_date\":\"%s\"}]", 
                                localFileName, localPath, LocalDate.now().toString()));
                        tenderRepository.save(t);
                        System.out.println("  - Successfully updated PDF metadata for tender " + tenderId);
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("  - Failed to parse PDF: " + e.getMessage());
        }
    }

    private boolean downloadFile(String downloadUrl, String outputPath) {
        try {
            byte[] data = restTemplate.getForObject(downloadUrl, byte[].class);
            if (data != null) {
                try (FileOutputStream fos = new FileOutputStream(outputPath)) {
                    fos.write(data);
                }
                return true;
            }
        } catch (Exception e) {
            System.err.println("Download failed: " + e.getMessage());
        }
        return false;
    }

    private HttpClient buildHttpClient() {
        HttpClient.Builder builder = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .followRedirects(HttpClient.Redirect.ALWAYS)
                .connectTimeout(java.time.Duration.ofSeconds(15));

        String proxyHost = System.getenv("HTTP_PROXY_HOST");
        String proxyPort = System.getenv("HTTP_PROXY_PORT");
        if (proxyHost != null && !proxyHost.isEmpty() && proxyPort != null && !proxyPort.isEmpty()) {
            try {
                builder.proxy(java.net.ProxySelector.of(new java.net.InetSocketAddress(proxyHost, Integer.parseInt(proxyPort))));
            } catch (Exception e) {
                System.err.println("Failed to set HTTP proxy: " + e.getMessage());
            }
        }
        return builder.build();
    }

    private JsonNode searchKeyword(String keyword) throws Exception {
        getCredentials();

        String url = "https://bidplus.gem.gov.in/all-bids-data";
        
        Map<String, Object> param = new HashMap<>();
        param.put("searchBid", keyword);
        param.put("searchType", "fullText");

        Map<String, Object> filter = new HashMap<>();
        filter.put("bidStatusType", "ongoing_bids");
        filter.put("byType", "all");
        filter.put("highBidValue", "");
        filter.put("byEndDate", Map.of("from", "", "to", ""));
        filter.put("sort", "Bid-End-Date-Oldest");

        Map<String, Object> payload = new HashMap<>();
        payload.put("param", param);
        payload.put("filter", filter);

        String payloadStr = objectMapper.writeValueAsString(payload);

        HttpClient client = buildHttpClient();
        String formBody = "payload=" + java.net.URLEncoder.encode(payloadStr, "UTF-8") +
                "&csrf_bd_gem_nk=" + cachedCsrfHash;

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .version(HttpClient.Version.HTTP_1_1)
                .timeout(java.time.Duration.ofSeconds(20))
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .header("Accept", "application/json, text/javascript, */*; q=0.01")
                .header("Accept-Language", "en-US,en;q=0.9")
                .header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                .header("Referer", "https://bidplus.gem.gov.in/all-bids")
                .header("X-Requested-With", "XMLHttpRequest")
                .header("Cookie", cachedCookieHeader)
                .POST(HttpRequest.BodyPublishers.ofString(formBody))
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        JsonNode node = objectMapper.readTree(response.body());

        if (node.has("code") && node.get("code").asInt() == 200) {
            return node.get("response").get("response").get("docs");
        } else {
            throw new Exception("GeM search returned non-200 status code");
        }
    }

    private synchronized void getCredentials() throws Exception {
        if (cachedCookieHeader != null && cachedCsrfHash != null) {
            return;
        }

        String mainUrl = "https://bidplus.gem.gov.in/all-bids";
        
        HttpClient client = buildHttpClient();

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(mainUrl))
                .version(HttpClient.Version.HTTP_1_1)
                .timeout(java.time.Duration.ofSeconds(20))
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
                .header("Accept-Language", "en-US,en;q=0.9")
                .GET()
                .build();

        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        
        // Parse cookies
        List<String> cookies = response.headers().allValues("Set-Cookie");
        StringBuilder cookieBuilder = new StringBuilder();
        for (String c : cookies) {
            cookieBuilder.append(c.split(";")[0]).append("; ");
        }
        cachedCookieHeader = cookieBuilder.toString().trim();

        // Parse CSRF
        String html = response.body();
        Pattern pattern = Pattern.compile("'csrf_bd_gem_nk'\\s*:\\s*'([a-f0-9]+)'", Pattern.CASE_INSENSITIVE);
        Matcher matcher = pattern.matcher(html);
        if (matcher.find()) {
            cachedCsrfHash = matcher.group(1);
        } else {
            Document doc = Jsoup.parse(html);
            Element csrfInput = doc.selectFirst("input[name=csrf_bd_gem_nk]");
            if (csrfInput != null) {
                cachedCsrfHash = csrfInput.val();
            }
        }

        if (cachedCsrfHash == null) {
            throw new Exception("Failed to negotiate GeM CSRF token");
        }
    }

    private String getJsonString(JsonNode node, String field) {
        if (node.has(field)) {
            JsonNode f = node.get(field);
            if (f.isArray() && f.size() > 0) {
                return f.get(0).asText();
            }
            return f.asText();
        }
        return null;
    }

    private String formatDateTime(String dt) {
        if (dt == null) return null;
        return dt.replace("T", " ").replace("Z", "").split("\\.")[0];
    }

    private Map<String, String> parseLocationFromDept(String dept) {
        Map<String, String> loc = new HashMap<>();
        loc.put("place", "N/A");
        loc.put("state", "N/A");
        if (dept == null) return loc;
        
        List<String> states = Arrays.asList("Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chhattisgarh","Goa","Gujarat","Haryana","Himachal Pradesh","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal","Delhi","Jammu","Kashmir","Ladakh","Puducherry","Chandigarh");
        String lowerDept = dept.toLowerCase();
        
        for (String s : states) {
            if (lowerDept.contains(s.toLowerCase())) {
                loc.put("state", s);
                break;
            }
        }
        return loc;
    }

    private Map<String, String> computeDefaultBusinessMetadata(String title, String refNo, String location, String originalUrl) {
        Map<String, String> defaults = new HashMap<>();
        defaults.put("entry_date", LocalDate.now().format(DateTimeFormatter.ofPattern("d MMM yyyy")));
        
        String vertical = "Others";
        if (title != null) {
            String lowerTitle = title.toLowerCase();
            if (lowerTitle.contains("wheelchair") || lowerTitle.contains("trolley") || lowerTitle.contains("couch") || lowerTitle.contains("screen") || lowerTitle.contains("cart") || lowerTitle.contains("cabinet") || lowerTitle.contains("ward") || lowerTitle.contains("bed") || lowerTitle.contains("furniture") || lowerTitle.contains("table")) {
                vertical = "Medical Equipment & Furniture";
            } else if (lowerTitle.contains("centrifuge")) {
                vertical = "Centrifuge";
            } else if (lowerTitle.contains("freezer") || lowerTitle.contains("deep freezer")) {
                vertical = "Deep Freezer";
            } else if (lowerTitle.contains("hvac") || lowerTitle.contains("conditioning") || lowerTitle.contains("split ac") || lowerTitle.contains("chiller") || lowerTitle.contains("cooling")) {
                vertical = "HVAC";
            }
        }
        defaults.put("vertical_name", vertical);
        defaults.put("due_date", "N/A");
        return defaults;
    }

    public static int countMatchingKeywords(String content, List<String> keywords) {
        if (content == null || content.trim().isEmpty() || keywords == null || keywords.isEmpty()) {
            return 0;
        }
        String lowerContent = content.toLowerCase();
        Set<String> matchedKeywords = new HashSet<>();

        for (String kw : keywords) {
            if (kw == null) continue;
            String trimmedKw = kw.trim().toLowerCase();
            if (trimmedKw.length() < 3) continue;

            if (lowerContent.contains(trimmedKw)) {
                matchedKeywords.add(trimmedKw);
            }
        }
        return matchedKeywords.size();
    }
}
