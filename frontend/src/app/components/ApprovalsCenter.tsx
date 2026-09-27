"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  AlertCircle,
  Loader2,
  DollarSign,
  FileText,
  ClipboardCheck,
  BarChart2,
  Clock,
  X,
  Download,
  ChevronRight,
  AlertTriangle,
  Shield,
  History,
  Users,
  Filter
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApprovalSummary {
  id: number;
  tenderId: string;
  stage: string;
  stageName: string;
  requestedBy: string;
  assignedTo: string;
  status: string;
  workingPath?: string;
  emdAmount?: number;
  transferMode?: string;
  transferRefNo?: string;
  receiptFileUrl?: string;
  lossReasonExecutive?: string;
  lossReasonMis?: string;
  tpcPurchasePrice?: number;
  misFinalPrice?: number;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
  reviewerComment?: string;
  // Tender fields
  tenderRefNo?: string;
  tenderTitle?: string;
  tenderAuthority?: string;
  tenderDueDate?: string;
  tenderEstimatedCost?: number;
  tenderEmd?: number;
  tenderLocation?: string;
  tenderSector?: string;
  tenderStatus?: string;
  tenderCurrentStage?: string;
  misExecutive?: string;
}

interface ApprovalCounts {
  TOTAL?: number;
  PAYMENT_APPROVAL?: number;
  DOC_VERIFICATION?: number;
  SUBMISSION_PENDING?: number;
  WIN_LOSS_PENDING?: number;
  SPEC_CLEARANCE?: number;
  TPC_PRICING?: number;
  MIS_PRICING?: number;
  statusCounts?: {
    TOTAL?: number;
    PENDING?: number;
    APPROVED?: number;
    REJECTED?: number;
    CHANGES_REQUESTED?: number;
    HISTORY?: number;
  };
  [key: string]: any;
}

interface ReviewModalState {
  open: boolean;
  approval: ApprovalSummary | null;
  action: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED' | null;
  outcome?: 'Won' | 'Lost' | null;
  comment: string;
  lossReasonMis: string;
  tpcPurchasePrice: string;
  misFinalPrice: string;
  loading: boolean;
  error: string;
}

interface Props {
  currentUser: { username: string; role: string };
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
  onCountsChange?: (total: number) => void;
  showToast: (message: string, type: 'success' | 'error') => void;
}

// ── Stage & Team Config ───────────────────────────────────────────────────────

const PENDING_STAGE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  ALL:                 { label: 'All Pending',        icon: <ClipboardCheck size={14} /> },
  SPEC_CLEARANCE:      { label: 'Spec Clearance',     icon: <AlertTriangle size={14} /> },
  TPC_PRICING:         { label: 'TPC Pricing',        icon: <DollarSign size={14} /> },
  MIS_PRICING:         { label: 'MIS Pricing',        icon: <FileText size={14} /> },
  DOC_VERIFICATION:    { label: 'Bid Docs Approval',  icon: <FileText size={14} /> },
  PAYMENT_APPROVAL:    { label: 'EMD Payment',        icon: <DollarSign size={14} /> },
  SUBMISSION_PENDING:  { label: 'Submission Confirm', icon: <CheckCircle2 size={14} /> },
  WIN_LOSS_PENDING:    { label: 'Win / Loss Outcome', icon: <BarChart2 size={14} /> },
};

const HISTORY_STAGE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  ALL:                 { label: 'All Stages',         icon: <ClipboardCheck size={14} /> },
  SPEC_CLEARANCE:      { label: 'Spec Clearance',     icon: <AlertTriangle size={14} /> },
  TPC_PRICING:         { label: 'TPC Pricing',        icon: <DollarSign size={14} /> },
  MIS_PRICING:         { label: 'MIS Pricing',        icon: <FileText size={14} /> },
  DOC_VERIFICATION:    { label: 'Bid Docs Approval',  icon: <FileText size={14} /> },
  PAYMENT_APPROVAL:    { label: 'EMD Payment',        icon: <DollarSign size={14} /> },
  SUBMISSION_PENDING:  { label: 'Submission Confirm', icon: <CheckCircle2 size={14} /> },
  WIN_LOSS_PENDING:    { label: 'Win / Loss Outcome', icon: <BarChart2 size={14} /> },
};

const STAGE_CONFIG = PENDING_STAGE_CONFIG;

const TEAMS_OPTIONS = [
  { id: 'ALL', label: 'All Teams' },
  { id: 'misteam', label: 'MIS Team' },
  { id: 'clearance', label: 'Clearance Team' },
  { id: 'tpc', label: 'TPC Pricing Team' },
];

const ROLES_OPTIONS = [
  { id: 'ALL', label: 'All Requesters' },
  { id: 'executive', label: 'Executive' },
  { id: 'clearance', label: 'Clearance Team' },
  { id: 'tpc', label: 'TPC Team' },
  { id: 'admin', label: 'Admin' },
];

// ── Helper ────────────────────────────────────────────────────────────────────

function formatCurrency(val?: number | null): string {
  if (val == null) return '—';
  return '₹' + val.toLocaleString('en-IN');
}

function formatDate(val?: string | null): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return val; }
}

function timeAgo(val?: string | null): string {
  if (!val) return '—';
  const diff = Date.now() - new Date(val).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isSafeUrl(url?: string | null): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('/documents/') ||
         trimmed.startsWith('/uploads/') ||
         trimmed.startsWith('https://') ||
         trimmed.startsWith('http://');
}


async function parseJsonSafely(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: res.ok ? 'Invalid response format' : `Server returned status ${res.status}` };
  }
}

function normalizeApproval(a: any): ApprovalSummary {
  return {
    id: a.id,
    tenderId: String(a.tenderId || a.tender_id || ''),
    stage: a.stage || '',
    stageName: a.stageName || a.stage_name || a.stage || '',
    requestedBy: a.requestedBy || a.requested_by || 'Unknown',
    assignedTo: a.assignedTo || a.assigned_to || '',
    status: a.status || 'PENDING',
    workingPath: a.workingPath || a.working_path || undefined,
    emdAmount: a.emdAmount != null ? Number(a.emdAmount) : (a.emd_amount != null ? Number(a.emd_amount) : undefined),
    transferMode: a.transferMode || a.transfer_mode || undefined,
    transferRefNo: a.transferRefNo || a.transfer_ref_no || undefined,
    receiptFileUrl: a.receiptFileUrl || a.receipt_file_url || undefined,
    lossReasonExecutive: a.lossReasonExecutive || a.loss_reason_executive || undefined,
    lossReasonMis: a.lossReasonMis || a.loss_reason_mis || undefined,
    tpcPurchasePrice: a.tpcPurchasePrice != null ? Number(a.tpcPurchasePrice) : (a.tpc_purchase_price != null ? Number(a.tpc_purchase_price) : undefined),
    misFinalPrice: a.misFinalPrice != null ? Number(a.misFinalPrice) : (a.mis_final_price != null ? Number(a.mis_final_price) : undefined),
    createdAt: a.createdAt || a.created_at || new Date().toISOString(),
    updatedAt: a.updatedAt || a.updated_at || new Date().toISOString(),
    reviewedBy: a.reviewedBy || a.reviewed_by || undefined,
    reviewerComment: a.reviewerComment || a.reviewer_comment || undefined,
    tenderRefNo: a.tenderRefNo || a.tender_ref_no || '',
    tenderTitle: a.tenderTitle || a.tender_title || (a.tenderId || a.tender_id ? `Tender #${a.tenderId || a.tender_id}` : 'Untitled Tender'),
    tenderAuthority: a.tenderAuthority || a.tender_authority || '',
    tenderDueDate: a.tenderDueDate || a.tender_due_date || '',
    tenderEstimatedCost: a.tenderEstimatedCost != null ? Number(a.tenderEstimatedCost) : (a.tender_estimated_cost != null ? Number(a.tender_estimated_cost) : undefined),
    tenderEmd: a.tenderEmd != null ? Number(a.tenderEmd) : (a.tender_emd != null ? Number(a.tender_emd) : undefined),
    tenderLocation: a.tenderLocation || a.tender_location || '',
    tenderSector: a.tenderSector || a.tender_sector || '',
    tenderStatus: a.tenderStatus || a.tender_status || '',
    tenderCurrentStage: a.tenderCurrentStage || a.tender_current_stage || '',
    misExecutive: a.misExecutive || a.mis_executive || ''
  };
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ApprovalsCenter({ currentUser, fetchWithAuth, onCountsChange, showToast }: Props) {
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [counts, setCounts] = useState<ApprovalCounts>({});
  const [pendingStageCounts, setPendingStageCounts] = useState<ApprovalCounts>({});
  const [historyStageCounts, setHistoryStageCounts] = useState<ApprovalCounts>({});
  const [teamCounts, setTeamCounts] = useState<Record<string, number>>({});
  const [roleCounts, setRoleCounts] = useState<Record<string, number>>({});

  const [activeStage, setActiveStage] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string>('ALL');
  const [selectedRole, setSelectedRole] = useState<string>('ALL');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const userRole = (currentUser?.role || '').toLowerCase();
  const isAdmin = userRole === 'admin';

  const [adminTab, setAdminTab] = useState<'PENDING' | 'HISTORY'>('PENDING');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'>('ALL');
  const [statusCounts, setStatusCounts] = useState<{
    TOTAL: number;
    PENDING: number;
    APPROVED: number;
    REJECTED: number;
    CHANGES_REQUESTED: number;
    HISTORY: number;
  }>({ TOTAL: 0, PENDING: 0, APPROVED: 0, REJECTED: 0, CHANGES_REQUESTED: 0, HISTORY: 0 });

  const hasAutoSwitchedRef = useRef(false);

  const [modal, setModal] = useState<ReviewModalState>({
    open: false, approval: null, action: null,
    comment: '', lossReasonMis: '', tpcPurchasePrice: '', misFinalPrice: '',
    loading: false, error: ''
  });

  // Stable refs for prop functions to prevent infinite re-render loops
  const fetchWithAuthRef = useRef(fetchWithAuth);
  fetchWithAuthRef.current = fetchWithAuth;
  const onCountsChangeRef = useRef(onCountsChange);
  onCountsChangeRef.current = onCountsChange;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchCounts = useCallback(async (tabToUse?: 'PENDING' | 'HISTORY') => {
    try {
      const currentTab = tabToUse !== undefined ? tabToUse : adminTab;
      const statusParam = (isAdmin && currentTab === 'HISTORY') ? 'HISTORY' : 'PENDING';
      const res = await fetchWithAuthRef.current(`/api/approvals/counts?status=${statusParam}`);
      const data = await parseJsonSafely(res);
      if (data.success) {
        setCounts(data.counts || {});
        if (data.pendingCounts) setPendingStageCounts(data.pendingCounts);
        if (data.historyCounts) setHistoryStageCounts(data.historyCounts);
        if (data.statusCounts) {
          setStatusCounts(data.statusCounts);
          // If pending queue has 0 items and history has items on first load, auto-switch to HISTORY for Admin only
          if (isAdmin && !hasAutoSwitchedRef.current && (data.statusCounts.PENDING ?? 0) === 0 && (data.statusCounts.HISTORY ?? 0) > 0) {
            hasAutoSwitchedRef.current = true;
            setAdminTab('HISTORY');
            fetchApprovals('ALL', search, 'HISTORY', 'ALL', selectedTeam, selectedRole, false);
          }
        }
        if (data.teamCounts) setTeamCounts(data.teamCounts);
        if (data.roleCounts) setRoleCounts(data.roleCounts);
        onCountsChangeRef.current?.(data.statusCounts?.PENDING ?? data.pendingCounts?.TOTAL ?? 0);
      }
    } catch (e) {
      console.error('[ApprovalsCenter] Failed to fetch counts:', e);
    }
  }, [adminTab, isAdmin, search, selectedTeam, selectedRole]);

  const fetchApprovals = useCallback(async (
    stageToFetch?: string,
    searchTerm?: string,
    currentAdminTab?: 'PENDING' | 'HISTORY',
    currentHistoryFilter?: string,
    teamToFetch?: string,
    roleToFetch?: string,
    showLoader = true
  ) => {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    try {
      const params = new URLSearchParams();
      const currentStage = stageToFetch !== undefined ? stageToFetch : activeStage;
      const currentSearch = searchTerm !== undefined ? searchTerm : search;
      const tab = currentAdminTab !== undefined ? currentAdminTab : adminTab;
      const histFilter = currentHistoryFilter !== undefined ? currentHistoryFilter : historyStatusFilter;
      const currentTeam = teamToFetch !== undefined ? teamToFetch : selectedTeam;
      const currentRole = roleToFetch !== undefined ? roleToFetch : selectedRole;

      if (currentStage !== 'ALL') params.set('stage', currentStage);
      if (currentSearch.trim()) params.set('search', currentSearch.trim());

      if (isAdmin) {
        if (currentTeam !== 'ALL') params.set('team', currentTeam);
        if (currentRole !== 'ALL') params.set('role', currentRole);
        if (tab === 'PENDING') {
          params.set('status', 'PENDING');
        } else {
          params.set('status', histFilter === 'ALL' ? 'HISTORY' : histFilter);
        }
      } else {
        // Keep operational teams (MIS Team, Clearance, TPC) in standard pending workflow
        params.set('status', 'PENDING');
      }

      const res = await fetchWithAuthRef.current(`/api/approvals/pending?${params.toString()}`);
      const data = await parseJsonSafely(res);
      if (data.success) {
        const rawList = Array.isArray(data.approvals) ? data.approvals : [];
        setApprovals(rawList.map(normalizeApproval));
      } else {
        showToastRef.current(data.error || 'Failed to load approvals', 'error');
      }
    } catch (e) {
      showToastRef.current('Unable to connect to server', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeStage, search, adminTab, historyStatusFilter, selectedTeam, selectedRole, isAdmin]);

  // Initial load once on mount and whenever activeStage, adminTab, or team/role filters change
  useEffect(() => {
    fetchCounts();
    fetchApprovals(activeStage, search, adminTab, historyStatusFilter, selectedTeam, selectedRole, true);
  }, [activeStage, adminTab, selectedTeam, selectedRole]);

  // Debounced search when user types
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchApprovals(activeStage, search, adminTab, historyStatusFilter, selectedTeam, selectedRole, false);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const handleTabSwitch = (newTab: 'PENDING' | 'HISTORY') => {
    setAdminTab(newTab);
    setActiveStage('ALL');
    setSelectedTeam('ALL');
    setSelectedRole('ALL');
    fetchCounts(newTab);
    fetchApprovals('ALL', search, newTab, historyStatusFilter, 'ALL', 'ALL', true);
  };

  const handleHistoryFilterChange = (newFilter: 'ALL' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED') => {
    setHistoryStatusFilter(newFilter);
    fetchApprovals(activeStage, search, 'HISTORY', newFilter, selectedTeam, selectedRole, true);
  };

  const handleStageChange = (newStage: string) => {
    setActiveStage(newStage);
    fetchApprovals(newStage, search, adminTab, historyStatusFilter, selectedTeam, selectedRole, true);
  };

  const handleTeamChange = (newTeam: string) => {
    setSelectedTeam(newTeam);
    fetchApprovals(activeStage, search, adminTab, historyStatusFilter, newTeam, selectedRole, true);
  };

  const handleRoleChange = (newRole: string) => {
    setSelectedRole(newRole);
    fetchApprovals(activeStage, search, adminTab, historyStatusFilter, selectedTeam, newRole, true);
  };

  // ── Review modal ──────────────────────────────────────────────────────────

  // ── Review modal ──────────────────────────────────────────────────────────

  const openModal = (approval: ApprovalSummary, action: ReviewModalState['action']) => {
    setModal({
      open: true,
      approval,
      action,
      outcome: null,
      comment: '',
      lossReasonMis: '',
      tpcPurchasePrice: approval.tpcPurchasePrice ? String(approval.tpcPurchasePrice) : '',
      misFinalPrice: approval.misFinalPrice ? String(approval.misFinalPrice) : '',
      loading: false,
      error: ''
    });
  };

  const openOutcomeModal = (approval: ApprovalSummary, outcome: 'Won' | 'Lost') => {
    setModal({
      open: true,
      approval,
      action: 'APPROVED',
      outcome,
      comment: outcome === 'Won' ? 'Tender Won / Awarded' : '',
      lossReasonMis: '',
      tpcPurchasePrice: '',
      misFinalPrice: '',
      loading: false,
      error: ''
    });
  };

  const closeModal = () => {
    setModal(prev => ({ ...prev, open: false, loading: false, error: '' }));
  };

  const submitReview = async () => {
    if (!modal.approval || !modal.action) return;

    if (modal.approval.stage === 'WIN_LOSS_PENDING') {
      if (modal.outcome === 'Lost' && !modal.lossReasonMis.trim() && !modal.comment.trim()) {
        setModal(prev => ({ ...prev, error: 'A reason for loss is required.' }));
        return;
      }
    } else {
      if (!modal.comment.trim()) {
        setModal(prev => ({ ...prev, error: 'A reviewer comment is required.' }));
        return;
      }
    }

    if (modal.approval.stage === 'TPC_PRICING' && modal.action === 'APPROVED') {
      if (!modal.tpcPurchasePrice || parseFloat(modal.tpcPurchasePrice) <= 0) {
        setModal(prev => ({ ...prev, error: 'A valid manufacturer purchase price is required.' }));
        return;
      }
    }

    if (modal.approval.stage === 'MIS_PRICING' && modal.action === 'APPROVED') {
      if (!modal.misFinalPrice || parseFloat(modal.misFinalPrice) <= 0) {
        setModal(prev => ({ ...prev, error: 'A valid MIS final purchase price is required.' }));
        return;
      }
    }

    const finalComment = modal.comment.trim() || 
      (modal.outcome === 'Won' ? 'Verified outcome: Won' : modal.outcome === 'Lost' ? 'Verified outcome: Lost' : '');

    setModal(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const res = await fetchWithAuth(`/api/approvals/${modal.approval.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: modal.action,
          outcome: modal.outcome || undefined,
          comment: finalComment,
          lossReasonMis: modal.lossReasonMis.trim(),
          tpcPurchasePrice: modal.tpcPurchasePrice ? parseFloat(modal.tpcPurchasePrice) : undefined,
          misFinalPrice: modal.misFinalPrice ? parseFloat(modal.misFinalPrice) : undefined,
          tenderId: modal.approval.tenderId,
          stage: modal.approval.stage
        })
      });
      const data = await parseJsonSafely(res);
      if (data.success) {
        showToast(data.message || 'Review submitted', 'success');
        closeModal();
        fetchCounts(adminTab);
        fetchApprovals(activeStage, search, adminTab, historyStatusFilter, selectedTeam, selectedRole, false);
      } else {
        setModal(prev => ({ ...prev, error: data.error || 'Failed to submit review', loading: false }));
      }
    } catch (e) {
      setModal(prev => ({ ...prev, error: 'Network error. Please try again.', loading: false }));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const stageKeys = Object.keys(STAGE_CONFIG);
  const total = counts.TOTAL ?? 0;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '800', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ClipboardCheck size={22} style={{ color: 'var(--primary)' }} />
            Approvals Center
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {currentUser.role === 'Admin'
              ? 'Executive monitoring dashboard — View-only access across pending queues and completed history'
              : currentUser.role === 'MIS Team'
              ? `All pending workflow requests for MIS Team — ${currentUser.username}`
              : currentUser.role === 'Clearance Team'
              ? `Spec clearance requests assigned to your team — ${currentUser.username}`
              : currentUser.role === 'TPC Pricing Team' || currentUser.role === 'TPC Team'
              ? `Manufacturer purchase pricing queue — ${currentUser.username}`
              : `Approval requests you submitted or that are assigned to you — ${currentUser.username}`}
          </p>
        </div>
        <button
          className="btn btn-secondary"
          style={{ gap: '8px', display: 'flex', alignItems: 'center' }}
          onClick={() => { fetchCounts(adminTab); fetchApprovals(activeStage, search, adminTab, historyStatusFilter, selectedTeam, selectedRole, false); }}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Admin Subheadings: Pending Approvals & Approvals History */}
      {isAdmin && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '12px'
        }}>
          <button
            onClick={() => handleTabSwitch('PENDING')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: adminTab === 'PENDING' ? '700' : '500',
              border: adminTab === 'PENDING' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
              background: adminTab === 'PENDING' ? 'var(--primary)' : 'var(--bg-card, rgba(15, 23, 42, 0.45))',
              color: adminTab === 'PENDING' ? '#ffffff' : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: adminTab === 'PENDING' ? '0 2px 10px rgba(99, 102, 241, 0.3)' : 'none'
            }}
          >
            <Clock size={16} />
            <span>Pending Approvals</span>
            <span style={{
              background: adminTab === 'PENDING' ? 'rgba(255,255,255,0.25)' : 'var(--bg-subtle, rgba(255,255,255,0.08))',
              color: adminTab === 'PENDING' ? '#ffffff' : 'var(--text-secondary)',
              borderRadius: '12px',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: '700'
            }}>
              {statusCounts.PENDING ?? counts.TOTAL ?? 0}
            </span>
          </button>

          <button
            onClick={() => handleTabSwitch('HISTORY')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: adminTab === 'HISTORY' ? '700' : '500',
              border: adminTab === 'HISTORY' ? '1px solid var(--primary)' : '1px solid var(--border-color)',
              background: adminTab === 'HISTORY' ? 'var(--primary)' : 'var(--bg-card, rgba(15, 23, 42, 0.45))',
              color: adminTab === 'HISTORY' ? '#ffffff' : 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: adminTab === 'HISTORY' ? '0 2px 10px rgba(99, 102, 241, 0.3)' : 'none'
            }}
          >
            <History size={16} />
            <span>Approvals History</span>
            <span style={{
              background: adminTab === 'HISTORY' ? 'rgba(255,255,255,0.25)' : 'var(--bg-subtle, rgba(255,255,255,0.08))',
              color: adminTab === 'HISTORY' ? '#ffffff' : 'var(--text-secondary)',
              borderRadius: '12px',
              padding: '2px 8px',
              fontSize: '11px',
              fontWeight: '700'
            }}>
              {statusCounts.HISTORY ?? 0}
            </span>
          </button>
        </div>
      )}

      {/* Banner: View-Only Mode for Pending vs Audit History for History */}
      {isAdmin && adminTab === 'PENDING' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '18px',
          fontSize: '12px',
          color: 'var(--text-secondary)'
        }}>
          <Shield size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>Admin View-Only Access:</strong> Approvals Center provides administrative visibility into pending requests awaiting operational action (MIS Team, Clearance Team, TPC Pricing Team).
          </div>
        </div>
      )}

      {isAdmin && adminTab === 'HISTORY' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.25)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '18px',
          fontSize: '12px',
          color: 'var(--text-secondary)'
        }}>
          <History size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <div>
            <strong style={{ color: 'var(--text-primary)' }}>Approvals History & Audit Archive:</strong> Completed reviews, clearance records, and historical decision outcomes across all operational workflows.
          </div>
        </div>
      )}

      {/* ─── APPROVALS HISTORY VIEW (ADMIN ONLY) ─── */}
      {isAdmin && adminTab === 'HISTORY' ? (
        <>
          {/* History Outcome KPI Summary Cards (Interactive filters) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            {[
              { id: 'ALL', label: 'Total Resolved', count: statusCounts.HISTORY ?? historyStageCounts.TOTAL ?? 0, color: 'var(--primary)', icon: <History size={18} /> },
              { id: 'APPROVED', label: 'Approved', count: statusCounts.APPROVED ?? 0, color: '#10b981', icon: <CheckCircle2 size={18} /> },
              { id: 'REJECTED', label: 'Rejected', count: statusCounts.REJECTED ?? 0, color: '#ef4444', icon: <XCircle size={18} /> },
              { id: 'CHANGES_REQUESTED', label: 'Changes Requested', count: statusCounts.CHANGES_REQUESTED ?? 0, color: '#f59e0b', icon: <AlertTriangle size={18} /> }
            ].map(card => {
              const isSelected = historyStatusFilter === card.id;
              return (
                <div
                  key={card.id}
                  onClick={() => handleHistoryFilterChange(card.id as any)}
                  style={{
                    background: isSelected ? 'var(--primary-glow, rgba(129, 140, 248, 0.15))' : 'var(--bg-card, rgba(15, 23, 42, 0.45))',
                    border: `1px solid ${isSelected ? card.color : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    padding: '14px 16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? `0 0 12px ${card.color}33` : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: isSelected ? card.color : 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      {card.label}
                    </span>
                    <span style={{ color: card.color }}>{card.icon}</span>
                  </div>
                  <div style={{ fontSize: '26px', fontWeight: '800', color: isSelected ? card.color : 'var(--text-primary)', marginTop: '6px', letterSpacing: '-0.5px' }}>
                    {card.count}
                  </div>
                </div>
              );
            })}
          </div>

          {/* History Stage Filter Pills (Strictly NO "Pending" in labels) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', marginRight: '4px' }}>Filter Stage:</span>
            {Object.keys(HISTORY_STAGE_CONFIG).map(key => {
              const cfg = HISTORY_STAGE_CONFIG[key];
              const count = key === 'ALL'
                ? (historyStageCounts.TOTAL ?? statusCounts.HISTORY ?? 0)
                : (historyStageCounts[key] ?? 0);
              const active = activeStage === key;
              return (
                <button
                  key={key}
                  onClick={() => handleStageChange(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: active ? '600' : '500',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--primary)' : 'var(--bg-card, rgba(15, 23, 42, 0.45))',
                    color: active ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer', transition: 'all 0.15s ease'
                  }}
                >
                  {cfg.icon}
                  {cfg.label}
                  {count > 0 && (
                    <span style={{
                      background: active ? 'rgba(255,255,255,0.22)' : 'var(--bg-subtle, rgba(255,255,255,0.06))',
                      color: active ? '#ffffff' : 'var(--text-secondary)',
                      borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: '700'
                    }}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Teams, Roles & Search Filter Bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px',
            background: 'var(--bg-card, rgba(15, 23, 42, 0.3))', padding: '10px 14px', borderRadius: '8px',
            border: '1px solid var(--border-color)'
          }}>
            {/* Team filter dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <Users size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>Team:</span>
              <select
                value={selectedTeam}
                onChange={e => handleTeamChange(e.target.value)}
                style={{
                  padding: '5px 10px', borderRadius: '6px', fontSize: '12px',
                  border: '1px solid var(--border-color)', background: 'var(--bg-surface, #0f172a)',
                  color: 'var(--text-primary)', cursor: 'pointer'
                }}
              >
                {TEAMS_OPTIONS.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.label} {t.id !== 'ALL' && teamCounts[t.id] !== undefined ? `(${teamCounts[t.id]})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Role / Requester filter dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <Filter size={14} style={{ color: 'var(--text-muted)' }} />
              <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>Requester:</span>
              <select
                value={selectedRole}
                onChange={e => handleRoleChange(e.target.value)}
                style={{
                  padding: '5px 10px', borderRadius: '6px', fontSize: '12px',
                  border: '1px solid var(--border-color)', background: 'var(--bg-surface, #0f172a)',
                  color: 'var(--text-primary)', cursor: 'pointer'
                }}
              >
                {ROLES_OPTIONS.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.label} {r.id !== 'ALL' && roleCounts[r.id] !== undefined ? `(${roleCounts[r.id]})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div style={{ marginLeft: 'auto', position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search tender, authority, requester..."
                style={{
                  paddingLeft: '32px', paddingRight: '12px', paddingTop: '6px', paddingBottom: '6px',
                  borderRadius: '6px', border: '1px solid var(--border-color)',
                  background: 'var(--bg-surface, #0f172a)', color: 'var(--text-primary)', fontSize: '12px', width: '250px'
                }}
              />
            </div>
          </div>
        </>
      ) : (
        /* ─── PENDING APPROVALS VIEW ─── */
        <>
          {/* Pending Stage KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '20px' }}>
            {[
              { key: 'TOTAL',              label: 'Total Pending' },
              { key: 'SPEC_CLEARANCE',     label: 'Spec Clearance' },
              { key: 'TPC_PRICING',        label: 'TPC Pricing' },
              { key: 'MIS_PRICING',        label: 'MIS Pricing' },
              { key: 'DOC_VERIFICATION',   label: 'Bid Docs Approval' },
              { key: 'PAYMENT_APPROVAL',   label: 'EMD Payment' },
              { key: 'SUBMISSION_PENDING', label: 'Submission' },
              { key: 'WIN_LOSS_PENDING',   label: 'Outcome' },
            ].map(({ key, label }) => {
              const isSelected = activeStage === key || (key === 'TOTAL' && activeStage === 'ALL');
              const countVal = key === 'TOTAL'
                ? (statusCounts.PENDING ?? pendingStageCounts.TOTAL ?? counts.TOTAL ?? 0)
                : (pendingStageCounts[key] ?? counts[key] ?? 0);
              return (
                <div key={key}
                  style={{
                    background: isSelected ? 'var(--primary-glow, rgba(129, 140, 248, 0.15))' : 'var(--bg-card, rgba(15, 23, 42, 0.45))',
                    border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    padding: '12px 14px',
                    cursor: key !== 'TOTAL' ? 'pointer' : 'default',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 0 12px var(--primary-glow)' : 'none'
                  }}
                  onClick={() => { if (key !== 'TOTAL') handleStageChange(key === activeStage ? 'ALL' : key); }}
                >
                  <div style={{ fontSize: '11px', color: isSelected ? 'var(--primary)' : 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: isSelected ? 'var(--primary)' : 'var(--text-primary)', marginTop: '4px', letterSpacing: '-0.4px' }}>
                    {countVal}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pending Stage Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {Object.keys(PENDING_STAGE_CONFIG).map(key => {
              const cfg = PENDING_STAGE_CONFIG[key];
              const count = key === 'ALL'
                ? (statusCounts.PENDING ?? pendingStageCounts.TOTAL ?? counts.TOTAL ?? 0)
                : (pendingStageCounts[key] ?? counts[key] ?? 0);
              const active = activeStage === key;
              return (
                <button key={key}
                  onClick={() => handleStageChange(key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: active ? '600' : '500',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
                    background: active ? 'var(--primary)' : 'var(--bg-card, rgba(15, 23, 42, 0.45))',
                    color: active ? '#ffffff' : 'var(--text-secondary)',
                    cursor: 'pointer', transition: 'all 0.15s ease'
                  }}>
                  {cfg.icon}
                  {cfg.label}
                  {count > 0 && (
                    <span style={{
                      background: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)',
                      color: active ? '#ffffff' : 'var(--text-secondary)',
                      borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: '700'
                    }}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search Filter Bar */}
          {isAdmin ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px',
              background: 'var(--bg-card, rgba(15, 23, 42, 0.3))', padding: '10px 14px', borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                <Users size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>Team:</span>
                <select
                  value={selectedTeam}
                  onChange={e => handleTeamChange(e.target.value)}
                  style={{
                    padding: '5px 10px', borderRadius: '6px', fontSize: '12px',
                    border: '1px solid var(--border-color)', background: 'var(--bg-surface, #0f172a)',
                    color: 'var(--text-primary)', cursor: 'pointer'
                  }}
                >
                  {TEAMS_OPTIONS.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                <Filter size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)', fontWeight: '600' }}>Requester:</span>
                <select
                  value={selectedRole}
                  onChange={e => handleRoleChange(e.target.value)}
                  style={{
                    padding: '5px 10px', borderRadius: '6px', fontSize: '12px',
                    border: '1px solid var(--border-color)', background: 'var(--bg-surface, #0f172a)',
                    color: 'var(--text-primary)', cursor: 'pointer'
                  }}
                >
                  {ROLES_OPTIONS.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginLeft: 'auto', position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search tender, authority, requester..."
                  style={{
                    paddingLeft: '32px', paddingRight: '12px', paddingTop: '6px', paddingBottom: '6px',
                    borderRadius: '6px', border: '1px solid var(--border-color)',
                    background: 'var(--bg-surface, #0f172a)', color: 'var(--text-primary)', fontSize: '12px', width: '250px'
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ position: 'relative', marginBottom: '20px' }}>
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search by tender title, ref no, or authority..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input-field"
                style={{ paddingLeft: '38px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          )}
        </>
      )}

      {/* Approvals List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          <Loader2 size={32} className="spin" style={{ marginBottom: '12px' }} />
          <div>Loading approval requests...</div>
        </div>
      ) : approvals.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px', color: 'var(--text-muted)',
          background: 'var(--bg-card, rgba(15, 23, 42, 0.45))', borderRadius: '12px', border: '1px solid var(--border-color)'
        }}>
          {adminTab === 'HISTORY' ? (
            <>
              <History size={40} style={{ marginBottom: '12px', opacity: 0.4 }} />
              <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
                No Approval History Found
              </div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                {historyStatusFilter !== 'ALL'
                  ? `No ${historyStatusFilter.toLowerCase().replace('_', ' ')} records match the selected filters.`
                  : activeStage !== 'ALL'
                  ? `No completed records in ${HISTORY_STAGE_CONFIG[activeStage]?.label || activeStage}.`
                  : 'No completed approval records yet.'}
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 size={40} style={{ marginBottom: '12px', opacity: 0.4, color: '#10b981' }} />
              <div style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
                No Pending Approvals
              </div>
              <div style={{ fontSize: '13px', marginTop: '4px' }}>
                {activeStage !== 'ALL'
                  ? `No pending requests in ${PENDING_STAGE_CONFIG[activeStage]?.label || activeStage}.`
                  : 'All caught up! No approvals are awaiting review.'}
              </div>
              {isAdmin && (statusCounts.HISTORY ?? 0) > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <button
                    onClick={() => handleTabSwitch('HISTORY')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 18px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '600',
                      background: 'var(--primary)',
                      color: '#ffffff',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: '0 2px 10px rgba(99, 102, 241, 0.3)'
                    }}
                  >
                    <History size={14} />
                    <span>View {statusCounts.HISTORY} Resolved Requests in Approvals History</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {approvals.map(approval => {
            const isOutcomeStage = approval.stage === 'WIN_LOSS_PENDING';
            const stageCfg = isOutcomeStage
              ? { label: 'Outcome Verification', icon: <BarChart2 size={14} /> }
              : ((adminTab === 'HISTORY' ? HISTORY_STAGE_CONFIG : PENDING_STAGE_CONFIG)[approval.stage] || { label: approval.stage, icon: null });

            return (
              <div key={approval.id} style={{
                background: 'var(--bg-card, rgba(15, 23, 42, 0.45))', border: '1px solid var(--border-color)',
                borderRadius: '8px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px'
              }}>
                {/* Top row — Tender ID, Stage badge, time */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      {/* Status Outcome Badge */}
                      {approval.status === 'APPROVED' ? (
                        <span style={{
                          fontSize: '11px', fontWeight: '700',
                          color: '#10b981',
                          background: 'rgba(16, 185, 129, 0.12)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          padding: '2px 8px', borderRadius: '4px',
                          display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}>
                          <CheckCircle2 size={12} />
                          Approved
                        </span>
                      ) : approval.status === 'REJECTED' ? (
                        <span style={{
                          fontSize: '11px', fontWeight: '700',
                          color: '#ef4444',
                          background: 'rgba(239, 68, 68, 0.12)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '2px 8px', borderRadius: '4px',
                          display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}>
                          <XCircle size={12} />
                          Rejected
                        </span>
                      ) : approval.status === 'CHANGES_REQUESTED' ? (
                        <span style={{
                          fontSize: '11px', fontWeight: '700',
                          color: '#f59e0b',
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          padding: '2px 8px', borderRadius: '4px',
                          display: 'inline-flex', alignItems: 'center', gap: '4px'
                        }}>
                          <AlertTriangle size={12} />
                          Changes Requested
                        </span>
                      ) : (
                        <span style={{
                          fontSize: '11px', fontWeight: '700',
                          color: '#f59e0b',
                          background: 'rgba(245, 158, 11, 0.15)',
                          padding: '2px 8px', borderRadius: '12px'
                        }}>
                          Pending
                        </span>
                      )}

                      {/* Stage Pill */}
                      <span style={{
                        fontSize: '11px', fontWeight: '600',
                        color: 'var(--primary)',
                        background: 'var(--primary-glow, rgba(129, 140, 248, 0.12))',
                        border: '1px solid rgba(129, 140, 248, 0.25)',
                        padding: '2px 8px', borderRadius: '4px',
                        display: 'inline-flex', alignItems: 'center', gap: '4px'
                      }}>
                        {stageCfg.icon}
                        {stageCfg.label}
                      </span>
                    </div>

                    <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', marginTop: '6px' }}>
                      {approval.tenderTitle || approval.tenderId}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {approval.tenderRefNo && <span>Ref: {approval.tenderRefNo} · </span>}
                      {approval.tenderAuthority && <span>{approval.tenderAuthority}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-muted)' }}>
                    <Clock size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    {timeAgo(approval.createdAt)}
                    <div style={{ marginTop: '4px' }}>
                      Requested by: <strong>{approval.requestedBy}</strong>
                    </div>
                    {approval.tenderDueDate && (
                      <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                        Due: {formatDate(approval.tenderDueDate)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Stage-specific details */}
                {isOutcomeStage ? (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '10px', background: 'rgba(245, 158, 11, 0.03)',
                    border: '1px solid rgba(245, 158, 11, 0.15)',
                    borderRadius: '8px', padding: '12px 14px', fontSize: '12px'
                  }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Outcome Status</span>
                      {approval.tenderStatus?.toLowerCase() === 'won' || approval.tenderStatus?.toLowerCase() === 'awarded' ? (
                        <strong style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} /> Tender Won / Awarded
                        </strong>
                      ) : approval.tenderStatus?.toLowerCase() === 'lost' ? (
                        <strong style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <XCircle size={12} /> Tender Lost
                        </strong>
                      ) : approval.status === 'APPROVED' ? (
                        <strong style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={12} /> Outcome Verified
                        </strong>
                      ) : approval.status === 'REJECTED' ? (
                        <strong style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <XCircle size={12} /> Outcome Rejected
                        </strong>
                      ) : approval.status === 'CHANGES_REQUESTED' ? (
                        <strong style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <AlertTriangle size={12} /> Changes Requested
                        </strong>
                      ) : (
                        <strong style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} /> Pending Verification
                        </strong>
                      )}
                    </div>
                    {approval.tenderEstimatedCost != null && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Tender Value</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(approval.tenderEstimatedCost)}</strong>
                      </div>
                    )}
                    {approval.tenderRefNo && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Tender / Bid No</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.tenderRefNo}</strong>
                      </div>
                    )}
                    {approval.tenderAuthority && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Client / Authority</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.tenderAuthority}</strong>
                      </div>
                    )}
                    {approval.tenderLocation && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Location</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.tenderLocation}</strong>
                      </div>
                    )}
                    {approval.tenderSector && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Sector</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.tenderSector}</strong>
                      </div>
                    )}
                    <div>
                      <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Assigned Executive</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{approval.misExecutive || approval.requestedBy || '—'}</strong>
                    </div>
                    {approval.assignedTo && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '11px' }}>Assigned Reviewer</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.assignedTo}</strong>
                      </div>
                    )}
                    {approval.lossReasonExecutive && (
                      <div style={{ gridColumn: 'span 2', background: 'rgba(239, 68, 68, 0.05)', padding: '10px 12px', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.18)' }}>
                        <span style={{ color: '#ef4444', display: 'block', fontWeight: '700', fontSize: '11px', marginBottom: '2px' }}>Declared Loss Reason (Executive):</span>
                        <span style={{ color: 'var(--text-primary)', fontSize: '12px' }}>{approval.lossReasonExecutive}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '8px', background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px', padding: '10px 12px', fontSize: '12px'
                  }}>
                    {approval.tenderEstimatedCost != null && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Tender Value</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(approval.tenderEstimatedCost)}</strong>
                      </div>
                    )}
                    {approval.emdAmount != null && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>EMD Requested</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(approval.emdAmount)}</strong>
                      </div>
                    )}
                    {approval.emdAmount == null && approval.tenderEmd != null && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Tender EMD</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(approval.tenderEmd)}</strong>
                      </div>
                    )}
                    {approval.tpcPurchasePrice != null && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Transfer Price</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(approval.tpcPurchasePrice)}</strong>
                      </div>
                    )}
                    {approval.misFinalPrice != null && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Provided Price</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(approval.misFinalPrice)}</strong>
                      </div>
                    )}
                    {approval.transferMode && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Transfer Mode</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.transferMode}</strong>
                      </div>
                    )}
                    {approval.transferRefNo && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Ref Number</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.transferRefNo}</strong>
                      </div>
                    )}
                    {approval.assignedTo && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Assigned To</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.assignedTo}</strong>
                      </div>
                    )}
                    {approval.tenderLocation && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Location</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.tenderLocation}</strong>
                      </div>
                    )}
                    {approval.tenderSector && (
                      <div>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Sector</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{approval.tenderSector}</strong>
                      </div>
                    )}
                    {approval.workingPath && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Working Path</span>
                        <strong style={{ wordBreak: 'break-all', color: 'var(--text-primary)' }}>{approval.workingPath}</strong>
                      </div>
                    )}
                    {approval.lossReasonExecutive && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Loss Reason (Executive)</span>
                        <strong style={{ color: 'var(--text-secondary)' }}>{approval.lossReasonExecutive}</strong>
                      </div>
                    )}
                    {approval.lossReasonMis && (
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ color: 'var(--text-muted)', display: 'block' }}>Loss Reason (MIS)</span>
                        <strong style={{ color: 'var(--text-secondary)' }}>{approval.lossReasonMis}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Reviewer Audit Details (shown when item was reviewed or status is not PENDING) */}
                {(approval.status !== 'PENDING' || approval.reviewedBy || approval.reviewerComment) && (
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.025)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '10px 14px',
                    fontSize: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Decision Status:</span>
                        <strong style={{
                          color: approval.status === 'APPROVED' ? '#10b981' : (approval.status === 'REJECTED' ? '#ef4444' : '#f59e0b')
                        }}>
                          {approval.status}
                        </strong>
                        {approval.reviewedBy && (
                          <span style={{ color: 'var(--text-secondary)', marginLeft: '6px' }}>
                            · Reviewed by <strong style={{ color: 'var(--text-primary)' }}>{approval.reviewedBy}</strong>
                          </span>
                        )}
                      </div>
                      {approval.updatedAt && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                          Updated {timeAgo(approval.updatedAt)} ({formatDate(approval.updatedAt)})
                        </span>
                      )}
                    </div>
                    {approval.reviewerComment && (
                      <div style={{ marginTop: '4px', background: 'rgba(0, 0, 0, 0.25)', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px' }}>
                        <span style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block', marginBottom: '2px' }}>Reviewer Note:</span>
                        <span style={{ color: 'var(--text-primary)' }}>{approval.reviewerComment}</span>
                      </div>
                    )}
                    {approval.lossReasonMis && (
                      <div style={{ marginTop: '2px', color: '#ef4444', fontSize: '12px' }}>
                        <strong>MIS Loss Reason:</strong> {approval.lossReasonMis}
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {approval.receiptFileUrl && isSafeUrl(approval.receiptFileUrl) && (
                    <a
                      href={approval.receiptFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                        border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                        textDecoration: 'none', background: 'transparent'
                      }}
                    >
                      <Download size={12} /> View Receipt
                    </a>
                  )}

                  {approval.stage === 'DOC_VERIFICATION' && (
                    <>
                      <a
                        href={`/documents/${approval.tenderId}/Bid_Documents_${approval.tenderId}.docx`}
                        download
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                          border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981',
                          textDecoration: 'none', background: 'rgba(16, 185, 129, 0.05)'
                        }}
                      >
                        <Download size={12} /> Download DOCX
                      </a>
                      <a
                        href={`/documents/${approval.tenderId}/Bid_Documents_${approval.tenderId}.pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: '5px',
                          padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                          border: '1px solid rgba(59, 130, 246, 0.3)', color: '#3b82f6',
                          textDecoration: 'none', background: 'rgba(59, 130, 246, 0.05)'
                        }}
                      >
                        <FileText size={12} /> View PDF
                      </a>
                    </>
                  )}

                  <a
                    href={`/tenders/${approval.tenderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                      border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                      textDecoration: 'none', background: 'transparent'
                    }}
                  >
                    <ChevronRight size={12} /> View Tender
                  </a>

                  {isAdmin ? (
                    <div style={{
                      marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                      background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)',
                      color: 'var(--primary-light, #a5b4fc)'
                    }}>
                      <Shield size={13} style={{ color: 'var(--primary)' }} />
                      <span>View-Only Access · Assigned: <strong style={{ color: 'var(--text-primary)' }}>{approval.assignedTo || 'Operational Team'}</strong></span>
                    </div>
                  ) : approval.status !== 'PENDING' ? (
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <span>Review Completed</span>
                    </div>
                  ) : isOutcomeStage ? (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => openOutcomeModal(approval, 'Lost')}
                        style={{
                          padding: '7px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                          border: '1px solid rgba(239, 68, 68, 0.4)', color: '#ef4444',
                          background: 'rgba(239, 68, 68, 0.08)', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '6px'
                        }}
                      >
                        <XCircle size={14} />
                        Mark as Lost
                      </button>
                      <button
                        onClick={() => openOutcomeModal(approval, 'Won')}
                        style={{
                          padding: '7px 18px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                          border: '1px solid #10b981', color: '#ffffff',
                          background: '#10b981', cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '6px',
                          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)'
                        }}
                      >
                        <CheckCircle2 size={14} />
                        Mark as Won
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => openModal(approval, 'CHANGES_REQUESTED')}
                        style={{
                          padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                          border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                          background: 'transparent', cursor: 'pointer'
                        }}
                      >
                        Request Changes
                      </button>
                      <button
                        onClick={() => openModal(approval, 'REJECTED')}
                        style={{
                          padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500',
                          border: '1px solid rgba(239, 68, 68, 0.3)', color: '#ef4444',
                          background: 'rgba(239, 68, 68, 0.05)', cursor: 'pointer'
                        }}
                      >
                        <XCircle size={13} style={{ display: 'inline', marginRight: '4px' }} />
                        Reject
                      </button>
                      <button
                        onClick={() => openModal(approval, 'APPROVED')}
                        style={{
                          padding: '6px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                          border: '1px solid var(--primary)', color: '#ffffff',
                          background: 'var(--primary)', cursor: 'pointer'
                        }}
                      >
                        <CheckCircle2 size={13} style={{ display: 'inline', marginRight: '4px' }} />
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Review Modal */}
      {modal.open && modal.approval && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 10000, backdropFilter: 'blur(6px)'
        }}>
          <div style={{
            background: 'var(--bg-sidebar, #0b0f19)', borderRadius: '14px',
            padding: '28px', width: '100%', maxWidth: '520px',
            border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)'
          }}>
            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <div style={{
                  fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px',
                  color: modal.approval.stage === 'WIN_LOSS_PENDING'
                    ? (modal.outcome === 'Won' ? '#10b981' : '#ef4444')
                    : modal.action === 'APPROVED' ? 'var(--primary)'
                    : modal.action === 'REJECTED' ? '#ef4444' : 'var(--text-secondary)',
                  marginBottom: '4px'
                }}>
                  {modal.approval.stage === 'WIN_LOSS_PENDING'
                    ? (modal.outcome === 'Won' ? 'Declare Tender Outcome: WON' : 'Declare Tender Outcome: LOST')
                    : modal.action === 'APPROVED' ? 'Approve Request'
                    : modal.action === 'REJECTED' ? 'Reject Request'
                    : 'Request Changes'}
                </div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)' }}>
                  {modal.approval.tenderTitle || modal.approval.tenderId}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {modal.approval.stage === 'WIN_LOSS_PENDING' ? 'Win / Loss Outcome Verification' : STAGE_CONFIG[modal.approval.stage]?.label} · Requested by {modal.approval.requestedBy}
                </div>
              </div>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px' }}>
                <X size={20} />
              </button>
            </div>

            {/* Summary block or Outcome Banner */}
            {modal.approval.stage === 'WIN_LOSS_PENDING' ? (
              <div style={{
                background: modal.outcome === 'Won' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: `1px solid ${modal.outcome === 'Won' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                borderRadius: '8px', padding: '14px', marginBottom: '16px', fontSize: '12.5px'
              }}>
                {modal.outcome === 'Won' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '26px' }}>🏆</span>
                    <div>
                      <strong style={{ color: '#10b981', display: 'block', fontSize: '13px' }}>Mark Tender as Won / Awarded</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>This will verify and finalize the tender outcome as Won (Awarded).</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '26px' }}>❌</span>
                    <div>
                      <strong style={{ color: '#ef4444', display: 'block', fontSize: '13px' }}>Mark Tender as Lost / Not Awarded</strong>
                      <span style={{ color: 'var(--text-secondary)' }}>This will verify and finalize the tender outcome as Lost (Not Awarded).</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px',
                border: '1px solid var(--border-color)',
                padding: '12px', marginBottom: '16px', fontSize: '12px', display: 'grid',
                gridTemplateColumns: '1fr 1fr', gap: '8px'
              }}>
                {modal.approval.emdAmount != null && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>EMD Amount</span>
                    <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{formatCurrency(modal.approval.emdAmount)}</div>
                  </div>
                )}
                {modal.approval.transferMode && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Transfer Mode</span>
                    <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{modal.approval.transferMode}</div>
                  </div>
                )}
                {modal.approval.transferRefNo && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Reference No.</span>
                    <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{modal.approval.transferRefNo}</div>
                  </div>
                )}
                {modal.approval.workingPath && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Working Path</span>
                    <div style={{ fontWeight: '700', wordBreak: 'break-all', fontSize: '11px', color: 'var(--text-primary)' }}>{modal.approval.workingPath}</div>
                  </div>
                )}
                {modal.approval.tpcPurchasePrice != null && currentUser?.role !== 'Tender Executive' && currentUser?.role !== 'MIS Executive' && currentUser?.role !== 'Executive' && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Transfer Price (Production Cost)</span>
                    <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{formatCurrency(modal.approval.tpcPurchasePrice)}</div>
                  </div>
                )}
                {modal.approval.misFinalPrice != null && (
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Provided Price</span>
                    <div style={{ fontWeight: '700', color: 'var(--text-primary)' }}>{formatCurrency(modal.approval.misFinalPrice)}</div>
                  </div>
                )}
                {modal.approval.lossReasonExecutive && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Executive Loss Reason</span>
                    <div style={{ fontWeight: '700', color: 'var(--text-secondary)' }}>{modal.approval.lossReasonExecutive}</div>
                  </div>
                )}
                {modal.approval.stage === 'DOC_VERIFICATION' && (
                  <div style={{ gridColumn: 'span 2', display: 'flex', gap: '8px', marginTop: '6px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                    <a
                      href={`/documents/${modal.approval.tenderId}/Bid_Documents_${modal.approval.tenderId}.docx`}
                      download
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                        border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981',
                        textDecoration: 'none', background: 'rgba(16, 185, 129, 0.08)'
                      }}
                    >
                      <Download size={14} /> Download DOCX Package
                    </a>
                    <a
                      href={`/documents/${modal.approval.tenderId}/Bid_Documents_${modal.approval.tenderId}.pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                        border: '1px solid rgba(59, 130, 246, 0.3)', color: '#3b82f6',
                        textDecoration: 'none', background: 'rgba(59, 130, 246, 0.08)'
                      }}
                    >
                      <FileText size={14} /> View PDF Bundle
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Win/Loss — Reason for Loss if Lost */}
            {modal.approval.stage === 'WIN_LOSS_PENDING' && modal.outcome === 'Lost' && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Reason for Loss <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  value={modal.lossReasonMis}
                  onChange={e => setModal(prev => ({ ...prev, lossReasonMis: e.target.value }))}
                  placeholder="Provide reason for loss (e.g. L1 price difference, technical disqualification, etc.)..."
                  rows={2}
                  style={{
                    width: '100%', boxSizing: 'border-box', borderRadius: '6px',
                    border: '1px solid var(--border-color)', background: 'var(--bg-card, rgba(15, 23, 42, 0.6))',
                    color: 'var(--text-primary)', fontSize: '13px', padding: '10px', resize: 'vertical'
                  }}
                />
              </div>
            )}

            {/* TPC Pricing input */}
            {modal.approval.stage === 'TPC_PRICING' && modal.action === 'APPROVED' && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Transfer Price (Total Production Cost) (₹) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="number"
                  value={modal.tpcPurchasePrice}
                  onChange={e => setModal(prev => ({ ...prev, tpcPurchasePrice: e.target.value }))}
                  placeholder="Enter total production cost / transfer price..."
                  style={{
                    width: '100%', boxSizing: 'border-box', borderRadius: '6px',
                    border: '1px solid var(--border-color)', background: 'var(--bg-card, rgba(15, 23, 42, 0.6))',
                    color: 'var(--text-primary)', fontSize: '13px', padding: '10px'
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                  🔒 Confidential: Sent to Admin &amp; MIS Team. Not visible to Tender Executive.
                </span>
              </div>
            )}

            {/* MIS Pricing input */}
            {modal.approval.stage === 'MIS_PRICING' && modal.action === 'APPROVED' && (
              <div style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Provided Price (₹) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="number"
                  value={modal.misFinalPrice}
                  onChange={e => setModal(prev => ({ ...prev, misFinalPrice: e.target.value }))}
                  placeholder="Enter final provided price for Tender Executive..."
                  style={{
                    width: '100%', boxSizing: 'border-box', borderRadius: '6px',
                    border: '1px solid var(--border-color)', background: 'var(--bg-card, rgba(15, 23, 42, 0.6))',
                    color: 'var(--text-primary)', fontSize: '13px', padding: '10px'
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '4px' }}>
                  This final provided price will be sent to the Tender Executive to unblock bid document generation.
                </span>
              </div>
            )}

            {/* Reviewer comment / remarks */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                {modal.approval.stage === 'WIN_LOSS_PENDING' ? 'Remarks / Notes' : 'Reviewer Comment'} {modal.approval.stage !== 'WIN_LOSS_PENDING' && <span style={{ color: '#ef4444' }}>*</span>}
              </label>
              <textarea
                value={modal.comment}
                onChange={e => setModal(prev => ({ ...prev, comment: e.target.value }))}
                placeholder={modal.approval.stage === 'WIN_LOSS_PENDING' ? "Add optional remarks..." : "Add your review remarks..."}
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box', borderRadius: '6px',
                  border: `1px solid ${modal.error ? '#ef4444' : 'var(--border-color)'}`,
                  background: 'var(--bg-card, rgba(15, 23, 42, 0.6))', color: 'var(--text-primary)',
                  fontSize: '13px', padding: '10px', resize: 'vertical'
                }}
              />
            </div>

            {/* Error */}
            {modal.error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 14px', background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '6px', marginBottom: '14px', fontSize: '13px', color: '#ef4444'
              }}>
                <AlertCircle size={14} />
                {modal.error}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={closeModal}
                disabled={modal.loading}
                style={{
                  padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: '500',
                  border: '1px solid var(--border-color)', background: 'transparent',
                  color: 'var(--text-secondary)', cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitReview}
                disabled={modal.loading}
                style={{
                  padding: '8px 22px', borderRadius: '6px', fontSize: '13px', fontWeight: '600',
                  border: 'none', cursor: modal.loading ? 'not-allowed' : 'pointer',
                  background: modal.approval.stage === 'WIN_LOSS_PENDING'
                    ? (modal.outcome === 'Won' ? '#10b981' : '#ef4444')
                    : modal.action === 'REJECTED' ? '#ef4444' : 'var(--primary)',
                  color: '#fff', display: 'flex', alignItems: 'center', gap: '7px',
                  opacity: modal.loading ? 0.7 : 1
                }}
              >
                {modal.loading
                  ? <><Loader2 size={14} className="spin" /> Submitting...</>
                  : modal.approval.stage === 'WIN_LOSS_PENDING'
                    ? (modal.outcome === 'Won' ? 'Confirm Won' : 'Confirm Lost')
                  : modal.action === 'APPROVED' ? 'Confirm Approve'
                  : modal.action === 'REJECTED' ? 'Confirm Reject'
                  : 'Send for Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
