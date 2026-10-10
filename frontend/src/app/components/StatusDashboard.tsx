"use client";

import React, { useState, useMemo } from 'react';
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
  ChevronRight,
  ChevronLeft,
  DollarSign,
  Calendar,
  MapPin,
  Tag,
  Zap,
  Trophy,
  CreditCard,
  Eye,
  Shield,
  ShieldCheck,
  Calculator,
  UploadCloud,
  Filter,
  MoreVertical,
  ExternalLink,
  ArrowUpDown,
  ClipboardCheck,
  TrendingUp,
  RefreshCw,
  Layers,
  SlidersHorizontal
} from 'lucide-react';
import { Tender } from '@/lib/db';
import { PIPELINE_STEPS, resolveTenderStageDetails } from '@/lib/tenderStatus';

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
  refreshing
}: StatusDashboardProps) {
  // Navigation & Filtering States
  const [selectedCardKey, setSelectedCardKey] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'OVERVIEW' | 'PIPELINE' | 'ACTION_REQUIRED'>('ALL');
  const [executiveFilter, setExecutiveFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [urgencyFilter, setUrgencyFilter] = useState<'' | 'today' | '3days' | '7days' | 'high_value'>('');
  const [sortBy, setSortBy] = useState<'due_date' | 'estimated_cost' | 'scraped_at'>('due_date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [menuOpenTenderId, setMenuOpenTenderId] = useState<string | null>(null);

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

  // Process all tenders with stages and operational flags
  const tendersWithStage = useMemo(() => {
    return scopedTenders.map(t => {
      const stage = resolveTenderStageDetails(t, currentUser?.role);

      const isWon = stage.isWon;
      const isLost = stage.isLost;
      const isDeclined = stage.isDeclined;
      const isSubmitted = stage.isSubmitted;
      const isSubmissionPending = stage.stageKey === 'SUBMISSION_PENDING';
      const isReadyToSubmit = stage.stageKey === 'READY_TO_SUBMIT';
      const isEmdPending = stage.stageKey === 'EMD_PENDING';
      const isEmdReqReady = stage.stageKey === 'EMD_REQ_READY';
      const isDocVerificationPending = stage.stageKey === 'DOC_VERIFICATION';
      const isDocRejected = stage.stageKey === 'DOCS_REJECTED';
      const isDocsPrep = stage.stageKey === 'DOCS_PREP';
      const isMisPricingPending = stage.stageKey === 'MIS_PRICING';
      const isTpcPricingPending = stage.stageKey === 'TPC_PRICING';
      const isSpecClearancePending = stage.stageKey === 'SPEC_CLEARANCE_PENDING';
      const isSpecRejected = stage.stageKey === 'SPEC_REJECTED';
      const isSpecNotStarted = stage.stageKey === 'SPEC_NOT_STARTED';
      const isNew = stage.stageKey === 'NEW_UNREVIEWED';

      const isClosingSoon = Boolean(t.due_date && t.due_date >= todayIST && new Date(t.due_date + 'T00:00:00+05:30') <= sevenDaysLater && !isSubmitted && !isWon && !isLost);
      const isClosing3Days = Boolean(t.due_date && t.due_date >= todayIST && new Date(t.due_date + 'T00:00:00+05:30') <= threeDaysLater && !isSubmitted && !isWon && !isLost);
      const isClosingToday = Boolean(t.due_date && t.due_date.startsWith(todayIST) && !isSubmitted && !isWon && !isLost);
      const isOverdue = Boolean(t.due_date && t.due_date < todayIST && !isSubmitted && !isWon && !isLost);

      // High value tender (> 1 Crore)
      const isHighValue = (t.estimated_cost || 0) >= 10000000;

      // Tender marked as action required
      const needsAction = stage.needsAction || isClosing3Days || isDocRejected || isSpecRejected;

      // New today check (scraped today or created today)
      const isNewToday = isNew && (t.scraped_at?.startsWith(todayIST) || t.entry_date?.startsWith(todayIST) || !isOverdue);

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
          isEmdReqReady,
          isDocVerificationPending,
          isDocRejected,
          isDocsPrep,
          isMisPricingPending,
          isTpcPricingPending,
          isSpecClearancePending,
          isSpecRejected,
          isSpecNotStarted,
          isNew,
          isNewToday,
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

  // Stage Cards Definitions (First 4 Overview Cards + 8 Workflow Pipeline Stage Cards = Exactly 12 Cards)
  const stageCards = useMemo(() => {
    const totalCount = scopedTenders.length;
    const newTodayCount = tendersWithStage.filter(i => i.flags.isNewToday || i.flags.isNew).length;
    const closingSoonCount = tendersWithStage.filter(i => i.flags.isClosingSoon).length;
    const actionRequiredCount = tendersWithStage.filter(i => i.flags.needsAction).length;

    // 8 Pipeline Stages
    const stage1Count = tendersWithStage.filter(i => i.stage.stageNumber === 1 || (i.stage.currentStepIndex === 0 && i.tender.status === 'Participating')).length;
    const stage2Count = tendersWithStage.filter(i => i.stage.stageNumber === 2).length;
    const stage3Count = tendersWithStage.filter(i => i.stage.stageNumber === 3).length;
    const stage4Count = tendersWithStage.filter(i => i.stage.stageNumber === 4).length;
    const stage5Count = tendersWithStage.filter(i => i.stage.stageNumber === 5).length;
    const stage6Count = tendersWithStage.filter(i => i.stage.stageNumber === 6).length;
    const stage7Count = tendersWithStage.filter(i => i.stage.stageNumber === 7).length;
    const stage8Count = tendersWithStage.filter(i => i.stage.stageNumber === 8).length;

    return [
      // ── ROW 1: KEY OVERVIEW & URGENCY (FIRST 4 CARDS) ──
      {
        key: 'TOTAL',
        title: 'Total Tenders',
        group: 'OVERVIEW',
        count: totalCount,
        trend: 'all active bids',
        subText: 'All bids in your view',
        icon: FileText,
        iconColor: '#6366f1',
        bgColor: 'rgba(99, 102, 241, 0.1)',
        filterFn: () => true
      },
      {
        key: 'NEW_TODAY',
        title: 'New Today',
        group: 'OVERVIEW',
        count: newTodayCount,
        trend: 'new bids today',
        subText: 'Intake: Decision needed',
        icon: Zap,
        iconColor: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.1)',
        filterFn: (i: any) => i.flags.isNewToday || i.flags.isNew
      },
      {
        key: 'CLOSING_SOON',
        title: 'Closing Soon',
        group: 'OVERVIEW',
        count: closingSoonCount,
        trend: 'within 7 days',
        subText: 'Urgent deadline approaching',
        icon: Clock,
        iconColor: '#f97316',
        bgColor: 'rgba(249, 115, 22, 0.1)',
        filterFn: (i: any) => i.flags.isClosingSoon
      },
      {
        key: 'ACTION_REQUIRED',
        title: 'Action Required',
        group: 'OVERVIEW',
        count: actionRequiredCount,
        trend: 'bids need attention',
        subText: 'Waiting on immediate action',
        icon: AlertTriangle,
        iconColor: '#ef4444',
        bgColor: 'rgba(239, 68, 68, 0.1)',
        isAlert: true,
        filterFn: (i: any) => i.flags.needsAction
      },

      // ── 8 TENDER PIPELINE STAGES ──
      {
        key: 'STAGE_1_CLEARANCE',
        title: '1. Clearance',
        group: 'PIPELINE',
        count: stage1Count,
        trend: 'Stage 1 of 8',
        subText: 'Technical spec clearance',
        icon: ShieldCheck,
        iconColor: '#8b5cf6',
        bgColor: 'rgba(139, 92, 246, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 1 || (i.stage.currentStepIndex === 0 && i.tender.status === 'Participating')
      },
      {
        key: 'STAGE_2_TPC',
        title: '2. TPC Quote',
        group: 'PIPELINE',
        count: stage2Count,
        trend: 'Stage 2 of 8',
        subText: 'OEM purchase quote',
        icon: Tag,
        iconColor: '#ec4899',
        bgColor: 'rgba(236, 72, 153, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 2
      },
      {
        key: 'STAGE_3_MIS',
        title: '3. MIS Price',
        group: 'PIPELINE',
        count: stage3Count,
        trend: 'Stage 3 of 8',
        subText: 'Final margin price setting',
        icon: Calculator,
        iconColor: '#f59e0b',
        bgColor: 'rgba(245, 158, 11, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 3
      },
      {
        key: 'STAGE_4_DOCS_PREP',
        title: '4. Docs Prep',
        group: 'PIPELINE',
        count: stage4Count,
        trend: 'Stage 4 of 8',
        subText: 'Bid documents preparation',
        icon: FileText,
        iconColor: '#06b6d4',
        bgColor: 'rgba(6, 182, 212, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 4
      },
      {
        key: 'STAGE_5_VERIFICATION',
        title: '5. Verification',
        group: 'PIPELINE',
        count: stage5Count,
        trend: 'Stage 5 of 8',
        subText: 'Document review & approval',
        icon: CheckCircle2,
        iconColor: '#10b981',
        bgColor: 'rgba(16, 185, 129, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 5
      },
      {
        key: 'STAGE_6_EMD',
        title: '6. EMD Payment',
        group: 'PIPELINE',
        count: stage6Count,
        trend: 'Stage 6 of 8',
        subText: 'EMD fee approval & payment',
        icon: CreditCard,
        iconColor: '#d97706',
        bgColor: 'rgba(217, 119, 6, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 6
      },
      {
        key: 'STAGE_7_SUBMISSION',
        title: '7. Final Submission',
        group: 'PIPELINE',
        count: stage7Count,
        trend: 'Stage 7 of 8',
        subText: 'Final filing & audit',
        icon: UploadCloud,
        iconColor: '#3b82f6',
        bgColor: 'rgba(59, 130, 246, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 7
      },
      {
        key: 'STAGE_8_OUTCOME',
        title: '8. Outcome',
        group: 'PIPELINE',
        count: stage8Count,
        trend: 'Stage 8 of 8',
        subText: 'Under evaluation, Won & Lost',
        icon: Trophy,
        iconColor: '#a855f7',
        bgColor: 'rgba(168, 85, 247, 0.1)',
        filterFn: (i: any) => i.stage.stageNumber === 8
      }
    ];
  }, [tendersWithStage, scopedTenders.length]);

  // Determine which cards to show according to category filter
  const visibleCards = useMemo(() => {
    if (categoryFilter === 'ALL') return stageCards;
    if (categoryFilter === 'OVERVIEW') return stageCards.filter(c => c.group === 'OVERVIEW');
    if (categoryFilter === 'PIPELINE') return stageCards.filter(c => c.group === 'PIPELINE');
    if (categoryFilter === 'ACTION_REQUIRED') return stageCards.filter(c => c.key === 'ACTION_REQUIRED');
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
          tender.sector?.toLowerCase().includes(q)
        );
      });
    }

    // Apply Urgency Filter
    if (urgencyFilter) {
      if (urgencyFilter === 'today') {
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
  }, [tendersWithStage, activeCard, searchQuery, urgencyFilter, sortBy, sortOrder]);

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
    if (!dueDateStr) return { text: 'No deadline', isUrgent: false };
    try {
      const clean = dueDateStr.split(' ')[0].split('T')[0];
      const due = new Date(clean + 'T00:00:00+05:30');
      const diffTime = due.getTime() - parsedToday.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, isUrgent: true, isOverdue: true };
      if (diffDays === 0) return { text: 'Due today', isUrgent: true };
      if (diffDays === 1) return { text: '1 day left', isUrgent: true };
      return { text: `${diffDays} days left`, isUrgent: diffDays <= 3 };
    } catch {
      return { text: 'Active', isUrgent: false };
    }
  };

  const handleCardClick = (key: string) => {
    if (selectedCardKey === key) {
      // Toggle off to show all
      setSelectedCardKey('');
    } else {
      setSelectedCardKey(key);
    }
  };

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
          padding: '18px 20px',
          border: isSelected
            ? `2px solid ${card.iconColor}`
            : card.isAlert
            ? '1.5px solid #f87171'
            : '1px solid var(--border-color)',
          boxShadow: isSelected
            ? `0 0 14px ${card.bgColor}`
            : 'var(--shadow-sm)',
          background: card.isAlert && !isSelected
            ? 'rgba(239, 68, 68, 0.035)'
            : 'var(--bg-card)',
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
          e.currentTarget.style.boxShadow = isSelected ? `0 0 14px ${card.bgColor}` : 'var(--shadow-sm)';
        }}
      >
        {/* Selected indicator pin */}
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

        {/* Left Side: Icon & Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
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
            <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)' }}>
              {card.title}
            </span>
            <div style={{ fontSize: '26px', fontWeight: '800', color: 'var(--text-primary)', lineHeight: '1.2', margin: '2px 0' }}>
              {card.count}
            </div>
            <span style={{ fontSize: '11px', color: card.iconColor, fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span style={{ fontSize: '12px' }}>↑</span> {card.trend}
            </span>
          </div>
        </div>

        {/* Right Side: Chevron */}
        <div style={{ color: isSelected ? card.iconColor : 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          <ChevronRight size={18} style={{ transform: isSelected ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease' }} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      
      {/* ── TOP CONTROLS & HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)', margin: '0 0 4px 0', letterSpacing: '-0.3px' }}>
            Tender Status & Overview
          </h2>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
            Track and manage all your tenders at a glance across every pipeline stage
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Executive Switcher for Admin & MIS Team */}
          {(currentUser?.role === 'Admin' || currentUser?.role === 'MIS Team') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                className="filter-select"
                value={executiveFilter}
                onChange={(e) => setExecutiveFilter(e.target.value)}
                style={{
                  minWidth: '170px',
                  background: 'var(--bg-card)',
                  borderColor: executiveFilter ? 'var(--primary)' : 'var(--border-color)',
                  fontWeight: '600',
                  fontSize: '12.5px'
                }}
              >
                <option value="">All Executives</option>
                {executives.map(exec => (
                  <option key={exec} value={exec}>{exec}</option>
                ))}
              </select>
            </div>
          )}

          {/* Category Filter Dropdown */}
          <select
            className="filter-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as any)}
            style={{
              minWidth: '160px',
              background: 'var(--bg-card)',
              fontWeight: '600',
              fontSize: '12.5px'
            }}
          >
            <option value="ALL">All Cards (12)</option>
            <option value="OVERVIEW">Overview (4 Cards)</option>
            <option value="PIPELINE">8 Pipeline Stages</option>
            <option value="ACTION_REQUIRED">Action Required Only</option>
          </select>

          {/* Refresh Button */}
          <button
            className="btn btn-secondary btn-icon-only"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh status data"
            style={{ padding: '9px 12px' }}
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── OVERVIEW (4 CARDS) & 8 PIPELINE STAGE CARDS ── */}
      {categoryFilter === 'ALL' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Row 1: Key Overview & Urgency (First 4 Cards) */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Overview Metrics
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '16px'
              }}
            >
              {stageCards.filter(c => c.group === 'OVERVIEW').map(renderCard)}
            </div>
          </div>

          {/* Rows 2 & 3: 8 Workflow Pipeline Stages */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              Workflow Pipeline Stages (1 – 8)
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '16px'
              }}
            >
              {stageCards.filter(c => c.group === 'PIPELINE').map(renderCard)}
            </div>
          </div>
        </div>
      ) : (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '16px'
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
            Dashboard &gt; <strong style={{ color: 'var(--text-primary)' }}>{activeCard ? activeCard.title : 'All Tenders'}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {activeCard && (
                <button
                  onClick={() => setSelectedCardKey('')}
                  className="btn btn-secondary btn-icon-only"
                  style={{ width: '32px', height: '32px', padding: 0 }}
                  title="Clear stage filter"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
              
              <h3 style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>{activeCard ? activeCard.title : 'All Tenders Overview'}</span>
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
              {activeCard ? activeCard.subText : 'Showing all live bids across every operational stage'}
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
              placeholder={`Search in ${activeCard ? activeCard.title.toLowerCase() : 'all'} tenders by ID, Authority, Title...`}
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

          {/* Quick Urgency Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setUrgencyFilter('')}
              className={`btn ${urgencyFilter === '' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '6px 12px', fontSize: '12px' }}
            >
              All
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

        {/* Tender Cards Listing matching the photo */}
        {filteredTenders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
            <SlidersHorizontal size={40} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
            <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '6px' }}>
              No Tenders Found in this Stage
            </h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto 16px auto' }}>
              No tenders match your current filter criteria. Try selecting another stage or clearing your search.
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {filteredTenders.map(({ tender, stage, flags }) => {
              const deadline = getDaysRemainingLabel(tender.due_date);

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

                      {/* Portal Tag */}
                      <span
                        style={{
                          fontSize: '10.5px',
                          fontWeight: '600',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          backgroundColor: tender.source === 'GeM' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                          color: tender.source === 'GeM' ? '#10b981' : '#3b82f6',
                          border: `1px solid ${tender.source === 'GeM' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)'}`
                        }}
                      >
                        {tender.source === 'GeM' ? 'GeM Portal' : 'Tender247'}
                      </span>

                      {/* Overall Status Badge */}
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
                        {tender.status}
                      </span>

                      {/* Ref No */}
                      {tender.ref_no && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Ref: {tender.ref_no}
                        </span>
                      )}

                      {/* Assigned Executive if Admin/MIS viewing */}
                      {(currentUser?.role === 'Admin' || currentUser?.role === 'MIS Team') && tender.mis_executive && (
                        <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: '600', backgroundColor: 'rgba(99, 102, 241, 0.08)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                          👤 {tender.mis_executive}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      {/* Estimated Value */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>Value:</span>
                        <span style={{ fontSize: '13.5px', fontWeight: '800', color: 'var(--text-primary)' }}>
                          {formatCost(tender.estimated_cost, tender.estimated_cost_raw)}
                        </span>
                      </div>

                      {/* Deadline Status */}
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
                      {tender.location && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <MapPin size={13} /> {tender.location}
                        </span>
                      )}
                      {tender.sector && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Tag size={13} /> {tender.sector}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 8-Stage Visual Pipeline Stepper (Horizontal bar with points) */}
                  <div style={{
                    background: 'var(--bg-app)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '12px 16px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Current Stage: <strong style={{ color: stage.statusColor }}>{stage.stageName}</strong>
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
        )}
      </section>

    </div>
  );
}
