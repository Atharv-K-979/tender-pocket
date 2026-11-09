"use client";

import React, { useState, useMemo, useEffect } from 'react';
import {
  FileText,
  Search,
  Clock,
  Building,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  AlertOctagon,
  X,
  XCircle,
  MinusCircle,
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Calendar,
  MapPin,
  Tag,
  Trophy,
  CreditCard,
  ShieldCheck,
  Calculator,
  UploadCloud,
  MoreVertical,
  ExternalLink,
  ArrowUpDown,
  Layers,
  SlidersHorizontal,
  Users,
  Package,
  Check
} from 'lucide-react';
import { Tender } from '@/lib/db';
import { PIPELINE_STEPS, resolveTenderStageDetails } from '@/lib/tenderStatus';
import { getClassificationDisplay, getSourceBadgeLabel } from '@/lib/tenderClassification';

interface StatusDashboardProps {
  tenders: Tender[];
  currentUser: { username: string; role: string } | null;
  executives: string[];
  openTenderDetails: (tender: Tender) => void;
  handleStatusChange: (tenderId: string, newStatus: 'Issued' | 'Participating' | 'Not Participating' | 'Filed' | 'Awarded' | 'Not Awarded') => Promise<void>;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  showToast: (message: string, type: 'success' | 'error') => void;
  handleRefresh: () => Promise<void>;
  refreshing: boolean;
  categoryFilter?: 'ALL' | 'PIPELINE' | 'OUTCOMES' | 'ACTION_REQUIRED' | 'OVERVIEW';
  executiveFilter?: string;
}

export default function StatusDashboard({
  tenders,
  currentUser,
  executives,
  openTenderDetails,
  handleStatusChange,
  fetchWithAuth,
  showToast,
  handleRefresh,
  refreshing,
  categoryFilter: propCategoryFilter,
  executiveFilter: propExecutiveFilter
}: StatusDashboardProps) {
  // Navigation & Filtering States
  const [selectedCardKey, setSelectedCardKey] = useState<string>('');
  const [internalCategoryFilter, setInternalCategoryFilter] = useState<'ALL' | 'PIPELINE' | 'OUTCOMES' | 'ACTION_REQUIRED' | 'OVERVIEW'>('ALL');
  const [internalExecutiveFilter, setInternalExecutiveFilter] = useState<string>('');

  const categoryFilter = propCategoryFilter ?? internalCategoryFilter;
  const executiveFilter = propExecutiveFilter ?? internalExecutiveFilter;

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [urgencyFilter, setUrgencyFilter] = useState<'' | 'action_required' | 'today' | '3days' | '7days' | 'high_value'>('');
  const [sortBy, setSortBy] = useState<'due_date' | 'estimated_cost' | 'scraped_at'>('due_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [menuOpenTenderId, setMenuOpenTenderId] = useState<string | null>(null);

  // Pagination States
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Reset page whenever search query or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, urgencyFilter, selectedCardKey, categoryFilter, executiveFilter, sortBy, sortOrder]);

  // Today in IST
  const todayIST = useMemo(() => {
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-IN', options as any);
    const parts = formatter.formatToParts(new Date());
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    return `${year}-${month}-${day}`;
  }, []);

  const parsedToday = useMemo(() => new Date(todayIST + 'T00:00:00+05:30'), [todayIST]);
  const threeDaysLater = useMemo(() => {
    const d = new Date(parsedToday);
    d.setDate(d.getDate() + 3);
    return d;
  }, [parsedToday]);
  const sevenDaysLater = useMemo(() => {
    const d = new Date(parsedToday);
    d.setDate(d.getDate() + 7);
    return d;
  }, [parsedToday]);

  // Scope tenders by Executive if selected
  const scopedTenders = useMemo(() => {
    if (!executiveFilter) return tenders;
    return tenders.filter(t => t.mis_executive === executiveFilter);
  }, [tenders, executiveFilter]);

  // Process all tenders with canonical 7-step stages and operational flags
  const tendersWithStage = useMemo(() => {
    return scopedTenders.map(t => {
      const stage = resolveTenderStageDetails(t, currentUser?.role);

      const isWon = stage.isWon;
      const isLost = stage.isLost;
      const isDeclined = stage.isDeclined;
      const isSubmitted = stage.isSubmitted;
      const isSubmissionPending = stage.stageKey === 'SUBMISSION_PENDING';
      const isReadyToSubmit = stage.stageKey === 'READY_TO_SUBMIT';
      const isEmdPending = stage.stageKey === 'EMD_PENDING' || stage.stageKey === 'EMD_APPROVAL_PENDING';
      const isDocVerificationPending = stage.stageKey === 'DOC_VERIFICATION';
      const isDocRejected = stage.stageKey === 'DOCS_REJECTED';
      const isDocsPrep = stage.stageKey === 'BID_DOCS_PREP';
      const isMisPricingPending = stage.stageKey === 'MIS_PRICING';
      const isTpcPricingPending = stage.stageKey === 'TPC_PRICING';
      const isSpecClearancePending = stage.stageKey === 'SPEC_CLEARANCE_PENDING';
      const isSpecRejected = stage.stageKey === 'SPEC_REJECTED';
      const isAssignmentPending = stage.stageKey === 'ASSIGNMENT_PENDING' || stage.stageKey === 'NEW_UNREVIEWED';

      const isClosingSoon = Boolean(t.due_date && t.due_date >= todayIST && new Date(t.due_date + 'T00:00:00+05:30') <= sevenDaysLater && !isSubmitted && !isWon && !isLost);
      const isClosing3Days = Boolean(t.due_date && t.due_date >= todayIST && new Date(t.due_date + 'T00:00:00+05:30') <= threeDaysLater && !isSubmitted && !isWon && !isLost);
      const isClosingToday = Boolean(t.due_date && t.due_date.startsWith(todayIST) && !isSubmitted && !isWon && !isLost);
      const isOverdue = Boolean(t.due_date && t.due_date < todayIST && !isSubmitted && !isWon && !isLost);

      // High value tender (> 1 Crore)
      const isHighValue = (t.estimated_cost || 0) >= 10000000;

      // Tender marked as action required
      const needsAction = stage.needsAction || isClosing3Days || isDocRejected || isSpecRejected;

      return {
        tender: t,
        stage,
        flags: {
          isWon,
          isLost,
          isDeclined,
          isSubmitted,
          isSubmissionPending,
          isReadyToSubmit,
          isEmdPending,
          isDocVerificationPending,
          isDocRejected,
          isDocsPrep,
          isMisPricingPending,
          isTpcPricingPending,
          isSpecClearancePending,
          isSpecRejected,
          isAssignmentPending,
          isClosingSoon,
          isClosing3Days,
          isClosingToday,
          isOverdue,
          isHighValue,
          needsAction
        }
      };
    });
  }, [scopedTenders, todayIST, threeDaysLater, sevenDaysLater, currentUser]);

  // Canonical Workflow Status Cards
  // Total Tenders + 7 Pipeline Steps + 3 Terminal / Out-of-Pipeline Statuses (Won, Lost, Not Participating)
  const stageCards = useMemo(() => {
    const totalCount = scopedTenders.length;

    // Active pipeline counts (Steps 1 to 6)
    const stage1Count = tendersWithStage.filter(i => i.stage.stageNumber === 1 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined).length;
    const stage2Count = tendersWithStage.filter(i => i.stage.stageNumber === 2 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined).length;
    const stage3Count = tendersWithStage.filter(i => i.stage.stageNumber === 3 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined).length;
    const stage4Count = tendersWithStage.filter(i => i.stage.stageNumber === 4 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined).length;
    const stage5Count = tendersWithStage.filter(i => i.stage.stageNumber === 5 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined).length;
    const stage6Count = tendersWithStage.filter(i => i.stage.stageNumber === 6 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined).length;

    // Post-Submission & Outcome counts (Step 7 + Terminal)
    const stage7EvaluationCount = tendersWithStage.filter(i => (i.stage.stageKey === 'SUBMITTED' || i.flags.isSubmitted) && !i.flags.isWon && !i.flags.isLost).length;
    const wonCount = tendersWithStage.filter(i => i.flags.isWon).length;
    const lostCount = tendersWithStage.filter(i => i.flags.isLost).length;
    const notParticipatingCount = tendersWithStage.filter(i => i.flags.isDeclined || i.tender.status === 'Not Participating').length;

    return [
      // ── MASTER SUMMARY CARD ──
      {
        key: 'TOTAL',
        title: 'Total Tenders',
        group: 'PIPELINE',
        count: totalCount,
        trend: 'all bids in view',
        subText: 'Master Tender Portfolio',
        icon: Layers,
        iconColor: '#6366f1',
        bgColor: 'rgba(99, 102, 241, 0.12)',
        filterFn: () => true
      },

      // ── 7 CANONICAL WORKFLOW PIPELINE STAGE CARDS ──
      {
        key: 'STAGE_1_ASSIGNMENT',
        title: '1. Assignment',
        group: 'PIPELINE',
        count: stage1Count,
        trend: 'Step 1 of 7',
        subText: 'Executive Assignment',
        icon: Users,
        iconColor: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.12)',
        filterFn: (i: any) => i.stage.stageNumber === 1 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined
      },
      {
        key: 'STAGE_2_TECH_SPEC',
        title: '2. Tech Spec',
        group: 'PIPELINE',
        count: stage2Count,
        trend: 'Step 2 of 7',
        subText: 'Specs & Clearance',
        icon: ShieldCheck,
        iconColor: '#3b82f6',
        bgColor: 'rgba(59, 130, 246, 0.12)',
        filterFn: (i: any) => i.stage.stageNumber === 2 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined
      },
      {
        key: 'STAGE_3_BID_PREP',
        title: '3. Bid Prep',
        group: 'PIPELINE',
        count: stage3Count,
        trend: 'Step 3 of 7',
        subText: 'Bid Document Prep',
        icon: FileText,
        iconColor: '#10b981',
        bgColor: 'rgba(16, 185, 129, 0.12)',
        filterFn: (i: any) => i.stage.stageNumber === 3 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined
      },
      {
        key: 'STAGE_4_EMD',
        title: '4. EMD Payment',
        group: 'PIPELINE',
        count: stage4Count,
        trend: 'Step 4 of 7',
        subText: 'Payment & Audit',
        icon: CreditCard,
        iconColor: '#ec4899',
        bgColor: 'rgba(236, 72, 153, 0.12)',
        filterFn: (i: any) => i.stage.stageNumber === 4 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined
      },
      {
        key: 'STAGE_5_DUAL_TRACK',
        title: '5. Dual Track',
        group: 'PIPELINE',
        count: stage5Count,
        trend: 'Step 5 of 7',
        subText: 'Pricing & Folder Audit',
        icon: Calculator,
        iconColor: '#8b5cf6',
        bgColor: 'rgba(139, 92, 246, 0.12)',
        filterFn: (i: any) => i.stage.stageNumber === 5 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined
      },
      {
        key: 'STAGE_6_SUBMISSION',
        title: '6. Submission',
        group: 'PIPELINE',
        count: stage6Count,
        trend: 'Step 6 of 7',
        subText: 'Portal Filing & Audit',
        icon: UploadCloud,
        iconColor: '#06b6d4',
        bgColor: 'rgba(6, 182, 212, 0.12)',
        filterFn: (i: any) => i.stage.stageNumber === 6 && !i.flags.isWon && !i.flags.isLost && !i.flags.isDeclined
      },

      // ── POST-SUBMISSION EVALUATION & FINAL OUTCOME STATUS CARDS ──
      {
        key: 'STAGE_7_EVALUATION',
        title: '7. Under Evaluation',
        group: 'OUTCOMES',
        count: stage7EvaluationCount,
        trend: 'Step 7 of 7',
        subText: 'Submitted on Portal',
        icon: Clock,
        iconColor: '#3b82f6',
        bgColor: 'rgba(59, 130, 246, 0.12)',
        filterFn: (i: any) => (i.stage.stageKey === 'SUBMITTED' || i.flags.isSubmitted) && !i.flags.isWon && !i.flags.isLost
      },
      {
        key: 'STATUS_WON',
        title: 'Won / Awarded',
        group: 'OUTCOMES',
        count: wonCount,
        trend: 'Terminal Success',
        subText: 'Contract Awarded',
        icon: Trophy,
        iconColor: '#10b981',
        bgColor: 'rgba(16, 185, 129, 0.12)',
        filterFn: (i: any) => i.flags.isWon
      },
      {
        key: 'STATUS_LOST',
        title: 'Lost / Closed',
        group: 'OUTCOMES',
        count: lostCount,
        trend: 'Terminal Closed',
        subText: 'Lost to Competitor',
        icon: XCircle,
        iconColor: '#ef4444',
        bgColor: 'rgba(239, 68, 68, 0.12)',
        filterFn: (i: any) => i.flags.isLost
      },
      {
        key: 'STATUS_NOT_PARTICIPATING',
        title: 'Not Participating',
        group: 'OUTCOMES',
        count: notParticipatingCount,
        trend: 'Declined Intake',
        subText: 'Opted Out / Archived',
        icon: MinusCircle,
        iconColor: '#64748b',
        bgColor: 'rgba(100, 116, 139, 0.12)',
        filterFn: (i: any) => i.flags.isDeclined || i.tender.status === 'Not Participating'
      }
    ];
  }, [tendersWithStage, scopedTenders.length]);

  // Total Action Required Count across all tenders
  const actionRequiredTotalCount = useMemo(() => {
    return tendersWithStage.filter(i => i.flags.needsAction).length;
  }, [tendersWithStage]);

  // Determine which cards to show according to category filter
  const visibleCards = useMemo(() => {
    if (categoryFilter === 'ALL' || categoryFilter === 'OVERVIEW') return stageCards;
    if (categoryFilter === 'PIPELINE') return stageCards.filter(c => c.group === 'PIPELINE');
    if (categoryFilter === 'OUTCOMES') return stageCards.filter(c => c.group === 'OUTCOMES');
    if (categoryFilter === 'ACTION_REQUIRED') return stageCards;
    return stageCards;
  }, [stageCards, categoryFilter]);

  // Selected card object
  const activeCard = useMemo(() => {
    return stageCards.find(c => c.key === selectedCardKey) || null;
  }, [stageCards, selectedCardKey]);

  // Filtered and Sorted Tenders List
  const filteredTenders = useMemo(() => {
    let list = tendersWithStage;

    // Apply active card filter if any
    if (activeCard && activeCard.key !== 'TOTAL') {
      list = list.filter(activeCard.filterFn);
    }

    // Apply Action Required category filter if selected from header
    if (categoryFilter === 'ACTION_REQUIRED') {
      list = list.filter(({ flags }) => flags.needsAction);
    }

    // Apply Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(({ tender }) => {
        return (
          tender.id?.toLowerCase().includes(q) ||
          tender.ref_no?.toLowerCase().includes(q) ||
          tender.title?.toLowerCase().includes(q) ||
          tender.authority?.toLowerCase().includes(q) ||
          tender.product_name_as_per_tender?.toLowerCase().includes(q) ||
          tender.location?.toLowerCase().includes(q) ||
          tender.place?.toLowerCase().includes(q) ||
          tender.state?.toLowerCase().includes(q) ||
          tender.sector?.toLowerCase().includes(q) ||
          tender.vertical_name?.toLowerCase().includes(q) ||
          tender.mis_executive?.toLowerCase().includes(q) ||
          tender.status?.toLowerCase().includes(q)
        );
      });
    }

    // Apply Urgency / Alert Filter Pills
    if (urgencyFilter) {
      if (urgencyFilter === 'action_required') {
        list = list.filter(({ flags }) => flags.needsAction);
      } else if (urgencyFilter === 'today') {
        list = list.filter(({ flags }) => flags.isClosingToday);
      } else if (urgencyFilter === '3days') {
        list = list.filter(({ flags }) => flags.isClosing3Days);
      } else if (urgencyFilter === '7days') {
        list = list.filter(({ flags }) => flags.isClosingSoon);
      } else if (urgencyFilter === 'high_value') {
        list = list.filter(({ flags }) => flags.isHighValue);
      }
    }

    // Sorting
    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'due_date') {
        const dateA = a.tender.due_date || '9999-99-99';
        const dateB = b.tender.due_date || '9999-99-99';
        cmp = dateA.localeCompare(dateB);
      } else if (sortBy === 'estimated_cost') {
        const costA = a.tender.estimated_cost || 0;
        const costB = b.tender.estimated_cost || 0;
        cmp = costA - costB;
      } else {
        const dateA = a.tender.scraped_at || '';
        const dateB = b.tender.scraped_at || '';
        cmp = dateA.localeCompare(dateB);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [tendersWithStage, activeCard, categoryFilter, searchQuery, urgencyFilter, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredTenders.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedTenders = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredTenders.slice(start, start + pageSize);
  }, [filteredTenders, safeCurrentPage, pageSize]);

  // Formatting Helpers
  const formatCost = (val: number | null | undefined, raw: string | null | undefined) => {
    if (val === null || val === undefined || isNaN(val)) return raw || 'Refer Document';
    if (val >= 10000000) {
      return `₹ ${(val / 10000000).toFixed(2)} Cr`;
    }
    if (val >= 100000) {
      return `₹ ${(val / 100000).toFixed(2)} Lakh`;
    }
    return `₹ ${val.toLocaleString('en-IN')}`;
  };

  const getDaysRemainingLabel = (dueDateStr: string | null | undefined) => {
    if (!dueDateStr) return { text: 'No deadline', isUrgent: false, isOverdue: false };
    try {
      const clean = dueDateStr.split(' ')[0].split('T')[0];
      const due = new Date(clean + 'T00:00:00+05:30');
      const diffTime = due.getTime() - parsedToday.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, isUrgent: true, isOverdue: true };
      if (diffDays === 0) return { text: 'Due today', isUrgent: true, isOverdue: false };
      if (diffDays === 1) return { text: '1 day left', isUrgent: true, isOverdue: false };
      return { text: `${diffDays} days left`, isUrgent: diffDays <= 3, isOverdue: false };
    } catch {
      return { text: 'Active', isUrgent: false, isOverdue: false };
    }
  };

  const handleCardClick = (key: string) => {
    if (selectedCardKey === key) {
      setSelectedCardKey('');
    } else {
      setSelectedCardKey(key);
    }
  };

  const canViewTpcPrice = currentUser?.role !== 'Tender Executive' &&
    currentUser?.role !== 'Executive' &&
    currentUser?.role !== 'Clearance Team' &&
    currentUser?.role !== 'Specification Team';

  const renderCard = (card: typeof stageCards[0]) => {
    const isSelected = selectedCardKey === card.key;
    const Icon = card.icon;

    return (
      <div
        key={card.key}
        onClick={() => handleCardClick(card.key)}
        style={{
          backgroundColor: 'var(--bg-card)',
          borderRadius: '14px',
          padding: '16px 18px',
          border: isSelected
            ? `2px solid ${card.iconColor}`
            : '1px solid var(--border-color)',
          boxShadow: isSelected
            ? `0 0 14px ${card.bgColor}`
            : 'var(--shadow-sm)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          position: 'relative',
          overflow: 'hidden'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = isSelected
            ? `0 0 14px ${card.bgColor}`
            : 'var(--shadow-sm)';
        }}
      >
        {/* Selected indicator bar */}
        {isSelected && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '3px',
            backgroundColor: card.iconColor
          }} />
        )}

        {/* Left Side: Icon & Details */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: card.bgColor,
              color: card.iconColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Icon size={22} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-secondary)' }}>
              {card.title}
            </span>
            <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', lineHeight: '1.2', margin: '2px 0' }}>
              {card.count}
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {card.subText}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      {/* ── WORKFLOW STATUS CARDS GRID ── */}
      {categoryFilter === 'ALL' || categoryFilter === 'OVERVIEW' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Section 1: Active Workflow Pipeline (Steps 1 – 6 & Total) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)' }}>
                Active Workflow Pipeline (Steps 1 – 6)
              </div>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                Intake &rarr; Technical Spec &rarr; Bid Prep &rarr; EMD &rarr; Dual Track &rarr; Submission
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '14px'
              }}
            >
              {stageCards.filter(c => c.group === 'PIPELINE').map(renderCard)}
            </div>
          </div>

          {/* Section 2: Post-Submission & Final Outcomes */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)' }}>
                Post-Submission & Final Outcomes (Step 7 & Results)
              </div>
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                Under Evaluation &rarr; Won, Lost, and Declined bids
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: '14px'
              }}
            >
              {stageCards.filter(c => c.group === 'OUTCOMES').map(renderCard)}
            </div>
          </div>
        </div>
      ) : (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '14px'
          }}
        >
          {visibleCards.map(renderCard)}
        </section>
      )}

      {/* ── INTERACTIVE DRILL-DOWN TENDER LIST VIEW ── */}
      <section
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '14px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}
      >
        {/* Drilldown Header & Breadcrumb */}
        <div>
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '6px' }}>
            Status Dashboard &gt; <strong style={{ color: 'var(--text-primary)' }}>{activeCard ? activeCard.title : 'All Tenders'}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {activeCard && (
                <button
                  onClick={() => setSelectedCardKey('')}
                  className="btn btn-secondary btn-icon-only"
                  style={{ width: '32px', height: '32px', padding: 0 }}
                  title="Clear status card filter"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
              
              <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>{activeCard ? activeCard.title : 'All Tenders Status Desk'}</span>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: '700',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    backgroundColor: activeCard ? activeCard.bgColor : 'rgba(99, 102, 241, 0.1)',
                    color: activeCard ? activeCard.iconColor : 'var(--primary)',
                    border: '1px solid ' + (activeCard ? activeCard.iconColor + '30' : 'rgba(99, 102, 241, 0.2)')
                  }}
                >
                  {filteredTenders.length}
                </span>
              </h3>
            </div>

            <span style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>
              {activeCard ? activeCard.subText : 'Displaying live bids filtered across all required tender parameters & canonical workflow stages'}
            </span>
          </div>
        </div>

        {/* Filter & Controls Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            padding: '14px',
            borderRadius: '10px',
            backgroundColor: 'var(--bg-app)',
            border: '1px solid var(--border-color)'
          }}
        >
          {/* Search Box */}
          <div className="search-input-wrapper" style={{ minWidth: '280px', flexGrow: 1 }}>
            <Search size={16} />
            <input
              type="text"
              className="search-input"
              placeholder={`Search in ${activeCard ? activeCard.title.toLowerCase() : 'all'} tenders by ID, Ref, Authority, Title, Sector...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ fontSize: '13px' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Quick Urgency & Alert Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setUrgencyFilter('')}
              className={`btn ${urgencyFilter === '' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              All
            </button>
            <button
              onClick={() => setUrgencyFilter(urgencyFilter === 'action_required' ? '' : 'action_required')}
              className={`btn ${urgencyFilter === 'action_required' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                backgroundColor: urgencyFilter === 'action_required' ? '#ef4444' : undefined,
                color: urgencyFilter === 'action_required' ? '#fff' : (actionRequiredTotalCount > 0 ? '#ef4444' : undefined),
                fontWeight: actionRequiredTotalCount > 0 ? '700' : '500',
                border: actionRequiredTotalCount > 0 && urgencyFilter !== 'action_required' ? '1px solid rgba(239, 68, 68, 0.4)' : undefined
              }}
            >
              ⚠️ Action Required ({actionRequiredTotalCount})
            </button>
            <button
              onClick={() => setUrgencyFilter(urgencyFilter === 'today' ? '' : 'today')}
              className={`btn ${urgencyFilter === 'today' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                backgroundColor: urgencyFilter === 'today' ? '#dc2626' : undefined,
                color: urgencyFilter === 'today' ? '#fff' : undefined
              }}
            >
              Due Today
            </button>
            <button
              onClick={() => setUrgencyFilter(urgencyFilter === '3days' ? '' : '3days')}
              className={`btn ${urgencyFilter === '3days' ? 'btn-primary' : 'btn-secondary'}`}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                backgroundColor: urgencyFilter === '3days' ? '#f97316' : undefined,
                color: urgencyFilter === '3days' ? '#fff' : undefined
              }}
            >
              Due in 3 Days
            </button>
            <button
              onClick={() => setUrgencyFilter(urgencyFilter === '7days' ? '' : '7days')}
              className={`btn ${urgencyFilter === '7days' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              Due in 7 Days
            </button>
            <button
              onClick={() => setUrgencyFilter(urgencyFilter === 'high_value' ? '' : 'high_value')}
              className={`btn ${urgencyFilter === 'high_value' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              High Value (&gt; ₹1 Cr)
            </button>
          </div>

          {/* Sort Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <select
              className="filter-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={{ fontSize: '12px', padding: '6px 10px' }}
            >
              <option value="due_date">Sort: Deadline</option>
              <option value="estimated_cost">Sort: Estimated Value</option>
              <option value="scraped_at">Sort: Discovery Date</option>
            </select>

            <button
              className="btn btn-secondary btn-icon-only"
              onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
              title={`Sorting ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
              style={{ padding: '7px 10px' }}
            >
              <ArrowUpDown size={14} />
            </button>

            {/* Clear All Filters */}
            {(searchQuery || urgencyFilter || selectedCardKey) && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSearchQuery('');
                  setUrgencyFilter('');
                  setSelectedCardKey('');
                }}
                style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <X size={14} /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Tender Listing with All Required Fields */}
        {filteredTenders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
            <SlidersHorizontal size={40} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
            <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '6px' }}>
              No Tenders Found in this Status
            </h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto 16px auto' }}>
              No tenders match your current filter criteria. Try selecting another status card or clearing your search.
            </p>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSearchQuery('');
                setUrgencyFilter('');
                setSelectedCardKey('');
              }}
            >
              Clear Filters
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {paginatedTenders.map(({ tender, stage, flags }) => {
                const deadline = getDaysRemainingLabel(tender.due_date);

                const isEmdExempt = Boolean(
                  (tender.emd !== undefined && tender.emd !== null && Number(tender.emd) === 0) ||
                  tender.emd_applicable === false ||
                  tender.payment_status === 'Exempt' ||
                  tender.emd_status === 'EXEMPT_SKIPPED'
                );

                return (
                  <div
                    key={tender.id}
                    className="card"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      border: flags.needsAction ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid var(--border-color)',
                      borderLeft: flags.needsAction ? '4px solid #ef4444' : `4px solid ${stage.statusColor}`,
                      borderRadius: '12px',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      transition: 'all 0.15s ease',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--primary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = flags.needsAction ? 'rgba(239, 68, 68, 0.35)' : 'var(--border-color)';
                    }}
                  >
                    {/* Top Header Row: Identifiers & Value/Deadline */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {/* Monospace Tender ID */}
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '12px',
                            fontWeight: '700',
                            color: 'var(--text-primary)',
                            backgroundColor: 'var(--bg-app)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            padding: '3px 8px'
                          }}
                        >
                          {tender.id}
                        </span>

                      {/* Classification Badge */}
                      {(() => {
                        const classification = getClassificationDisplay(tender.tender_type || tender.tenderType);
                        return (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: '600',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              backgroundColor: classification.bgColor,
                              color: classification.color,
                              border: `1px solid ${classification.borderColor}`
                            }}
                          >
                            {classification.label}
                          </span>
                        );
                      })()}

                      {/* Ingestion Source Tag */}
                      {(() => {
                        const sourceLabel = getSourceBadgeLabel(tender.source);
                        if (!sourceLabel) return null;
                        return (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: '500',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(107, 114, 128, 0.1)',
                              color: 'var(--text-muted, #6b7280)',
                              border: '1px solid rgba(107, 114, 128, 0.2)'
                            }}
                          >
                            {sourceLabel}
                          </span>
                        );
                      })()}

                        {/* Tender Type */}
                        {tender.tender_type && (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: '600',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(99, 102, 241, 0.08)',
                              color: 'var(--primary)',
                              border: '1px solid rgba(99, 102, 241, 0.2)'
                            }}
                          >
                            {tender.tender_type}
                          </span>
                        )}

                        {/* Overall Workflow Status Badge */}
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: '700',
                            padding: '3px 10px',
                            borderRadius: '12px',
                            backgroundColor: stage.badgeBg,
                            color: stage.statusColor,
                            border: `1px solid ${stage.badgeBorder}`
                          }}
                        >
                          {stage.stageName}
                        </span>

                        {/* Organization Tender ID */}
                        {tender.ref_no && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            Organization Tender ID: <strong>{tender.ref_no}</strong>
                          </span>
                        )}

                        {/* Assigned Executive */}
                        <span style={{
                          fontSize: '11px',
                          color: tender.mis_executive ? 'var(--primary)' : 'var(--text-muted)',
                          fontWeight: '600',
                          backgroundColor: tender.mis_executive ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-app)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          border: '1px solid ' + (tender.mis_executive ? 'rgba(99, 102, 241, 0.2)' : 'var(--border-color)')
                        }}>
                          👤 {tender.mis_executive || 'Unassigned'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                        {/* Estimated Value */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Value:</span>
                          <span style={{ fontSize: '14px', fontWeight: '800', color: 'var(--text-primary)' }}>
                            {formatCost(tender.estimated_cost, tender.estimated_cost_raw)}
                          </span>
                        </div>

                        {/* Closing Due Date Status */}
                        <span
                          style={{
                            fontSize: '11.5px',
                            fontWeight: '700',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            backgroundColor: deadline.isUrgent ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                            color: deadline.isUrgent ? '#ef4444' : 'var(--text-secondary)',
                            border: `1px solid ${deadline.isUrgent ? 'rgba(239, 68, 68, 0.25)' : 'var(--border-color)'}`
                          }}
                        >
                          ⏳ {deadline.text} ({tender.due_date ? tender.due_date.split(' ')[0] : 'N/A'})
                        </span>
                      </div>
                    </div>

                    {/* Title & Authority Row */}
                    <div>
                      <h4
                        onClick={() => openTenderDetails(tender)}
                        style={{
                          margin: '0 0 6px 0',
                          fontSize: '15px',
                          fontWeight: '700',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          lineHeight: '1.4'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--primary)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                      >
                        {tender.product_name_as_per_tender || tender.title}
                      </h4>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {tender.authority && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Building size={13} /> {tender.authority}
                          </span>
                        )}
                        {(tender.location || tender.place || tender.state) && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <MapPin size={13} /> {[tender.location, tender.place, tender.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                          </span>
                        )}
                        {(tender.sector || tender.vertical_name) && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Tag size={13} /> {[tender.sector, tender.vertical_name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ── REQUIRED FIELDS & SPECIFICATION PARAMETERS GRID ── */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '8px',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--bg-app)',
                        border: '1px solid var(--border-color)',
                        fontSize: '12px'
                      }}
                    >
                      {/* Bid Quantity & Quoted Quantity */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Package size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-muted)' }}>Bid Qty:</span>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          {(tender.bid_qty != null || tender.bidQty != null) ? (tender.bid_qty ?? tender.bidQty) : 'N/A'}
                        </strong>
                        {(tender.quoted_qty != null || tender.quotedQty != null) && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                            (Quoted: {tender.quoted_qty ?? tender.quotedQty})
                          </span>
                        )}
                      </div>

                      {/* EMD Requirement */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CreditCard size={14} style={{ color: isEmdExempt ? '#10b981' : '#ec4899', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-muted)' }}>EMD:</span>
                        {isEmdExempt ? (
                          <span style={{ color: '#10b981', fontWeight: '700' }}>Exempt (₹0)</span>
                        ) : (
                          <strong style={{ color: 'var(--text-primary)' }}>
                            {formatCost(tender.emd, tender.emd_raw)}
                          </strong>
                        )}
                        {!isEmdExempt && tender.payment_status && tender.payment_status !== 'None' && (
                          <span style={{
                            fontSize: '10px',
                            fontWeight: '600',
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: tender.payment_status === 'Approved' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: tender.payment_status === 'Approved' ? '#10b981' : '#f59e0b'
                          }}>
                            {tender.payment_status}
                          </span>
                        )}
                      </div>

                      {/* Document Fee */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <FileText size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-muted)' }}>Doc Fee:</span>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          {tender.document_fee ? formatCost(tender.document_fee, tender.document_fee_raw) : 'Free / Nil'}
                        </strong>
                      </div>

                      {/* Tender Opening Date */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Calendar size={14} style={{ color: '#3b82f6', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-muted)' }}>Opening:</span>
                        <strong style={{ color: 'var(--text-primary)' }}>
                          {tender.opening_date ? tender.opening_date.split(' ')[0] : 'N/A'}
                        </strong>
                      </div>

                      {/* Publish / Discovery Date */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Clock size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-muted)' }}>Published:</span>
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {tender.publish_date ? tender.publish_date.split(' ')[0] : (tender.start_date ? tender.start_date.split(' ')[0] : 'N/A')}
                        </span>
                      </div>

                      {/* Tech Spec Status & Compliance */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ShieldCheck size={14} style={{ color: tender.spec_verification_status === 'Approved' ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-muted)' }}>Specs:</span>
                        <span style={{
                          fontWeight: '600',
                          color: tender.spec_verification_status === 'Approved' ? '#10b981' : tender.spec_verification_status === 'Rejected' ? '#ef4444' : 'var(--text-primary)'
                        }}>
                          {tender.spec_compliance_type ? (
                            tender.spec_compliance_type === 'ALL_COMPLY' ? 'All Comply ✓' : 'Deviations ⚠️'
                          ) : (
                            tender.spec_verification_status && tender.spec_verification_status !== 'None' ? tender.spec_verification_status : 'Not Started'
                          )}
                        </span>
                      </div>

                      {/* Dual-Track Pricing Route & Final Price (if in Step 5 or beyond) */}
                      {stage.stageNumber >= 5 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Calculator size={14} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-muted)' }}>Pricing:</span>
                          {tender.mis_final_price ? (
                            <strong style={{ color: '#10b981' }}>
                              ₹ {Number(tender.mis_final_price).toLocaleString('en-IN')} (MIS ✓)
                            </strong>
                          ) : canViewTpcPrice && tender.tpc_purchase_price ? (
                            <span style={{ color: '#8b5cf6', fontWeight: '600' }}>
                              TPC: ₹{Number(tender.tpc_purchase_price).toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span style={{ color: '#f59e0b', fontWeight: '600' }}>
                              {tender.pricing_route ? `${tender.pricing_route} Route` : 'Pending'}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Loss Reason if Lost */}
                      {flags.isLost && tender.loss_reason && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', gridColumn: '1 / -1' }}>
                          <XCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                          <span style={{ color: '#ef4444', fontWeight: '700' }}>Loss Reason:</span>
                          <span style={{ color: 'var(--text-primary)', fontStyle: 'italic' }}>{tender.loss_reason}</span>
                        </div>
                      )}
                    </div>

                    {/* 7-Stage Visual Pipeline Stepper */}
                    <div style={{
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '10px',
                      padding: '12px 16px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Current Workflow Stage: <strong style={{ color: stage.statusColor }}>{stage.stageName}</strong>
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                          {stage.progressPercent}% Complete
                        </span>
                      </div>

                      {/* Stepper track */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', padding: '0 6px' }}>
                        <div style={{ position: 'absolute', top: '12px', left: '16px', right: '16px', height: '2px', backgroundColor: 'var(--border-color)', zIndex: 0 }} />
                        <div style={{
                          position: 'absolute',
                          top: '12px',
                          left: '16px',
                          width: `${stage.progressPercent}%`,
                          height: '2px',
                          backgroundColor: stage.isWon ? '#10b981' : stage.isLost ? '#ef4444' : 'var(--primary)',
                          zIndex: 0,
                          transition: 'width 0.3s ease'
                        }} />

                        {PIPELINE_STEPS.map((step, idx) => {
                          const isDone = stage.stepCompleted[idx];
                          const isCurrent = stage.currentStepIndex === idx && !stage.isWon && !stage.isLost;
                          return (
                            <div key={step.num} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, minWidth: '44px' }}>
                              <div style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                backgroundColor: isDone ? '#10b981' : isCurrent ? 'var(--primary)' : 'var(--bg-card)',
                                border: isDone ? '2px solid #10b981' : isCurrent ? '2px solid var(--primary)' : '2px solid var(--border-color)',
                                color: isDone || isCurrent ? '#fff' : 'var(--text-muted)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '10px',
                                fontWeight: '700',
                                boxShadow: isCurrent ? '0 0 10px rgba(99, 102, 241, 0.45)' : undefined
                              }}>
                                {isDone ? '✓' : step.num}
                              </div>
                              <span style={{
                                fontSize: '9.5px',
                                marginTop: '4px',
                                fontWeight: isCurrent ? '700' : isDone ? '600' : '500',
                                color: isCurrent ? 'var(--text-primary)' : isDone ? 'var(--text-primary)' : 'var(--text-muted)',
                                textAlign: 'center',
                                whiteSpace: 'nowrap'
                              }}>
                                {step.short}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Step 5 Dual-Track Progress Detail */}
                      {stage.stageNumber === 5 && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          flexWrap: 'wrap',
                          marginTop: '12px',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          background: 'rgba(139, 92, 246, 0.08)',
                          border: '1px solid rgba(139, 92, 246, 0.25)',
                          fontSize: '11.5px'
                        }}>
                          <span style={{ fontWeight: '700', color: '#8b5cf6' }}>Dual-Track Status:</span>
                          <span style={{ color: stage.isPricingApproved ? '#10b981' : '#f59e0b', fontWeight: '600' }}>
                            Track A (Commercial Price): {stage.isPricingApproved ? 'Approved ✓' : 'Pending ⏳'}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>·</span>
                          <span style={{ color: stage.isDocsVerified ? '#10b981' : '#f59e0b', fontWeight: '600' }}>
                            Track B (Doc Verification): {stage.isDocsVerified ? 'Approved ✓' : 'Pending ⏳'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Blocker / Next Action Box + Actions Row */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px',
                      padding: '12px 16px',
                      borderRadius: '10px',
                      background: stage.badgeBg,
                      border: `1px solid ${stage.badgeBorder}`
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 280px' }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'var(--bg-card)',
                          color: stage.statusColor,
                          flexShrink: 0
                        }}>
                          {flags.needsAction ? <AlertCircle size={18} /> : <Clock size={18} />}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: stage.statusColor }}>
                            {stage.actionTitle}
                          </span>
                          <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            {stage.actionDesc}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
                        <button
                          className="btn btn-primary"
                          onClick={() => openTenderDetails(tender)}
                          style={{
                            padding: '8px 16px',
                            fontSize: '12.5px',
                            fontWeight: '700',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            backgroundColor: flags.needsAction ? '#4f46e5' : undefined,
                            boxShadow: flags.needsAction ? '0 2px 8px rgba(79, 70, 229, 0.25)' : undefined
                          }}
                        >
                          <span>{stage.actionButtonText}</span>
                          <ChevronRight size={14} />
                        </button>

                        <button
                          className="btn btn-secondary btn-icon-only"
                          onClick={() => setMenuOpenTenderId(menuOpenTenderId === tender.id ? null : tender.id)}
                          style={{ padding: '8px' }}
                        >
                          <MoreVertical size={16} />
                        </button>

                        {/* Popover Action Menu */}
                        {menuOpenTenderId === tender.id && (
                          <div
                            style={{
                              position: 'absolute',
                              top: '100%',
                              right: 0,
                              marginTop: '6px',
                              backgroundColor: 'var(--bg-surface)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '10px',
                              boxShadow: 'var(--shadow-lg)',
                              padding: '6px',
                              zIndex: 100,
                              minWidth: '180px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px'
                            }}
                          >
                            <button
                              onClick={() => {
                                setMenuOpenTenderId(null);
                                openTenderDetails(tender);
                              }}
                              style={{
                                textAlign: 'left',
                                padding: '8px 12px',
                                fontSize: '12px',
                                fontWeight: '600',
                                borderRadius: '6px',
                                color: 'var(--text-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-app)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <ExternalLink size={14} /> Open Workflow
                            </button>

                            <button
                              onClick={() => {
                                setMenuOpenTenderId(null);
                                navigator.clipboard.writeText(tender.id);
                                showToast(`Copied Tender ID: ${tender.id}`, 'success');
                              }}
                              style={{
                                textAlign: 'left',
                                padding: '8px 12px',
                                fontSize: '12px',
                                fontWeight: '600',
                                borderRadius: '6px',
                                color: 'var(--text-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-app)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <Tag size={14} /> Copy Tender ID
                            </button>

                            {tender.status === 'New' && (
                              <button
                                onClick={() => {
                                  setMenuOpenTenderId(null);
                                  handleStatusChange(tender.id, 'Participating');
                                }}
                                style={{
                                  textAlign: 'left',
                                  padding: '8px 12px',
                                  fontSize: '12px',
                                  fontWeight: '600',
                                  borderRadius: '6px',
                                  color: '#10b981',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-app)'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                              >
                                <CheckCircle2 size={14} /> Accept Bid
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {filteredTenders.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  padding: '14px 18px',
                  borderRadius: '10px',
                  backgroundColor: 'var(--bg-app)',
                  border: '1px solid var(--border-color)',
                  marginTop: '10px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Showing <strong style={{ color: 'var(--text-primary)' }}>{Math.min((safeCurrentPage - 1) * pageSize + 1, filteredTenders.length)}</strong> - <strong style={{ color: 'var(--text-primary)' }}>{Math.min(safeCurrentPage * pageSize, filteredTenders.length)}</strong> of <strong style={{ color: 'var(--text-primary)' }}>{filteredTenders.length}</strong> tenders
                  </span>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Per page:</span>
                    <select
                      className="filter-select"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setCurrentPage(1)}
                    disabled={safeCurrentPage === 1}
                    style={{ padding: '6px 10px', fontSize: '12px', opacity: safeCurrentPage === 1 ? 0.4 : 1 }}
                    title="First Page"
                  >
                    &laquo;
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={safeCurrentPage === 1}
                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', opacity: safeCurrentPage === 1 ? 0.4 : 1 }}
                  >
                    <ChevronLeft size={14} /> Prev
                  </button>

                  <span style={{ fontSize: '13px', fontWeight: '600', padding: '0 8px', color: 'var(--text-primary)' }}>
                    Page {safeCurrentPage} of {totalPages}
                  </span>

                  <button
                    className="btn btn-secondary"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={safeCurrentPage >= totalPages}
                    style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', opacity: safeCurrentPage >= totalPages ? 0.4 : 1 }}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={safeCurrentPage >= totalPages}
                    style={{ padding: '6px 10px', fontSize: '12px', opacity: safeCurrentPage >= totalPages ? 0.4 : 1 }}
                    title="Last Page"
                  >
                    &raquo;
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
