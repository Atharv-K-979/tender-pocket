/**
 * Centralized Tender Classification & Ingestion Source Display Mapping
 * 
 * Rules:
 * 1. User-Facing Classification Badges:
 *    - 'GeM' -> displays as 'GeM' with green styling (#10b981)
 *    - 'Non-GeM' or 'Non GeM' -> displays as 'Non-GeM' with blue styling (#3b82f6)
 *    - 'Unverified' -> displays as 'Non-GeM' with blue styling (#3b82f6)
 *    - null / undefined / empty -> displays as 'Non-GeM' with blue styling (#3b82f6)
 * 2. Ingestion Source Badges:
 *    - 'Tender247' / 'Tender 247' -> displays as 'Tender247 Portal'
 *    - 'GeM' -> displays as 'GeM Portal'
 *    - Remains separate and unchanged from classification.
 * 3. Stored internal values:
 *    - Backend classification rules, stored tender_type values, database records,
 *      email parsing, scraping, and enrichment logic retain the actual 'Unverified' value internally.
 */

export interface ClassificationDisplayBadge {
  label: 'GeM' | 'Non-GeM';
  color: string;
  bgColor: string;
  borderColor: string;
}

/**
 * Returns user-facing classification badge styling and label.
 * Maps 'GeM' -> 'GeM' (green).
 * Maps 'Non-GeM', 'Non GeM', and 'Unverified' -> 'Non-GeM' (blue).
 */
export function getClassificationDisplay(tenderType?: string | null): ClassificationDisplayBadge {
  const normalized = (tenderType || '').trim();

  if (/^gem(\s+bid)?$/i.test(normalized)) {
    return {
      label: 'GeM',
      color: '#10b981',
      bgColor: 'rgba(16, 185, 129, 0.1)',
      borderColor: 'rgba(16, 185, 129, 0.2)',
    };
  }

  // Both 'Non GeM'/'Non-GeM' and 'Unverified' display as 'Non-GeM' with blue styling
  return {
    label: 'Non-GeM',
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: 'rgba(59, 130, 246, 0.2)',
  };
}

/**
 * Returns user-facing classification label ('GeM' or 'Non-GeM').
 */
export function getClassificationLabel(tenderType?: string | null): 'GeM' | 'Non-GeM' {
  return getClassificationDisplay(tenderType).label;
}

/**
 * Returns user-facing ingestion source badge label.
 * For Tender247 tenders, returns 'Tender247 Portal'.
 * For GeM tenders, returns 'GeM Portal'.
 */
export function getSourceBadgeLabel(source?: string | null): string {
  if (!source) return '';
  const trimmed = source.trim();
  if (trimmed === 'Tender247' || trimmed === 'Tender 247') {
    return 'Tender247 Portal';
  }
  if (trimmed === 'GeM') {
    return 'GeM Portal';
  }
  return trimmed;
}

/**
 * Returns formatted Source Portal label for Quick Overview / Specifications.
 */
export function getSourcePortalLabel(source?: string | null): string {
  const badge = getSourceBadgeLabel(source);
  return badge || 'Not Specified';
}
