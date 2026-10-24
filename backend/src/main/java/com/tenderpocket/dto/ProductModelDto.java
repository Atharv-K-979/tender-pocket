package com.tenderpocket.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.ArrayList;
import java.util.List;

public class ProductModelDto {
    private Long id;

    @JsonProperty("model_number")
    private String modelNumber;

    private String make;

    @JsonProperty("product_category")
    private String productCategory;

    private String description;

    @JsonProperty("datasheet_path")
    private String datasheetPath;

    @JsonProperty("datasheet_original_filename")
    private String datasheetOriginalFilename;

    private String status;

    @JsonProperty("created_at")
    private String createdAt;

    @JsonProperty("updated_at")
    private String updatedAt;

    @JsonProperty("verified_by")
    private String verifiedBy;

    @JsonProperty("verified_at")
    private String verifiedAt;

    @JsonProperty("total_specs")
    private int totalSpecs;

    @JsonProperty("verified_specs")
    private int verifiedSpecs;

    private List<ProductSpecificationDto> specifications = new ArrayList<>();

    public ProductModelDto() {}

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getModelNumber() {
        return modelNumber;
    }

    public void setModelNumber(String modelNumber) {
        this.modelNumber = modelNumber;
    }

    public String getMake() {
        return make;
    }

    public void setMake(String make) {
        this.make = make;
    }

    public String getProductCategory() {
        return productCategory;
    }

    public void setProductCategory(String productCategory) {
        this.productCategory = productCategory;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getDatasheetPath() {
        return datasheetPath;
    }

    public void setDatasheetPath(String datasheetPath) {
        this.datasheetPath = datasheetPath;
    }

    public String getDatasheetOriginalFilename() {
        return datasheetOriginalFilename;
    }

    public void setDatasheetOriginalFilename(String datasheetOriginalFilename) {
        this.datasheetOriginalFilename = datasheetOriginalFilename;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    public String getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(String updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getVerifiedBy() {
        return verifiedBy;
    }

    public void setVerifiedBy(String verifiedBy) {
        this.verifiedBy = verifiedBy;
    }

    public String getVerifiedAt() {
        return verifiedAt;
    }

    public void setVerifiedAt(String verifiedAt) {
        this.verifiedAt = verifiedAt;
    }

    public int getTotalSpecs() {
        return totalSpecs;
    }

    public void setTotalSpecs(int totalSpecs) {
        this.totalSpecs = totalSpecs;
    }

    public int getVerifiedSpecs() {
        return verifiedSpecs;
    }

    public void setVerifiedSpecs(int verifiedSpecs) {
        this.verifiedSpecs = verifiedSpecs;
    }

    public List<ProductSpecificationDto> getSpecifications() {
        return specifications;
    }

    public void setSpecifications(List<ProductSpecificationDto> specifications) {
        this.specifications = specifications;
    }
}
