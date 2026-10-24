package com.tenderpocket.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public class ClauseMatchResultDto {
    @JsonProperty("clause_index")
    private int clauseIndex;

    @JsonProperty("matched_parameter")
    private String matchedParameter;

    @JsonProperty("offered_specification")
    private String offeredSpecification;

    @JsonProperty("compliance_status")
    private String complianceStatus;

    private String deviations;

    @JsonProperty("source_citation")
    private String sourceCitation;

    @JsonProperty("is_matched")
    private boolean isMatched;

    public ClauseMatchResultDto() {}

    public ClauseMatchResultDto(int clauseIndex, String matchedParameter, String offeredSpecification,
                               String complianceStatus, String deviations, String sourceCitation, boolean isMatched) {
        this.clauseIndex = clauseIndex;
        this.matchedParameter = matchedParameter;
        this.offeredSpecification = offeredSpecification;
        this.complianceStatus = complianceStatus;
        this.deviations = deviations;
        this.sourceCitation = sourceCitation;
        this.isMatched = isMatched;
    }

    public int getClauseIndex() {
        return clauseIndex;
    }

    public void setClauseIndex(int clauseIndex) {
        this.clauseIndex = clauseIndex;
    }

    public String getMatchedParameter() {
        return matchedParameter;
    }

    public void setMatchedParameter(String matchedParameter) {
        this.matchedParameter = matchedParameter;
    }

    public String getOfferedSpecification() {
        return offeredSpecification;
    }

    public void setOfferedSpecification(String offeredSpecification) {
        this.offeredSpecification = offeredSpecification;
    }

    public String getComplianceStatus() {
        return complianceStatus;
    }

    public void setComplianceStatus(String complianceStatus) {
        this.complianceStatus = complianceStatus;
    }

    public String getDeviations() {
        return deviations;
    }

    public void setDeviations(String deviations) {
        this.deviations = deviations;
    }

    public String getSourceCitation() {
        return sourceCitation;
    }

    public void setSourceCitation(String sourceCitation) {
        this.sourceCitation = sourceCitation;
    }

    public boolean isMatched() {
        return isMatched;
    }

    public void setMatched(boolean matched) {
        isMatched = matched;
    }
}
