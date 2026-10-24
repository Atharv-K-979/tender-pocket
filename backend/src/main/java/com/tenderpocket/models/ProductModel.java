package com.tenderpocket.models;

import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "product_models", indexes = {
    @Index(name = "idx_product_models_model_no", columnList = "model_number", unique = true),
    @Index(name = "idx_product_models_category", columnList = "product_category"),
    @Index(name = "idx_product_models_status", columnList = "status")
})
public class ProductModel {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @Column(name = "model_number", nullable = false, unique = true)
    private String modelNumber;

    @Column(name = "make", nullable = false)
    private String make = "MarkEn";

    @Column(name = "product_category", nullable = false)
    private String productCategory;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "datasheet_path", columnDefinition = "TEXT")
    private String datasheetPath;

    @Column(name = "datasheet_original_filename")
    private String datasheetOriginalFilename;

    @Column(name = "status", nullable = false)
    private String status = "DRAFT"; // DRAFT, EXTRACTED, VERIFIED

    @Column(name = "created_at")
    private String createdAt;

    @Column(name = "updated_at")
    private String updatedAt;

    @Column(name = "verified_by")
    private String verifiedBy;

    @Column(name = "verified_at")
    private String verifiedAt;

    @OneToMany(mappedBy = "productModel", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @OrderBy("displayOrder ASC")
    private List<ProductSpecificationItem> specifications = new ArrayList<>();

    public ProductModel() {}

    public ProductModel(String modelNumber, String make, String productCategory, String description) {
        this.modelNumber = modelNumber;
        this.make = make != null && !make.isBlank() ? make : "MarkEn";
        this.productCategory = productCategory;
        this.description = description;
        this.status = "DRAFT";
    }

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

    public List<ProductSpecificationItem> getSpecifications() {
        return specifications;
    }

    public void setSpecifications(List<ProductSpecificationItem> specifications) {
        this.specifications = specifications;
    }

    public void addSpecification(ProductSpecificationItem item) {
        item.setProductModel(this);
        this.specifications.add(item);
    }
}
