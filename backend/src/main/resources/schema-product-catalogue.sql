-- PostgreSQL Schema Migration: Product Model Catalogue & Verified Specifications
-- Enables evidence-based population of Column 4 (MarkEn - Offered Specification)

CREATE TABLE IF NOT EXISTS product_models (
    id BIGSERIAL PRIMARY KEY,
    model_number VARCHAR(128) NOT NULL,
    make VARCHAR(128) NOT NULL DEFAULT 'MarkEn',
    product_category VARCHAR(255) NOT NULL,
    description TEXT,
    datasheet_path TEXT,
    datasheet_original_filename VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, EXTRACTED, VERIFIED
    created_at VARCHAR(64),
    updated_at VARCHAR(64),
    verified_by VARCHAR(128),
    verified_at VARCHAR(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_models_model_no ON product_models(model_number);
CREATE INDEX IF NOT EXISTS idx_product_models_category ON product_models(product_category);
CREATE INDEX IF NOT EXISTS idx_product_models_status ON product_models(status);

CREATE TABLE IF NOT EXISTS product_spec_items (
    id BIGSERIAL PRIMARY KEY,
    product_model_id BIGINT NOT NULL REFERENCES product_models(id) ON DELETE CASCADE,
    parameter_name VARCHAR(255) NOT NULL,
    parameter_value TEXT NOT NULL,
    source_page VARCHAR(64),
    raw_evidence TEXT,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_product_spec_items_model_id ON product_spec_items(product_model_id);
CREATE INDEX IF NOT EXISTS idx_product_spec_items_verified ON product_spec_items(is_verified);

-- Add model selection columns to tenders table if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tenders' AND column_name = 'selected_model_id'
    ) THEN
        ALTER TABLE tenders ADD COLUMN selected_model_id BIGINT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tenders' AND column_name = 'schedule_product_models'
    ) THEN
        ALTER TABLE tenders ADD COLUMN schedule_product_models TEXT;
    END IF;
END $$;
