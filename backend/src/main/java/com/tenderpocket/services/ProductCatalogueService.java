package com.tenderpocket.services;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tenderpocket.dto.ClauseMatchResultDto;
import com.tenderpocket.dto.ProductModelDto;
import com.tenderpocket.dto.ProductSpecificationDto;
import com.tenderpocket.models.ProductModel;
import com.tenderpocket.models.ProductSpecificationItem;
import com.tenderpocket.models.Tender;
import com.tenderpocket.repositories.ProductModelRepository;
import com.tenderpocket.repositories.ProductSpecificationItemRepository;
import com.tenderpocket.repositories.TenderRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ProductCatalogueService {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024L; // 50MB

    @Value("${file.upload-dir:public/documents}")
    private String uploadDir = "public/documents";

    @Autowired
    private ProductModelRepository productModelRepository;

    @Autowired
    private ProductSpecificationItemRepository productSpecificationItemRepository;

    @Autowired
    private TenderRepository tenderRepository;

    @Autowired
    private AISpecificationIntelligenceService aiSpecificationIntelligenceService;

    public ProductCatalogueService() {}

    public ProductCatalogueService(ProductModelRepository productModelRepository,
                                   ProductSpecificationItemRepository productSpecificationItemRepository,
                                   TenderRepository tenderRepository,
                                   AISpecificationIntelligenceService aiSpecificationIntelligenceService) {
        this.productModelRepository = productModelRepository;
        this.productSpecificationItemRepository = productSpecificationItemRepository;
        this.tenderRepository = tenderRepository;
        this.aiSpecificationIntelligenceService = aiSpecificationIntelligenceService;
        this.uploadDir = "public/documents";
    }

    public void setUploadDir(String uploadDir) {
        this.uploadDir = uploadDir;
    }

    @Transactional
    public ProductModelDto uploadAndExtractDatasheet(
            MultipartFile file, String modelNumber, String make,
            String productCategory, String description, String username) throws Exception {

        if (modelNumber == null || modelNumber.trim().isEmpty()) {
            throw new IllegalArgumentException("Model number is required");
        }
        if (productCategory == null || productCategory.trim().isEmpty()) {
            throw new IllegalArgumentException("Product category is required");
        }
        validateDatasheetFile(file);

        String cleanModel = modelNumber.trim();
        String cleanMake = (make != null && !make.trim().isEmpty()) ? make.trim() : "MarkEn";
        String cleanCategory = productCategory.trim();
        String originalFilename = file.getOriginalFilename() != null ? file.getOriginalFilename() : "datasheet.pdf";

        // 1. Save PDF file
        String safeModelFolder = cleanModel.replaceAll("[^A-Za-z0-9._-]+", "_");
        Path modelDir = Paths.get(uploadDir, "datasheets", safeModelFolder);
        Files.createDirectories(modelDir);
        Path targetPath = modelDir.resolve("datasheet.pdf");

        byte[] pdfBytes = file.getBytes();
        Files.write(targetPath, pdfBytes);
        String relativeDownloadPath = "/documents/datasheets/" + safeModelFolder + "/datasheet.pdf";

        // 2. Persist or Update ProductModel
        String nowStr = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        Optional<ProductModel> existingOpt = productModelRepository.findByModelNumber(cleanModel);
        ProductModel model = existingOpt.orElseGet(() -> new ProductModel(cleanModel, cleanMake, cleanCategory, description));
        model.setMake(cleanMake);
        model.setProductCategory(cleanCategory);
        if (description != null) model.setDescription(description.trim());
        model.setDatasheetPath(relativeDownloadPath);
        model.setDatasheetOriginalFilename(originalFilename);
        model.setUpdatedAt(nowStr);
        if (model.getCreatedAt() == null) model.setCreatedAt(nowStr);
        model.setStatus("EXTRACTING");
        model = productModelRepository.save(model);

        // Clear existing specs if re-uploading
        productSpecificationItemRepository.deleteByProductModelId(model.getId());

        // 3. Extract specifications using AI Specification Intelligence (with deterministic fallback)
        List<ProductSpecificationDto> extracted = aiSpecificationIntelligenceService.extractDatasheetSpecifications(
                pdfBytes, originalFilename, cleanMake, cleanModel, cleanCategory);

        List<ProductSpecificationItem> itemsToSave = new ArrayList<>();
        int order = 0;
        for (ProductSpecificationDto dto : extracted) {
            ProductSpecificationItem item = new ProductSpecificationItem(
                    model, dto.getParameterName(), dto.getParameterValue(),
                    dto.getSourcePage(), dto.getRawEvidence(), false, ++order);
            itemsToSave.add(item);
        }
        if (!itemsToSave.isEmpty()) {
            productSpecificationItemRepository.saveAll(itemsToSave);
            model.setStatus("EXTRACTED");
        } else {
            model.setStatus("DRAFT");
        }
        model = productModelRepository.save(model);

        return toDto(model, itemsToSave);
    }

    private void validateDatasheetFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Datasheet file must not be empty");
        }
        if (file.getSize() > MAX_FILE_SIZE_BYTES) {
            throw new IllegalArgumentException("Datasheet file exceeds 50MB limit");
        }
        String filename = file.getOriginalFilename();
        if (filename != null && !filename.toLowerCase().endsWith(".pdf")) {
            throw new IllegalArgumentException("Datasheet must be a PDF file");
        }
        try (InputStream is = file.getInputStream()) {
            byte[] header = new byte[4];
            int read = is.read(header);
            if (read < 4 || header[0] != '%' || header[1] != 'P' || header[2] != 'D' || header[3] != 'F') {
                throw new IllegalArgumentException("Invalid file format: file is not a valid PDF");
            }
        } catch (Exception e) {
            if (e instanceof IllegalArgumentException) throw (IllegalArgumentException) e;
            throw new IllegalArgumentException("Could not read uploaded datasheet: " + e.getMessage());
        }
    }

    public List<ProductModelDto> listModels(String category, String status) {
        List<ProductModel> list;
        if (category != null && !category.trim().isEmpty()) {
            list = productModelRepository.findByProductCategoryIgnoreCase(category.trim());
        } else if (status != null && !status.trim().isEmpty()) {
            list = productModelRepository.findByStatus(status.trim());
        } else {
            list = productModelRepository.findAll();
        }

        return list.stream().map(m -> {
            List<ProductSpecificationItem> specs = productSpecificationItemRepository.findByProductModelIdOrderByDisplayOrderAsc(m.getId());
            return toDto(m, specs);
        }).collect(Collectors.toList());
    }

    public Optional<ProductModelDto> getModel(Long id) {
        return productModelRepository.findById(id).map(m -> {
            List<ProductSpecificationItem> specs = productSpecificationItemRepository.findByProductModelIdOrderByDisplayOrderAsc(m.getId());
            return toDto(m, specs);
        });
    }

    @Transactional
    public ProductModelDto updateSpecifications(Long modelId, List<ProductSpecificationDto> newSpecs, String username) {
        ProductModel model = productModelRepository.findById(modelId)
                .orElseThrow(() -> new IllegalArgumentException("Product model not found with ID: " + modelId));

        productSpecificationItemRepository.deleteByProductModelId(modelId);

        List<ProductSpecificationItem> itemsToSave = new ArrayList<>();
        int order = 0;
        if (newSpecs != null) {
            for (ProductSpecificationDto dto : newSpecs) {
                if (dto.getParameterName() == null || dto.getParameterName().trim().isEmpty()) continue;
                if (dto.getParameterValue() == null || dto.getParameterValue().trim().isEmpty()) continue;

                ProductSpecificationItem item = new ProductSpecificationItem(
                        model, dto.getParameterName().trim(), dto.getParameterValue().trim(),
                        dto.getSourcePage(), dto.getRawEvidence(),
                        dto.getIsVerified() != null ? dto.getIsVerified() : false, ++order);
                itemsToSave.add(item);
            }
        }

        List<ProductSpecificationItem> saved = productSpecificationItemRepository.saveAll(itemsToSave);
        String nowStr = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        model.setUpdatedAt(nowStr);
        model = productModelRepository.save(model);

        return toDto(model, saved);
    }

    @Transactional
    public ProductModelDto verifyModel(Long modelId, List<Long> itemIdsToVerify, String username) {
        ProductModel model = productModelRepository.findById(modelId)
                .orElseThrow(() -> new IllegalArgumentException("Product model not found with ID: " + modelId));

        List<ProductSpecificationItem> items = productSpecificationItemRepository.findByProductModelIdOrderByDisplayOrderAsc(modelId);
        Set<Long> verifySet = (itemIdsToVerify != null && !itemIdsToVerify.isEmpty())
                ? new HashSet<>(itemIdsToVerify) : null;

        for (ProductSpecificationItem item : items) {
            if (verifySet == null || verifySet.contains(item.getId())) {
                item.setIsVerified(true);
            }
        }
        productSpecificationItemRepository.saveAll(items);

        long verifiedCount = items.stream().filter(ProductSpecificationItem::getIsVerified).count();
        String nowStr = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        if (verifiedCount > 0) {
            model.setStatus("VERIFIED");
            model.setVerifiedBy(username != null ? username : "Authorized Spec Reviewer");
            model.setVerifiedAt(nowStr);
        }
        model.setUpdatedAt(nowStr);
        model = productModelRepository.save(model);

        return toDto(model, items);
    }

    @Transactional
    public boolean deleteModel(Long modelId) {
        if (!productModelRepository.existsById(modelId)) return false;
        productModelRepository.deleteById(modelId);
        return true;
    }

    @Transactional
    public void assignTenderModels(String tenderId, Long defaultModelId, Map<String, Long> scheduleMap, String username) {
        Tender tender = tenderRepository.findById(tenderId)
                .orElseThrow(() -> new IllegalArgumentException("Tender not found: " + tenderId));

        tender.setSelectedModelId(defaultModelId);
        if (defaultModelId != null) {
            productModelRepository.findById(defaultModelId).ifPresent(m -> {
                tender.setOfferedModel(m.getModelNumber());
            });
        }
        if (scheduleMap != null && !scheduleMap.isEmpty()) {
            try {
                tender.setScheduleProductModels(JSON.writeValueAsString(scheduleMap));
            } catch (Exception ignored) {}
        } else {
            tender.setScheduleProductModels(null);
        }
        tenderRepository.save(tender);
    }

    public Map<String, Object> getTenderModelSelection(String tenderId) {
        Tender tender = tenderRepository.findById(tenderId)
                .orElseThrow(() -> new IllegalArgumentException("Tender not found: " + tenderId));

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("tender_id", tender.getId());
        res.put("selected_model_id", tender.getSelectedModelId());
        res.put("offered_model", tender.getOfferedModel());

        Map<String, Long> scheduleModels = new HashMap<>();
        if (tender.getScheduleProductModels() != null && !tender.getScheduleProductModels().isBlank()) {
            try {
                scheduleModels = JSON.readValue(tender.getScheduleProductModels(), new TypeReference<Map<String, Long>>() {});
            } catch (Exception ignored) {}
        }
        res.put("schedule_models", scheduleModels);

        List<ProductModelDto> verifiedModels = listModels(null, "VERIFIED");
        res.put("available_models", verifiedModels);
        return res;
    }

    /**
     * Matches tender clauses against verified product specifications for the assigned product model(s).
     * Modifies Column 4 (requiredEvidence), Column 3 (compliance), and Column 5 (deviations).
     * Strict rules:
     * - Column 4 populated ONLY from verified evidence.
     * - Never copies buyer requirements as offered specifications.
     * - Never claims compliance without supporting evidence.
     */
    public List<String[]> matchTenderClausesWithEvidence(Tender tender, List<String[]> extractedClauses) {
        if (extractedClauses == null || extractedClauses.isEmpty()) return extractedClauses;

        // Parse schedule-to-model map if present
        Map<String, Long> scheduleMap = new HashMap<>();
        if (tender.getScheduleProductModels() != null && !tender.getScheduleProductModels().isBlank()) {
            try {
                scheduleMap = JSON.readValue(tender.getScheduleProductModels(), new TypeReference<Map<String, Long>>() {});
            } catch (Exception ignored) {}
        }
        Long defaultModelId = tender.getSelectedModelId();

        // Cache loaded verified specs per modelId
        Map<Long, List<ProductSpecificationDto>> verifiedSpecsCache = new HashMap<>();
        Map<Long, ProductModel> modelCache = new HashMap<>();

        // Group clauses by target model
        Map<Long, List<Integer>> modelClauseIndices = new LinkedHashMap<>();
        List<Integer> unassignedIndices = new ArrayList<>();

        for (int i = 0; i < extractedClauses.size(); i++) {
            String[] row = extractedClauses.get(i);
            String schedule = row.length > 11 && row[11] != null ? row[11].trim() : "";
            String category = row.length > 5 && row[5] != null ? row[5].trim() : "";

            Long targetModelId = null;
            if (!schedule.isEmpty() && scheduleMap.containsKey(schedule)) {
                targetModelId = scheduleMap.get(schedule);
            } else if (!category.isEmpty() && scheduleMap.containsKey(category)) {
                targetModelId = scheduleMap.get(category);
            } else if (defaultModelId != null) {
                targetModelId = defaultModelId;
            }

            if (targetModelId != null) {
                modelClauseIndices.computeIfAbsent(targetModelId, k -> new ArrayList<>()).add(i);
            } else {
                unassignedIndices.add(i);
            }
        }

        // Process clauses for each assigned model
        for (var entry : modelClauseIndices.entrySet()) {
            Long modelId = entry.getKey();
            List<Integer> indices = entry.getValue();

            ProductModel model = modelCache.computeIfAbsent(modelId, id -> productModelRepository.findById(id).orElse(null));
            if (model == null) {
                unassignedIndices.addAll(indices);
                continue;
            }

            List<ProductSpecificationDto> verifiedSpecs = verifiedSpecsCache.computeIfAbsent(modelId, id -> {
                List<ProductSpecificationItem> items = productSpecificationItemRepository.findByProductModelIdAndIsVerifiedTrueOrderByDisplayOrderAsc(id);
                return items.stream().map(it -> new ProductSpecificationDto(
                        it.getId(), it.getParameterName(), it.getParameterValue(),
                        it.getSourcePage(), it.getRawEvidence(), it.getIsVerified(), it.getDisplayOrder())).toList();
            });

            if (verifiedSpecs.isEmpty()) {
                for (int idx : indices) {
                    String[] row = extractedClauses.get(idx);
                    row[2] = ""; // Column 4 strictly blank
                    row[3] = ""; // Column 3 empty
                    row[4] = "Model " + model.getModelNumber() + " has no verified datasheet specifications.";
                }
                continue;
            }

            // Extract sublist of clauses for this model
            List<String[]> subset = new ArrayList<>();
            for (int idx : indices) subset.add(extractedClauses.get(idx));

            List<ClauseMatchResultDto> matches = aiSpecificationIntelligenceService.matchClausesWithProductSpecifications(
                    model.getMake(), model.getModelNumber(), model.getProductCategory(), verifiedSpecs, subset);

            for (int k = 0; k < matches.size(); k++) {
                int originalIdx = indices.get(k);
                String[] row = extractedClauses.get(originalIdx);
                ClauseMatchResultDto match = matches.get(k);

                if (match.isMatched() && match.getOfferedSpecification() != null && !match.getOfferedSpecification().isBlank()) {
                    row[2] = match.getOfferedSpecification().trim();
                    row[3] = (match.getComplianceStatus() != null && !match.getComplianceStatus().isBlank())
                            ? match.getComplianceStatus().trim() : "Complied";
                    row[4] = (match.getDeviations() != null && !match.getDeviations().isBlank())
                            ? match.getDeviations().trim() : "None";
                } else {
                    row[2] = ""; // Column 4 strictly blank when evidence not found
                    row[3] = ""; // Compliance not claimed
                    row[4] = (match.getDeviations() != null && !match.getDeviations().isBlank())
                            ? match.getDeviations().trim() : "No datasheet evidence found; manual verification required.";
                }
            }
        }

        // For unassigned clauses: leave Column 4 blank
        for (int idx : unassignedIndices) {
            String[] row = extractedClauses.get(idx);
            row[2] = ""; // Column 4 blank
            row[3] = ""; // Column 3 blank
            row[4] = "No offered product model selected for this schedule/category.";
        }

        return extractedClauses;
    }

    private ProductModelDto toDto(ProductModel model, List<ProductSpecificationItem> specs) {
        ProductModelDto dto = new ProductModelDto();
        dto.setId(model.getId());
        dto.setModelNumber(model.getModelNumber());
        dto.setMake(model.getMake());
        dto.setProductCategory(model.getProductCategory());
        dto.setDescription(model.getDescription());
        dto.setDatasheetPath(model.getDatasheetPath());
        dto.setDatasheetOriginalFilename(model.getDatasheetOriginalFilename());
        dto.setStatus(model.getStatus());
        dto.setCreatedAt(model.getCreatedAt());
        dto.setUpdatedAt(model.getUpdatedAt());
        dto.setVerifiedBy(model.getVerifiedBy());
        dto.setVerifiedAt(model.getVerifiedAt());

        if (specs != null) {
            dto.setTotalSpecs(specs.size());
            dto.setVerifiedSpecs((int) specs.stream().filter(ProductSpecificationItem::getIsVerified).count());
            dto.setSpecifications(specs.stream().map(it -> new ProductSpecificationDto(
                    it.getId(), it.getParameterName(), it.getParameterValue(),
                    it.getSourcePage(), it.getRawEvidence(), it.getIsVerified(), it.getDisplayOrder())).collect(Collectors.toList()));
        }
        return dto;
    }
}
