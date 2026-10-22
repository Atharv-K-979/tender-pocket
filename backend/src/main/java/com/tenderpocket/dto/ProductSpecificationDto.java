package com.tenderpocket.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class ProductSpecificationDto {
    private Long id;
    
    @JsonProperty("parameter_name")
    private String parameterName;
    
    @JsonProperty("parameter_value")
    private String parameterValue;
    
    @JsonProperty("source_page")
    private String sourcePage;
    
    @JsonProperty("raw_evidence")
    private String rawEvidence;
    
    @JsonProperty("is_verified")
    private Boolean isVerified;
    
    @JsonProperty("display_order")
    private Integer displayOrder;

    public ProductSpecificationDto() {}

    public ProductSpecificationDto(Long id, String parameterName, String parameterValue,
                                 String sourcePage, String rawEvidence, Boolean isVerified, Integer displayOrder) {
        this.id = id;
        this.parameterName = parameterName;
        this.parameterValue = parameterValue;
        this.sourcePage = sourcePage;
        this.rawEvidence = rawEvidence;
        this.isVerified = isVerified;
        this.displayOrder = displayOrder;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
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
