package com.tenderpocket.services;

import com.tenderpocket.controllers.TenderController;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.ActivityLogRepository;
import com.tenderpocket.repositories.TenderRepository;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.SimpleDateFormat;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

public class ExcelSpecificationUploadTest {

    @TempDir
    Path tempUploadDir;

    private TenderController controller;
    private TenderRepository tenderRepository;
    private ActivityLogRepository activityLogRepository;
    private DocumentGeneratorService documentGeneratorService;
    private ComplianceProgressService complianceProgressService;

    @BeforeEach
    void setUp() {
        var auth = new UsernamePasswordAuthenticationToken(
                "executive", null, List.of(new SimpleGrantedAuthority("ROLE_TENDER_EXECUTIVE")));
        SecurityContextHolder.getContext().setAuthentication(auth);

        controller = new TenderController();
        tenderRepository = mock(TenderRepository.class);
        activityLogRepository = mock(ActivityLogRepository.class);
        complianceProgressService = new ComplianceProgressService();
        documentGeneratorService = new DocumentGeneratorService();

        ReflectionTestUtils.setField(controller, "tenderRepository", tenderRepository);
        ReflectionTestUtils.setField(controller, "activityLogRepository", activityLogRepository);
        ReflectionTestUtils.setField(controller, "complianceProgressService", complianceProgressService);
        ReflectionTestUtils.setField(controller, "documentGeneratorService", documentGeneratorService);
        ReflectionTestUtils.setField(controller, "uploadDir", tempUploadDir.toString());
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private Tender createMockTender(String id, String title) {
        Tender tender = new Tender();
        tender.setId(id);
        tender.setTitle(title);
        tender.setRefNo("GEM/" + id);
        tender.setStatus("New");
        tender.setDownloadedDocs("[]");
        when(tenderRepository.findById(id)).thenReturn(Optional.of(tender));
        return tender;
    }

    private byte[] createSyntheticXlsx(Map<String, List<List<Object>>> sheets) throws IOException {
        try (Workbook wb = new XSSFWorkbook(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            populateWorkbook(wb, sheets);
            wb.write(baos);
            return baos.toByteArray();
        }
    }

    private byte[] createSyntheticXls(Map<String, List<List<Object>>> sheets) throws IOException {
        try (Workbook wb = new HSSFWorkbook(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            populateWorkbook(wb, sheets);
            wb.write(baos);
            return baos.toByteArray();
        }
    }

    private void populateWorkbook(Workbook wb, Map<String, List<List<Object>>> sheets) {
        DataFormat format = wb.createDataFormat();
        CellStyle dateStyle = wb.createCellStyle();
        dateStyle.setDataFormat(format.getFormat("yyyy-mm-dd"));

        for (Map.Entry<String, List<List<Object>>> entry : sheets.entrySet()) {
            Sheet sheet = wb.createSheet(entry.getKey());
            int rowIdx = 0;
            for (List<Object> rowData : entry.getValue()) {
                Row row = sheet.createRow(rowIdx++);
                int colIdx = 0;
                for (Object val : rowData) {
                    Cell cell = row.createCell(colIdx++);
                    if (val == null) {
                        cell.setBlank();
                    } else if (val instanceof String s) {
                        cell.setCellValue(s);
                    } else if (val instanceof Number n) {
                        cell.setCellValue(n.doubleValue());
                    } else if (val instanceof Boolean b) {
                        cell.setCellValue(b);
                    } else if (val instanceof Date d) {
                        cell.setCellValue(d);
                        cell.setCellStyle(dateStyle);
                    }
                }
            }
        }
    }

    @Test
    void validXlsxUploadSucceedsAndGeneratesSpecifications() throws Exception {
        String id = "test-xlsx-upload-" + UUID.randomUUID();
        Tender tender = createMockTender(id, "Medical Imaging System");

        Map<String, List<List<Object>>> sheets = new LinkedHashMap<>();
        sheets.put("Sheet1", List.of(
                List.of("Parameter", "Technical Specification"),
                List.of("1", "Display Size", "24 inch High Resolution Medical Grade Monitor"),
                List.of("2", "Resolution", "1920 x 1080 pixels minimum"),
                List.of("3", "Operating Voltage", "220-240V AC, 50Hz single phase"),
                List.of("4", "Battery Backup", "Minimum 2 hours internal battery backup")
        ));
        byte[] bytes = createSyntheticXlsx(sheets);

        MockMultipartFile file = new MockMultipartFile("file", "technical_specs.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                "Model-X", null, "MarkEn", "1", "Medical Imaging System");

        assertEquals(200, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(true, body.get("success"));
        assertEquals(true, body.get("generated"));
        assertTrue((int) body.get("clauseCount") >= 4);

        assertNotNull(body.get("pdfDownloadUrl"));
        assertNotNull(body.get("docxDownloadUrl"));
        assertNotNull(body.get("xlsxDownloadUrl"));

        // Verify saved document is specification.xlsx
        Path savedFile = tempUploadDir.resolve(id).resolve("specification.xlsx");
        assertTrue(Files.exists(savedFile), "Uploaded file should be saved as specification.xlsx");
        assertEquals(bytes.length, Files.size(savedFile));
    }

    @Test
    void validXlsUploadSucceedsAndGeneratesSpecifications() throws Exception {
        String id = "test-xls-upload-" + UUID.randomUUID();
        Tender tender = createMockTender(id, "Laboratory Centrifuge");

        Map<String, List<List<Object>>> sheets = new LinkedHashMap<>();
        sheets.put("Specifications", List.of(
                List.of("Sr No", "Requirement Description"),
                List.of("1", "Maximum Speed: 15,000 RPM with digital display"),
                List.of("2", "Rotor Capacity: 24 x 1.5/2.0 ml microtubes"),
                List.of("3", "Refrigeration: Temperature range -10C to +40C"),
                List.of("4", "Safety Lid Lock: Dual safety lock mechanism")
        ));
        byte[] bytes = createSyntheticXls(sheets);

        MockMultipartFile file = new MockMultipartFile("file", "specs.xls",
                "application/vnd.ms-excel", bytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                "Lab-Centrifuge-15k", null, "MarkEn", "1", "Laboratory Centrifuge");

        assertEquals(200, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(true, body.get("success"));
        assertEquals(true, body.get("generated"));
        assertTrue((int) body.get("clauseCount") >= 4);

        Path savedFile = tempUploadDir.resolve(id).resolve("specification.xls");
        assertTrue(Files.exists(savedFile), "Uploaded file should be saved as specification.xls");
    }

    @Test
    void multiWorksheetWorkbookCreatesMultipleProductsAndSchedules() throws Exception {
        String id = "test-multisheet-" + UUID.randomUUID();
        Tender tender = createMockTender(id, "ICU Monitoring Station");

        Map<String, List<List<Object>>> sheets = new LinkedHashMap<>();
        sheets.put("Patient Monitor", List.of(
                List.of("1", "Screen: 15.6 inch TFT touch screen display"),
                List.of("2", "Parameters: ECG, SpO2, NIBP, Respiration, Temperature"),
                List.of("3", "Battery: Lithium-ion backup for 4 hours")
        ));
        sheets.put("Defibrillator", List.of(
                List.of("1", "Type: Biphasic manual and AED modes"),
                List.of("2", "Energy selection: 1 to 200 Joules"),
                List.of("3", "Pacing: Non-invasive transcutaneous pacing")
        ));
        byte[] bytes = createSyntheticXlsx(sheets);

        MockMultipartFile file = new MockMultipartFile("file", "multiproduct.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, "MarkEn", null, "ICU Station");

        assertEquals(200, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(true, body.get("success"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> products = (List<Map<String, Object>>) body.get("products");
        assertNotNull(products);
        assertEquals(2, products.size(), "Should have created 2 products from the 2 worksheets");

        assertEquals("Patient Monitor", products.get(0).get("productName"));
        assertEquals("1", products.get(0).get("scheduleNumber"));
        assertEquals("Defibrillator", products.get(1).get("productName"));
        assertEquals("2", products.get(1).get("scheduleNumber"));
    }

    @Test
    void numericDateUnicodeAndBlankCellHandling() throws Exception {
        String id = "test-data-types-" + UUID.randomUUID();
        createMockTender(id, "Precision Equipment");

        Date testDate = new SimpleDateFormat("yyyy-MM-dd").parse("2026-10-18");

        Map<String, List<List<Object>>> sheets = new LinkedHashMap<>();
        sheets.put("DataTypes", List.of(
                List.of("Header 1", "Header 2", "Header 3"),
                Arrays.asList(null, null, null), // Blank row
                List.of("Integer Test", 12500, "Units"),
                List.of("Decimal Test", 42.75, "Kg"),
                List.of("Date Test", testDate, "Effective"),
                List.of("Unicode Test", "तापमान नियंत्रण സെൻസർ", "45°C ± 0.5°C"),
                List.of("Boolean Test", true, "Active")
        ));
        byte[] bytes = createSyntheticXlsx(sheets);

        MockMultipartFile file = new MockMultipartFile("file", "datatypes.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Precision Equipment");

        assertEquals(200, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(true, body.get("success"));
        assertTrue((int) body.get("clauseCount") >= 5);
    }

    @Test
    void formulaCellsSafelyExtractedFromCachedValues() throws Exception {
        byte[] bytes;
        try (Workbook wb = new XSSFWorkbook(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("FormulaTest");
            Row r0 = sheet.createRow(0);
            r0.createCell(0).setCellValue("Voltage Rating");
            Cell formulaCell = r0.createCell(1);
            formulaCell.setCellFormula("220+20");
            formulaCell.setCellValue(240.0); // Set cached formula value

            Row r1 = sheet.createRow(1);
            r1.createCell(0).setCellValue("Frequency");
            r1.createCell(1).setCellValue("50Hz");

            wb.write(baos);
            bytes = baos.toByteArray();
        }

        String id = "test-formula-" + UUID.randomUUID();
        createMockTender(id, "Electrical Apparatus");

        MockMultipartFile file = new MockMultipartFile("file", "formula.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Electrical Apparatus");

        assertEquals(200, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(true, body.get("success"));
        assertTrue((int) body.get("clauseCount") >= 2);
    }

    @Test
    void emptyWorkbookRejectedWithClearError() throws Exception {
        byte[] bytes;
        try (Workbook wb = new XSSFWorkbook(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            wb.createSheet("EmptySheet");
            wb.write(baos);
            bytes = baos.toByteArray();
        }

        String id = "test-empty-" + UUID.randomUUID();
        createMockTender(id, "Empty Workbook");

        MockMultipartFile file = new MockMultipartFile("file", "empty.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Empty Workbook");

        assertEquals(400, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(false, body.get("success"));
        assertTrue(body.get("error").toString().contains("no usable data"));
    }

    @Test
    void malformedExcelWorkbookRejected() {
        String id = "test-malformed-" + UUID.randomUUID();
        createMockTender(id, "Corrupt File");

        byte[] fakeBytes = new byte[]{0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x12, 0x34}; // Corrupt ZIP
        MockMultipartFile file = new MockMultipartFile("file", "corrupt.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fakeBytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Corrupt File");

        assertEquals(400, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(false, body.get("success"));
    }

    @Test
    void nonExcelFileRenamedWithExcelExtensionRejectedByMagicBytes() {
        String id = "test-renamed-" + UUID.randomUUID();
        createMockTender(id, "Renamed File");

        byte[] textBytes = "This is a plain text file pretending to be excel.".getBytes();
        MockMultipartFile file = new MockMultipartFile("file", "fake.xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", textBytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Renamed File");

        assertEquals(400, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(false, body.get("success"));
        assertTrue(body.get("error").toString().contains("genuine .xlsx or .xls file"));
    }

    @Test
    void excelWorkbookRenamedToTxtRejected() throws Exception {
        String id = "test-renamed-txt-" + UUID.randomUUID();
        createMockTender(id, "Excel as TXT");

        Map<String, List<List<Object>>> sheets = Map.of("Sheet1", List.of(List.of("A", "B")));
        byte[] bytes = createSyntheticXlsx(sheets);

        MockMultipartFile file = new MockMultipartFile("file", "hidden_excel.txt",
                "text/plain", bytes);

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Excel as TXT");

        assertEquals(400, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(false, body.get("success"));
        assertTrue(body.get("error").toString().contains("Excel workbook renamed with a .txt extension"));
    }

    @Test
    void unsupportedFileExtensionRejected() {
        String id = "test-unsupported-" + UUID.randomUUID();
        createMockTender(id, "Unsupported CSV");

        MockMultipartFile file = new MockMultipartFile("file", "data.csv",
                "text/csv", "col1,col2\nval1,val2".getBytes());

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Unsupported CSV");

        assertEquals(400, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(false, body.get("success"));
        assertTrue(body.get("error").toString().contains("Supported formats are PDF, DOCX, TXT, XLSX, and XLS."));
    }

    @Test
    void regressionTxtUploadSucceeds() {
        String id = "test-txt-upload-" + UUID.randomUUID();
        createMockTender(id, "Text Tender");

        String textContent = "Parameter: Operating Temperature - 10C to 40C\n"
                + "Parameter: Relative Humidity - Up to 90% non-condensing\n"
                + "Parameter: Power Input - 100-240V AC 50/60Hz\n";
        MockMultipartFile file = new MockMultipartFile("file", "specs.txt",
                "text/plain", textContent.getBytes());

        ResponseEntity<?> response = controller.uploadTechSpec(
                "Tender Executive", "executive", id, file,
                null, null, null, null, "Text Tender");

        assertEquals(200, response.getStatusCode().value());
        Map<?, ?> body = (Map<?, ?>) response.getBody();
        assertNotNull(body);
        assertEquals(true, body.get("success"));
        assertTrue((int) body.get("clauseCount") >= 3);
    }
}
