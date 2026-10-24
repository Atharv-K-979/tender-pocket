package com.tenderpocket.models;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;

@Entity
@Table(name = "product_spec_items", indexes = {
    @Index(name = "idx_product_spec_items_model_id", columnList = "product_model_id"),
    @Index(name = "idx_product_spec_items_verified", columnList = "is_verified")
})
public class ProductSpecificationItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "product_model_id", nullable = false)
    @JsonIgnore
    private ProductModel productModel;

    @Column(name = "parameter_name", nullable = false)
    private String parameterName;

    @Column(name = "parameter_value", nullable = false, columnDefinition = "TEXT")
    private String parameterValue;

    @Column(name = "source_page")
    private String sourcePage;

    @Column(name = "raw_evidence", columnDefinition = "TEXT")
    private String rawEvidence;

    @Column(name = "is_verified", nullable = false)
    private Boolean isVerified = false;

    @Column(name = "display_order")
    private Integer displayOrder = 0;

    public ProductSpecificationItem() {}

    public ProductSpecificationItem(ProductModel productModel, String parameterName, String parameterValue,
                                    String sourcePage, String rawEvidence, Boolean isVerified, Integer displayOrder) {
        this.productModel = productModel;
        this.parameterName = parameterName;
        this.parameterValue = parameterValue;
        this.sourcePage = sourcePage;
        this.rawEvidence = rawEvidence;
        this.isVerified = isVerified != null ? isVerified : false;
        this.displayOrder = displayOrder != null ? displayOrder : 0;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public ProductModel getProductModel() {
        return productModel;
    }

    public void setProductModel(ProductModel productModel) {
        this.productModel = productModel;
    }

    public String getParameterName() {
        return parameterName;
    }

    public void setParameterName(String parameterName) {
        this.parameterName = parameterName;
    }

    public String getParameterValue() {
        return parameterValue;
    }

    public void setParameterValue(String parameterValue) {
        this.parameterValue = parameterValue;
    }

    public String getSourcePage() {
        return sourcePage;
    }

    public void setSourcePage(String sourcePage) {
        this.sourcePage = sourcePage;
    }

    public String getRawEvidence() {
        return rawEvidence;
    }

    public void setRawEvidence(String rawEvidence) {
        this.rawEvidence = rawEvidence;
    }

    public Boolean getIsVerified() {
        return isVerified;
    }

    public void setIsVerified(Boolean verified) {
        isVerified = verified;
    }

    public Integer getDisplayOrder() {
        return displayOrder;
    }

    public void setDisplayOrder(Integer displayOrder) {
        this.displayOrder = displayOrder;
    }
}
