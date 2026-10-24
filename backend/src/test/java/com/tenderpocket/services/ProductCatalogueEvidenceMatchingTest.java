package com.tenderpocket.services;

import com.tenderpocket.dto.ClauseMatchResultDto;
import com.tenderpocket.dto.ProductModelDto;
import com.tenderpocket.dto.ProductSpecificationDto;
import com.tenderpocket.models.ProductModel;
import com.tenderpocket.models.ProductSpecificationItem;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.ProductModelRepository;
import com.tenderpocket.repositories.ProductSpecificationItemRepository;
import com.tenderpocket.repositories.TenderRepository;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.mock.web.MockMultipartFile;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

public class ProductCatalogueEvidenceMatchingTest {

    private ProductCatalogueService productCatalogueService;
    private ProductModelRepository productModelRepository;
    private ProductSpecificationItemRepository productSpecificationItemRepository;
    private TenderRepository tenderRepository;
    private AISpecificationIntelligenceService aiSpecificationIntelligenceService;
    private DocumentGeneratorService documentGeneratorService;

    private final Map<Long, ProductModel> modelStore = new HashMap<>();
    private final Map<Long, ProductSpecificationItem> specStore = new HashMap<>();
    private final Map<String, Tender> tenderStore = new HashMap<>();
    private long idSeq = 1000L;

    @BeforeEach
    void setUp() {
        modelStore.clear();
        specStore.clear();
        tenderStore.clear();

        productModelRepository = mock(ProductModelRepository.class);
        productSpecificationItemRepository = mock(ProductSpecificationItemRepository.class);
        tenderRepository = mock(TenderRepository.class);

        when(productModelRepository.save(any(ProductModel.class))).thenAnswer(inv -> {
            ProductModel model = inv.getArgument(0);
            if (model.getId() == null) {
                model.setId(idSeq++);
            }
            if (model.getSpecifications() != null) {
                for (ProductSpecificationItem item : model.getSpecifications()) {
                    if (item.getId() == null) {
                        item.setId(idSeq++);
                    }
                    item.setProductModel(model);
                    specStore.put(item.getId(), item);
                }
            }
            modelStore.put(model.getId(), model);
            return model;
        });

        when(productModelRepository.findById(anyLong())).thenAnswer(inv -> {
            Long id = inv.getArgument(0);
            return Optional.ofNullable(modelStore.get(id));
        });

        when(productModelRepository.findByModelNumber(anyString())).thenAnswer(inv -> {
            String mNo = inv.getArgument(0);
            return modelStore.values().stream()
                    .filter(m -> m.getModelNumber() != null && m.getModelNumber().equalsIgnoreCase(mNo))
                    .findFirst();
        });

        when(productModelRepository.findByStatus(anyString())).thenAnswer(inv -> {
            String status = inv.getArgument(0);
            return modelStore.values().stream()
                    .filter(m -> status.equalsIgnoreCase(m.getStatus()))
                    .collect(Collectors.toList());
        });

        when(productModelRepository.findAll()).thenAnswer(inv -> new ArrayList<>(modelStore.values()));

        doAnswer(inv -> {
            ProductModel model = inv.getArgument(0);
            if (model != null && model.getId() != null) {
                modelStore.remove(model.getId());
            }
            return null;
        }).when(productModelRepository).delete(any(ProductModel.class));

        when(productSpecificationItemRepository.saveAll(anyList())).thenAnswer(inv -> {
            List<ProductSpecificationItem> items = inv.getArgument(0);
            for (ProductSpecificationItem item : items) {
                if (item.getId() == null) {
                    item.setId(idSeq++);
                }
                specStore.put(item.getId(), item);
            }
            return items;
        });

        when(productSpecificationItemRepository.findByProductModelIdOrderByDisplayOrderAsc(anyLong())).thenAnswer(inv -> {
            Long modelId = inv.getArgument(0);
            return specStore.values().stream()
                    .filter(s -> s.getProductModel() != null && modelId.equals(s.getProductModel().getId()))
                    .sorted(Comparator.comparingInt(ProductSpecificationItem::getDisplayOrder))
                    .collect(Collectors.toList());
        });

        when(productSpecificationItemRepository.findByProductModelIdAndIsVerifiedTrueOrderByDisplayOrderAsc(anyLong())).thenAnswer(inv -> {
            Long modelId = inv.getArgument(0);
            return specStore.values().stream()
                    .filter(s -> s.getProductModel() != null && modelId.equals(s.getProductModel().getId()) && Boolean.TRUE.equals(s.getIsVerified()))
                    .sorted(Comparator.comparingInt(ProductSpecificationItem::getDisplayOrder))
                    .collect(Collectors.toList());
        });

        doAnswer(inv -> {
            Long modelId = inv.getArgument(0);
            specStore.entrySet().removeIf(e -> e.getValue().getProductModel() != null && modelId.equals(e.getValue().getProductModel().getId()));
            return null;
        }).when(productSpecificationItemRepository).deleteByProductModelId(anyLong());

        when(productModelRepository.existsById(anyLong())).thenAnswer(inv -> modelStore.containsKey(inv.getArgument(0)));

        doAnswer(inv -> {
            Long id = inv.getArgument(0);
            modelStore.remove(id);
            specStore.entrySet().removeIf(e -> e.getValue().getProductModel() != null && id.equals(e.getValue().getProductModel().getId()));
            return null;
        }).when(productModelRepository).deleteById(anyLong());

        when(tenderRepository.save(any(Tender.class))).thenAnswer(inv -> {
            Tender t = inv.getArgument(0);
            tenderStore.put(t.getId(), t);
            return t;
        });

        when(tenderRepository.findById(anyString())).thenAnswer(inv -> {
            String id = inv.getArgument(0);
            return Optional.ofNullable(tenderStore.get(id));
        });

        aiSpecificationIntelligenceService = new AISpecificationIntelligenceService();
        documentGeneratorService = new DocumentGeneratorService();
        productCatalogueService = new ProductCatalogueService(
                productModelRepository,
                productSpecificationItemRepository,
                tenderRepository,
                aiSpecificationIntelligenceService
        );
    }

    private byte[] createSampleDatasheetPdf(String title, Map<String, String> specsPage1, Map<String, String> specsPage2) throws Exception {
        try (PDDocument doc = new PDDocument()) {
            // Page 1
            PDPage page1 = new PDPage();
            doc.addPage(page1);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page1)) {
                cs.beginText();
                cs.setFont(PDType1Font.HELVETICA_BOLD, 14);
                cs.newLineAtOffset(50, 750);
                cs.showText(title + " - Manufacturer Technical Datasheet");
                cs.setFont(PDType1Font.HELVETICA, 11);
                cs.newLineAtOffset(0, -25);
                cs.showText("General Product Overview and Standard Specifications");

                int y = 700;
                for (var entry : specsPage1.entrySet()) {
                    cs.newLineAtOffset(0, -20);
                    cs.showText(entry.getKey() + " : " + entry.getValue());
                }
                cs.endText();
            }

            // Page 2
            if (specsPage2 != null && !specsPage2.isEmpty()) {
                PDPage page2 = new PDPage();
                doc.addPage(page2);
                try (PDPageContentStream cs = new PDPageContentStream(doc, page2)) {
                    cs.beginText();
                    cs.setFont(PDType1Font.HELVETICA_BOLD, 14);
                    cs.newLineAtOffset(50, 750);
                    cs.showText("Electrical, Environmental and Certification Specifications");
                    cs.setFont(PDType1Font.HELVETICA, 11);
                    cs.newLineAtOffset(0, -25);

                    for (var entry : specsPage2.entrySet()) {
                        cs.newLineAtOffset(0, -20);
                        cs.showText(entry.getKey() + " : " + entry.getValue());
                    }
                    cs.endText();
                }
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            doc.save(baos);
            return baos.toByteArray();
        }
    }

    @Test
    @DisplayName("1. File validation rejects empty, non-PDF, or corrupt files")
    void testDatasheetValidation_RejectsInvalidFiles() {
        // Empty file
        MockMultipartFile emptyFile = new MockMultipartFile("file", "datasheet.pdf", "application/pdf", new byte[0]);
        assertThrows(IllegalArgumentException.class, () ->
                productCatalogueService.uploadAndExtractDatasheet(emptyFile, "MOD-100", "MarkEn", "Light", "Desc", "tester"));

        // Non-PDF file
        MockMultipartFile textFile = new MockMultipartFile("file", "datasheet.txt", "text/plain", "Some text".getBytes());
        assertThrows(IllegalArgumentException.class, () ->
                productCatalogueService.uploadAndExtractDatasheet(textFile, "MOD-100", "MarkEn", "Light", "Desc", "tester"));

        // Fake PDF with corrupt header
        MockMultipartFile fakePdf = new MockMultipartFile("file", "fake.pdf", "application/pdf", "NOT_A_PDF_STREAM".getBytes());
        assertThrows(IllegalArgumentException.class, () ->
                productCatalogueService.uploadAndExtractDatasheet(fakePdf, "MOD-100", "MarkEn", "Light", "Desc", "tester"));
    }

    @Test
    @DisplayName("2. Upload datasheet extracts structured specifications with source page evidence")
    void testUploadAndExtraction_ExtractsSpecificationsWithEvidence() throws Exception {
        Map<String, String> page1Specs = new LinkedHashMap<>();
        page1Specs.put("Illumination Intensity", "160,000 Lux at 1 meter");
        page1Specs.put("Color Temperature", "4,500 K");
        page1Specs.put("Spot Diameter", "150 mm to 300 mm adjustable");

        Map<String, String> page2Specs = new LinkedHashMap<>();
        page2Specs.put("Power Supply", "100-240 V AC, 50/60 Hz");
        page2Specs.put("Battery Backup", "3.5 Hours continuous operation");
        page2Specs.put("Certification", "CE ISO 13485 Certified");

        byte[] pdfBytes = createSampleDatasheetPdf("ME-OTL-200", page1Specs, page2Specs);
        MockMultipartFile file = new MockMultipartFile("file", "datasheet_me_otl_200.pdf", "application/pdf", pdfBytes);

        ProductModelDto model = productCatalogueService.uploadAndExtractDatasheet(
                file, "ME-OTL-200", "MarkEn", "Operation Theatre Light", "High-intensity surgical light", "tester");

        assertNotNull(model.getId());
        assertEquals("ME-OTL-200", model.getModelNumber());
        assertEquals("MarkEn", model.getMake());
        assertEquals("Operation Theatre Light", model.getProductCategory());
        assertEquals("EXTRACTED", model.getStatus());
        assertTrue(model.getTotalSpecs() >= 6, "Should extract at least 6 parameters");

        // Verify that initially isVerified is false (review gate)
        assertEquals(0, model.getVerifiedSpecs(), "Initially 0 specifications should be verified before human review");

        // Verify file stored on disk
        Path path = Paths.get("public/documents/datasheets/ME-OTL-200/datasheet.pdf");
        assertTrue(Files.exists(path), "Datasheet PDF must be saved on disk");
    }

    @Test
    @DisplayName("3. Review and verification workflow allows editing and marking verified")
    void testReviewAndVerificationWorkflow() throws Exception {
        Map<String, String> page1Specs = Map.of("Illumination Intensity", "160,000 Lux");
        byte[] pdfBytes = createSampleDatasheetPdf("ME-BED-400", page1Specs, Collections.emptyMap());
        MockMultipartFile file = new MockMultipartFile("file", "datasheet.pdf", "application/pdf", pdfBytes);

        ProductModelDto model = productCatalogueService.uploadAndExtractDatasheet(
                file, "ME-BED-400", "MarkEn", "ICU Bed", "Electric bed", "tester");

        // Edit specs (add a missing parameter)
        List<ProductSpecificationDto> specs = new ArrayList<>(model.getSpecifications());
        specs.add(new ProductSpecificationDto(null, "Safe Working Load", "250 kg", "Page 1", "Safe Working Load : 250 kg", false, specs.size() + 1));
        int targetCount = specs.size();

        ProductModelDto updated = productCatalogueService.updateSpecifications(model.getId(), specs, "reviewer");
        assertEquals(targetCount, updated.getTotalSpecs());

        // Verify model
        ProductModelDto verified = productCatalogueService.verifyModel(model.getId(), null, "authorized_reviewer");
        assertEquals("VERIFIED", verified.getStatus());
        assertEquals("authorized_reviewer", verified.getVerifiedBy());
        assertNotNull(verified.getVerifiedAt());
        assertEquals(targetCount, verified.getVerifiedSpecs());
    }

    @Test
    @DisplayName("4. Tender model association supports single model and multi-schedule mapping")
    void testTenderModelAssociation() {
        String tenderId = "TEST-TENDER-CAT-1";
        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setRefNo("GEM/2026/B/TEST-1");
        tender.setTitle("Supply of Hospital Furniture and Lights");
        tender.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/TEST-1");
        tender.setScrapedAt("2026-10-21T00:00:00");
        tenderRepository.save(tender);

        Map<String, Long> scheduleMap = new LinkedHashMap<>();
        scheduleMap.put("Schedule 1", 101L);
        scheduleMap.put("Schedule 2", 102L);

        productCatalogueService.assignTenderModels(tenderId, 101L, scheduleMap, "admin");

        Map<String, Object> selection = productCatalogueService.getTenderModelSelection(tenderId);
        assertEquals(101L, selection.get("selected_model_id"));
        Map<?, ?> savedMap = (Map<?, ?>) selection.get("schedule_models");
        assertEquals(101, ((Number) savedMap.get("Schedule 1")).intValue());
        assertEquals(102, ((Number) savedMap.get("Schedule 2")).intValue());
    }

    @Test
    @DisplayName("5. Matching tender clauses strictly populates Column 4 from verified evidence only and flags unsupported clauses")
    void testEvidenceMatching_StrictEvidenceAndColumn4Integrity() throws Exception {
        // 1. Setup a verified product model in database
        Map<String, String> p1 = new LinkedHashMap<>();
        p1.put("Illumination Intensity", "160,000 Lux at 1 meter");
        p1.put("Color Temperature", "4,500 K");
        p1.put("Spot Diameter", "150 mm to 300 mm");
        byte[] pdfBytes = createSampleDatasheetPdf("ME-OTL-SURGICAL", p1, Collections.emptyMap());
        MockMultipartFile file = new MockMultipartFile("file", "datasheet.pdf", "application/pdf", pdfBytes);

        ProductModelDto modelDto = productCatalogueService.uploadAndExtractDatasheet(
                file, "ME-OTL-SURGICAL", "MarkEn", "Operation Theatre Light", "Surgical LED light", "tester");
        productCatalogueService.verifyModel(modelDto.getId(), null, "spec_manager");

        // 2. Setup a test tender associated with this model
        String tenderId = "TEST-TENDER-EVIDENCE-MATCH";
        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setRefNo("GEM/2026/B/999888");
        tender.setTitle("Procurement of Surgical Operating Lights");
        tender.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/999888");
        tender.setScrapedAt("2026-10-21T00:00:00");
        tender.setSelectedModelId(modelDto.getId());
        tenderRepository.save(tender);

        // 3. Define 3 tender clauses: 2 supported by datasheet, 1 unsupported buyer requirement
        List<String[]> inputClauses = new ArrayList<>();
        // Clause 0: Supported by verified spec (Illumination)
        inputClauses.add(new String[]{"1", "The surgical operating light shall provide a central illuminance of minimum 150,000 Lux at 1m.", "", "", "", "Operation Theatre Light", "-", "PDF p. 1", "requirement", "", "", "Schedule 1"});
        // Clause 1: Supported by verified spec (Color Temperature)
        inputClauses.add(new String[]{"2", "Color temperature shall be in the range of 4000K to 5000K.", "", "", "", "Operation Theatre Light", "-", "PDF p. 1", "requirement", "", "", "Schedule 1"});
        // Clause 2: Unsupported by datasheet (No evidence exists for wireless 4K video camera)
        inputClauses.add(new String[]{"3", "Integrated full HD wireless surgical camera with 30x optical zoom must be included.", "", "", "", "Operation Theatre Light", "-", "PDF p. 2", "requirement", "", "", "Schedule 1"});

        // 4. Run matching
        List<String[]> matched = productCatalogueService.matchTenderClausesWithEvidence(tender, inputClauses);

        // 5. Assert Clause 0 (Matched)
        String[] clause0 = matched.get(0);
        assertTrue(clause0[2].contains("160,000 Lux"), "Column 4 MUST contain verified offered specification");
        assertTrue(clause0[2].contains("ME-OTL-SURGICAL") || clause0[2].contains("Page 1"), "Column 4 MUST cite the authoritative evidence source");
        assertEquals("Complied", clause0[3], "Column 3 must reflect compliance");
        assertEquals("None", clause0[4], "Column 5 must indicate no deviations");

        // 6. Assert Clause 1 (Matched)
        String[] clause1 = matched.get(1);
        assertTrue(clause1[2].contains("4,500 K"), "Column 4 MUST contain verified color temperature");
        assertEquals("Complied", clause1[3]);

        // 7. Assert Clause 2 (Unsupported Evidence) - STRICT SAFETY RULE
        String[] clause2 = matched.get(2);
        assertEquals("", clause2[2], "Column 4 MUST BE EMPTY when evidence is not found; no fabrication allowed");
        assertEquals("", clause2[3], "Compliance must NOT be claimed without evidence");
        assertTrue(clause2[4].contains("No datasheet evidence found"), "Column 5 MUST flag unsupported clause for review");
    }

    @Test
    @DisplayName("6. Multi-schedule tender routes distinct product models to respective schedules")
    void testMultiScheduleRouting() throws Exception {
        // Model 1: Light
        byte[] pdf1 = createSampleDatasheetPdf("MODEL-LIGHT-A", Map.of("Illumination", "140,000 Lux"), null);
        ProductModelDto model1 = productCatalogueService.uploadAndExtractDatasheet(new MockMultipartFile("f1.pdf", "f1.pdf", "application/pdf", pdf1), "MODEL-LIGHT-A", "MarkEn", "Light", "", "test");
        productCatalogueService.verifyModel(model1.getId(), null, "reviewer");

        // Model 2: Table
        byte[] pdf2 = createSampleDatasheetPdf("MODEL-TABLE-B", Map.of("Table Load Capacity", "300 kg"), null);
        ProductModelDto model2 = productCatalogueService.uploadAndExtractDatasheet(new MockMultipartFile("f2.pdf", "f2.pdf", "application/pdf", pdf2), "MODEL-TABLE-B", "MarkEn", "Table", "", "test");
        productCatalogueService.verifyModel(model2.getId(), null, "reviewer");

        String tenderId = "TEST-MULTI-SCHED-TENDER";
        Tender tender = new Tender();
        tender.setId(tenderId);
        tender.setRefNo("GEM/MULTI/1");
        tender.setTitle("Multi-schedule Medical Procurement");
        tender.setOriginalUrl("https://bidplus.gem.gov.in/showbidDocument/MULTI1");
        tender.setScrapedAt("2026-10-21T00:00:00");
        tenderRepository.save(tender);
        productCatalogueService.assignTenderModels(tenderId, null, Map.of("Schedule 1", model1.getId(), "Schedule 2", model2.getId()), "admin");
        tender = tenderRepository.findById(tenderId).orElse(tender);

        List<String[]> clauses = new ArrayList<>();
        clauses.add(new String[]{"1", "Central illumination minimum 130,000 Lux", "", "", "", "Light", "-", "p. 1", "requirement", "", "", "Schedule 1"});
        clauses.add(new String[]{"2", "Operating table load capacity 250 kg minimum", "", "", "", "Table", "-", "p. 2", "requirement", "", "", "Schedule 2"});

        List<String[]> matched = productCatalogueService.matchTenderClausesWithEvidence(tender, clauses);

        // Schedule 1 matched to Model 1
        assertTrue(matched.get(0)[2].contains("140,000 Lux"));
        assertTrue(matched.get(0)[2].contains("MODEL-LIGHT-A"));

        // Schedule 2 matched to Model 2
        assertTrue(matched.get(1)[2].contains("300 kg"));
        assertTrue(matched.get(1)[2].contains("MODEL-TABLE-B"));
    }

    @Test
    @DisplayName("7. PDF and DOCX renderers correctly include Column 4 offered specifications and citations")
    void testDocumentGeneration_PdfAndDocxIntegration() throws Exception {
        List<String[]> matchedClauses = new ArrayList<>();
        matchedClauses.add(new String[]{"1", "Operating light illuminance minimum 140,000 Lux", "160,000 Lux (Source: ME-OTL-200 [Page 1])", "Complied", "None", "Operation Theatre Light", "-", "p. 1", "requirement", "", "", "Schedule 1"});
        matchedClauses.add(new String[]{"2", "Battery backup 3 hours", "3.5 Hours continuous (Source: ME-OTL-200 [Page 2])", "Complied", "None", "Operation Theatre Light", "-", "p. 2", "requirement", "", "", "Schedule 1"});
        matchedClauses.add(new String[]{"3", "Integrated camera zoom 40x", "", "", "No datasheet evidence found; manual verification required.", "Operation Theatre Light", "-", "p. 3", "requirement", "", "", "Schedule 1"});

        List<SpecificationSheetContent.Product> sheets = SpecificationSheetContent.fromSourceRequirements(matchedClauses);
        assertEquals(1, sheets.size());
        SpecificationSheetContent.Product product = sheets.get(0);
        assertEquals(3, product.rows().size());

        // Verify Row content
        assertEquals("160,000 Lux (Source: ME-OTL-200 [Page 1])", product.rows().get(0).offeredSpecification());
        assertEquals("Complied", product.rows().get(0).compliance());
        assertEquals("None", product.rows().get(0).deviations());

        assertEquals("", product.rows().get(2).offeredSpecification());
        assertEquals("", product.rows().get(2).compliance());
        assertEquals("No datasheet evidence found; manual verification required.", product.rows().get(2).deviations());

        Map<String, String> data = new HashMap<>();
        data.put("bidNumber", "GEM/2026/B/TEST-DOC-GEN");
        data.put("productName", "Operation Theatre Light");
        data.put("offeredModel", "ME-OTL-200");
        data.put("companyName", "Mark Enterprises");
        data.put("companyAddress", "MIDC Satpur, Nashik - 422007");
        data.put("signatoryName", "Shreedhar Shingare");
        data.put("signatoryDesignation", "Authorized Signatory");

        // 1. Generate Combined PDF
        byte[] pdfBytes = documentGeneratorService.generateCombinedSheetPdf(data, sheets);
        assertNotNull(pdfBytes);
        assertTrue(pdfBytes.length > 1000);

        try (PDDocument doc = PDDocument.load(pdfBytes)) {
            assertEquals(1, doc.getNumberOfPages());
            PDPage page = doc.getPage(0);
            assertEquals(595.28f, page.getMediaBox().getWidth(), 1.0f, "Width must be A4 portrait");
            assertEquals(841.88f, page.getMediaBox().getHeight(), 1.0f, "Height must be A4 portrait");
        }

        // 2. Generate Combined DOCX
        byte[] docxBytes = documentGeneratorService.generateCombinedSheetDocx(data, sheets);
        assertNotNull(docxBytes);
        assertTrue(docxBytes.length > 1000);

        try (XWPFDocument docx = new XWPFDocument(new ByteArrayInputStream(docxBytes))) {
            List<XWPFTable> tables = docx.getTables();
            assertFalse(tables.isEmpty());
            XWPFTable table = tables.get(0);
            // Header row should have 5 columns
            XWPFTableRow headerRow = table.getRow(0);
            assertEquals(5, headerRow.getTableCells().size());

            // In combined mode:
            // Row 0: Table Header (Sr No, Spec, Compliance, Offered, Deviations)
            // Row 1: Product Heading ("Operation Theatre Light" - single cell merged across 5 columns)
            // Row 2: Clause 1 (160,000 Lux)
            // Row 3: Clause 2 (3.5 Hours)
            // Row 4: Clause 3 (Unsupported)
            XWPFTableRow dataRow1 = table.getRow(2);
            assertTrue(dataRow1.getCell(3).getText().contains("160,000 Lux"), "DOCX Column 4 must contain verified offered specification");
            assertTrue(dataRow1.getCell(2).getText().contains("Complied"), "DOCX Column 3 must contain compliance");

            // Fourth row (third clause: unsupported) should have empty cell 3
            XWPFTableRow dataRow3 = table.getRow(4);
            assertEquals("", dataRow3.getCell(3).getText().trim(), "DOCX Column 4 must be blank for unsupported clause");
        }
    }
}
