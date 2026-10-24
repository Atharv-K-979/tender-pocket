"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  FileText,
  History,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Download,
  XCircle,
  Briefcase,
  Layers,
  Inbox,
  Globe,
  Building,
  Activity,
  ChevronLeft,
  Calendar,
  DollarSign,
  MapPin,
  Tag,
  BookOpen,
  ExternalLink,
  Sun,
  Moon,
  Shield,
  Edit3,
  Save,
  RotateCcw,
  Lock
} from 'lucide-react';
import { Tender } from '@/lib/db';
import { canPerform, canReviewAssignment } from '@/lib/workflowAuthorization';
import WorkflowPipelineStepper from '@/app/components/WorkflowPipelineStepper';
import { areBidDocsGenerated, hasWorkingPathSaved } from '@/lib/tenderStatus';

interface Toast {
  message: string;
  type: 'success' | 'error';
  show: boolean;
}

export default function TenderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const dbTenderRef = useRef<any>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const canRecordOperationalStages = currentUser?.role === 'Tender Executive' || currentUser?.role === 'Executive';
  const isMisRole = currentUser?.role === 'MIS Team' || currentUser?.role === 'MIS';
  const isAdmin = currentUser?.role === 'Admin';
  const [uploadingTechSpec, setUploadingTechSpec] = useState(false);
  const [techSpecProgress, setTechSpecProgress] = useState<{
    status?: string;
    stage?: string;
    message?: string;
    percent?: number;
    completedBatches?: number;
    totalBatches?: number;
    clausesExtracted?: number;
    clauses?: number;
  } | null>(null);
  const techSpecUploadInFlight = useRef(false);

  // Data States
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [tenderNotes, setTenderNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [misExecutive, setMisExecutive] = useState('');
  const [executivesList, setExecutivesList] = useState<string[]>([]);
  const [bidQty, setBidQty] = useState<number | ''>('');
  const [quotedQty, setQuotedQty] = useState<number | ''>('');
  const [detailsSummary, setDetailsSummary] = useState('');
  const [statusHistorySummary, setStatusHistorySummary] = useState('');
  const [tenderHistory, setTenderHistory] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(true);

  // Workflow, Comments and Stats States
  const [comments, setComments] = useState<any[]>([]);
  const [specCommentText, setSpecCommentText] = useState('');
  const [paymentCommentText, setPaymentCommentText] = useState('');
  const [verificationCommentText, setVerificationCommentText] = useState('');
  const [submissionCommentText, setSubmissionCommentText] = useState('');
  
  const [selectedMisMember, setSelectedMisMember] = useState('');
  const [selectedMisMemberSpec, setSelectedMisMemberSpec] = useState('');
  const [selectedMisMemberEmd, setSelectedMisMemberEmd] = useState('');
  const [selectedMisMemberDocs, setSelectedMisMemberDocs] = useState('');
  const [selectedMisMemberSubmission, setSelectedMisMemberSubmission] = useState('');
  const [misTeamMembers, setMisTeamMembers] = useState<string[]>([]);
  const [specTeamMembers, setSpecTeamMembers] = useState<string[]>([]);
  
  const [workingPath, setWorkingPath] = useState('');
  const [emdPaymentMode, setEmdPaymentMode] = useState('');
  const [emdPaymentRef, setEmdPaymentRef] = useState('');
  const [emdAmountActual, setEmdAmountActual] = useState<number | ''>('');
  const [emdPaymentDate, setEmdPaymentDate] = useState('');
  const [lossReason, setLossReason] = useState('');
  const [tpcPurchasePriceInput, setTpcPurchasePriceInput] = useState<number | ''>('');
  const [misFinalPriceInput, setMisFinalPriceInput] = useState<number | ''>('');
  const [submittingTpcPrice, setSubmittingTpcPrice] = useState(false);
  const [submittingMisPrice, setSubmittingMisPrice] = useState(false);
  const [submittingSpecClearance, setSubmittingSpecClearance] = useState(false);
  const [submittingApproveClearance, setSubmittingApproveClearance] = useState(false);
  const [isParticipatingSubmitting, setIsParticipatingSubmitting] = useState(false);
  const [isTechSpecDragOver, setIsTechSpecDragOver] = useState(false);

  // Offered Product Model Catalogue State (Evidence-based Column 4)
  const [availableModels, setAvailableModels] = useState<Array<{ id: number; model_number: string; make: string; product_category: string; verified_specs?: number }>>([]);
  const [selectedModelId, setSelectedModelId] = useState<number | ''>('');
  const [scheduleModels, setScheduleModels] = useState<Record<string, number>>({});

  // Editable Tender Specifications & Parameters State
  const [isEditingSpecs, setIsEditingSpecs] = useState(false);
  const [savingSpecs, setSavingSpecs] = useState(false);
  const [specValidationErrors, setSpecValidationErrors] = useState<Record<string, string>>({});
  const [specForm, setSpecForm] = useState({
    authority: '',
    ref_no: '',
    estimated_cost_raw: '',
    emd_raw: '',
    document_fee_raw: '',
    tender_type: 'GeM',
    source: 'GeM',
    source_id: '',
    location: '',
    place: '',
    state: '',
    sector: '',
    vertical_name: '',
    publish_date: '',
    start_date: '',
    due_date: '',
    opening_date: '',
    pre_bid_date: '',
    time: '',
    entry_date: '',
    bid_qty: '' as number | string,
    quoted_qty: '' as number | string,
    corrigendum_remark: 'No',
    product_name_as_per_tender: '',
    product_name_as_per_marken: '',
    title: '',
    original_url: ''
  });
  const [originalSpecForm, setOriginalSpecForm] = useState<typeof specForm | null>(null);

  const hasUnsavedSpecChanges = useMemo(() => {
    if (!isEditingSpecs || !originalSpecForm) return false;
    return JSON.stringify(specForm) !== JSON.stringify(originalSpecForm);
  }, [isEditingSpecs, specForm, originalSpecForm]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isEditingSpecs && hasUnsavedSpecChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isEditingSpecs, hasUnsavedSpecChanges]);

  // Company Presets
  const COMPANY_PRESETS = {
    me: {
      companyKey: 'me',
      companyName: 'Mark Enterprises',
      companyAddress: 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
      companyEmail: 'info@markenworld.com',
      companyWebsite: 'www.markenworld.com',
      companyContact: '09175559646 / 090111 04332',
      manufacturerName: 'M/s. Mark Enterprises',
      manufacturerAddress: 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
      signatoryName: 'Shreedhar Shingare',
      signatoryDesignation: 'Authorized Signatory – Tender manager',
      signatoryAddress: 'Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India',
      witnessDetails: 'Mr. Korra Praveen Naik',
      localContentPercentage: '100%',
      localContentLocation: 'Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
      preferencePolicy: 'PPP MII 2017',
      warrantyPeriod: 'Five (5) years',
      serviceSupportPeriod: 'Five (5) years',
      sparesAvailabilityPeriod: 'Ten (10) years',
      place: 'Nashik',
      make: 'MarkEn',
      model: 'MILR-04',
      companyNameCompliance: 'M/s. Mark Enterprises'
    },
    healthtech: {
      companyKey: 'healthtech',
      companyName: 'Marken Healthtech Limited',
      companyAddress: '93/1 Street No.17, MIDC, Satpur, Nashik- 422007. MH. India',
      companyEmail: 'info@markenworld.com',
      companyWebsite: 'www.markenworld.com',
      companyContact: '+91 91 3030 5959',
      manufacturerName: 'Marken Healthtech Ltd',
      manufacturerAddress: 'Shed No.1, Plot No.93/1, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra.',
      signatoryName: 'Korra Praveen Naik',
      signatoryDesignation: 'Authorized Signatory',
      signatoryAddress: '1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, District: Hyderabad, State: Andhra Pradesh, PIN Code: 500062',
      witnessDetails: 'Mr. Shreedhar Shingare (Cell No.: 09011104332)',
      localContentPercentage: '100%',
      localContentLocation: 'Shed No.1, Plot No.93/1, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra',
      preferencePolicy: 'PPP MII 2017',
      warrantyPeriod: 'Five (5) years',
      serviceSupportPeriod: 'Five (5) years',
      sparesAvailabilityPeriod: 'Ten (10) years',
      place: 'Nashik',
      make: 'MarkEn',
      model: 'MILR-04',
      companyNameCompliance: 'Marken Healthtech Limited'
    }
  };

  // Bid Doc Generator Modal States
  const [isBidDocFormOpen, setIsBidDocFormOpen] = useState(false);
  const [generatingBidDocs, setGeneratingBidDocs] = useState(false);
  const [bidFormFields, setBidFormFields] = useState({
    orientation: 'portrait',
    bidNumber: '',
    bidDate: '',
    authorityName: '',
    authorityDept: '',
    authorityAddress: '',
    productDescription: '',
    requiredQuantity: '300',
    ...COMPANY_PRESETS.me
  });

  const [toast, setToast] = useState<Toast>({ message: '', type: 'success', show: false });

  const localEditsRef = useRef<any>({});
  localEditsRef.current = {
    tenderNotes,
    workingPath,
    emdPaymentMode,
    emdPaymentRef,
    emdAmountActual,
    emdPaymentDate,
    lossReason,
    bidQty,
    quotedQty,
    misExecutive,
    selectedMisMember,
    selectedMisMemberSpec,
    selectedMisMemberEmd,
    selectedMisMemberDocs,
    selectedMisMemberSubmission
  };

  // Custom fetch wrapper injecting authentication headers
  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    if (currentUser) {
      headers.set('x-user-role', currentUser.role);
      headers.set('x-user-username', currentUser.username);
    }
    const token = localStorage.getItem('token');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    // Force no-cache headers to prevent Next.js and browser from caching live data
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');

    return fetch(url, { 
      cache: 'no-store',
      ...options, 
      headers 
    });
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type, show: true });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  // Auth initialization
  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setTheme(savedTheme as any);
    document.documentElement.setAttribute('data-theme', savedTheme);

    const userStr = localStorage.getItem('currentUser');
    if (!userStr || userStr === 'undefined') {
      router.push('/');
      return;
    }
    try {
      const userObj = JSON.parse(userStr);
      setCurrentUser(userObj);
    } catch (e) {
      console.error('Failed to parse user session:', e);
      router.push('/');
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  };

  // Fetch data once user is loaded with auto-sync polling
  useEffect(() => {
    if (currentUser && id) {
      fetchTenderDetails();
      fetchComments(id);
      fetchMisTeamMembers();
      fetchOfferedModels(id);

      // Poll updates every 1.5 seconds for near-instant live sync
      const syncInterval = setInterval(() => {
        fetchTenderDetails(true);
        fetchComments(id);
      }, 1500);

      return () => clearInterval(syncInterval);
    }
  }, [currentUser, id]);

  const fetchTenderDetails = async (isBackground = false) => {
    if (!isBackground && !selectedTender) setLoadingDetails(true);
    try {
      // Append cache-busting timestamp to avoid browser GET caching
      const response = await fetchWithAuth(`/api/tenders/${id}?t=${Date.now()}`);
      const data = await response.json();
      if (data.success) {
        const tender = data.tender;
        const prevTender = dbTenderRef.current;
        dbTenderRef.current = tender;
        setSelectedTender(tender);
        
        const isClient = typeof document !== 'undefined';
        const isFirstLoad = !prevTender;

        // Retrieve the latest non-stale user inputs from the ref
        const {
          tenderNotes: latestNotes,
          workingPath: latestWorkingPath,
          emdPaymentMode: latestEmdMode,
          emdPaymentRef: latestEmdRef,
          emdAmountActual: latestEmdAmt,
          emdPaymentDate: latestEmdDate,
          lossReason: latestLossReason,
          bidQty: latestBidQty,
          quotedQty: latestQuotedQty,
          misExecutive: latestMisExecutive,
          selectedMisMember: latestMisMember,
          selectedMisMemberSpec: latestSpecMember,
          selectedMisMemberEmd: latestEmdMember,
          selectedMisMemberDocs: latestDocsMember,
          selectedMisMemberSubmission: latestSubMember
        } = localEditsRef.current;

        // 1. Notes
        const hasLocalNotesChanges = prevTender && latestNotes !== (prevTender.notes || '');
        if (isFirstLoad || !hasLocalNotesChanges) {
          setTenderNotes(tender.notes || '');
        }

        // 2. Working Path
        const hasLocalWorkingPathChanges = prevTender && latestWorkingPath !== (prevTender.working_path || '');
        if (isFirstLoad || !hasLocalWorkingPathChanges) {
          setWorkingPath(tender.working_path || '');
        }

        // 3. EMD Payment Details
        const hasLocalEmdModeChanges = prevTender && latestEmdMode !== (prevTender.emd_payment_mode || '');
        if (isFirstLoad || !hasLocalEmdModeChanges) {
          setEmdPaymentMode(tender.emd_payment_mode || '');
        }

        const hasLocalEmdRefChanges = prevTender && latestEmdRef !== (prevTender.emd_payment_ref || '');
        if (isFirstLoad || !hasLocalEmdRefChanges) {
          setEmdPaymentRef(tender.emd_payment_ref || '');
        }

        const prevEmdAmt = prevTender && prevTender.emd_amount_actual !== undefined && prevTender.emd_amount_actual !== null ? prevTender.emd_amount_actual : '';
        const hasLocalEmdAmtChanges = prevTender && latestEmdAmt !== prevEmdAmt;
        if (isFirstLoad || !hasLocalEmdAmtChanges) {
          setEmdAmountActual(tender.emd_amount_actual !== undefined && tender.emd_amount_actual !== null ? tender.emd_amount_actual : '');
        }

        const hasLocalEmdDateChanges = prevTender && latestEmdDate !== (prevTender.emd_payment_date || '');
        if (isFirstLoad || !hasLocalEmdDateChanges) {
          setEmdPaymentDate(tender.emd_payment_date || '');
        }

        // 4. Loss Reason
        const hasLocalLossReasonChanges = prevTender && latestLossReason !== (prevTender.loss_reason || '');
        if (isFirstLoad || !hasLocalLossReasonChanges) {
          setLossReason(tender.loss_reason || '');
        }

        // 5. Bid Qty
        const prevBidQty = prevTender && (prevTender.bid_qty != null ? prevTender.bid_qty : (prevTender.bidQty != null ? prevTender.bidQty : ''));
        const hasLocalBidQtyChanges = prevTender && latestBidQty !== prevBidQty;
        if (isFirstLoad || !hasLocalBidQtyChanges) {
          const rawBidQty = tender.bid_qty != null ? tender.bid_qty : (tender.bidQty != null ? tender.bidQty : '');
          setBidQty(rawBidQty);
        }

        // 6. Quoted Qty
        const prevQuotedQty = prevTender && (prevTender.quoted_qty != null ? prevTender.quoted_qty : (prevTender.quotedQty != null ? prevTender.quotedQty : ''));
        const hasLocalQuotedQtyChanges = prevTender && latestQuotedQty !== prevQuotedQty;
        if (isFirstLoad || !hasLocalQuotedQtyChanges) {
          const rawQuotedQty = tender.quoted_qty != null ? tender.quoted_qty : (tender.quotedQty != null ? tender.quotedQty : '');
          setQuotedQty(rawQuotedQty);
        }

        // 7. MIS Executive
        const hasLocalMisExecutiveChanges = prevTender && latestMisExecutive !== (prevTender.mis_executive || '');
        if (isFirstLoad || !hasLocalMisExecutiveChanges) {
          setMisExecutive(tender.mis_executive || '');
        }

        // 8. Assigned MIS Representatives
        const hasLocalMisMemberChanges = prevTender && latestMisMember !== (prevTender.assigned_mis_member || '');
        if (isFirstLoad || !hasLocalMisMemberChanges) {
          setSelectedMisMember(tender.assigned_mis_member || '');
        }

        const hasLocalSpecMemberChanges = prevTender && latestSpecMember !== (prevTender.assigned_mis_member_spec || '');
        if (isFirstLoad || !hasLocalSpecMemberChanges) {
          setSelectedMisMemberSpec(tender.assigned_mis_member_spec || '');
        }

        const hasLocalEmdMemberChanges = prevTender && latestEmdMember !== (prevTender.assigned_mis_member_emd || '');
        if (isFirstLoad || !hasLocalEmdMemberChanges) {
          setSelectedMisMemberEmd(tender.assigned_mis_member_emd || '');
        }

        const hasLocalDocsMemberChanges = prevTender && latestDocsMember !== (prevTender.assigned_mis_member_docs || '');
        if (isFirstLoad || !hasLocalDocsMemberChanges) {
          setSelectedMisMemberDocs(tender.assigned_mis_member_docs || '');
        }

        const hasLocalSubMemberChanges = prevTender && latestSubMember !== (prevTender.assigned_mis_member_submission || '');
        if (isFirstLoad || !hasLocalSubMemberChanges) {
          setSelectedMisMemberSubmission(tender.assigned_mis_member_submission || '');
        }

        if (isFirstLoad) {
          setTpcPurchasePriceInput(tender.tpc_purchase_price !== undefined && tender.tpc_purchase_price !== null ? tender.tpc_purchase_price : '');
          setMisFinalPriceInput(tender.mis_final_price !== undefined && tender.mis_final_price !== null ? tender.mis_final_price : '');
        }
        
        setDetailsSummary(data.summaries.detailsSummary);
        setStatusHistorySummary(data.summaries.statusHistorySummary);
        setTenderHistory(data.history || []);
      } else {
        if (!isBackground) showToast('Tender not found', 'error');
      }
    } catch (e) {
      console.error('Error loading tender:', e);
      if (!isBackground) showToast('Error loading tender details', 'error');
    } finally {
      if (!isBackground) setLoadingDetails(false);
    }
  };

  const fetchComments = async (tenderId: string) => {
    try {
      // Append cache-busting timestamp to avoid browser GET caching
      const response = await fetchWithAuth(`/api/tenders/${tenderId}/comments?t=${Date.now()}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setComments(data.comments || []);
        }
      }
    } catch (e) {
      console.error('Failed to fetch comments:', e);
    }
  };

  const fetchMisTeamMembers = async () => {
    try {
      // Corrected route to /api/auth/users and added cache busting
      const response = await fetchWithAuth(`/api/auth/users?t=${Date.now()}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.users)) {
          const misMembers = data.users
            .filter((u: any) => u.role === 'MIS Team')
            .map((u: any) => u.username);
          setMisTeamMembers(misMembers);

          const execs = data.users
            .filter((u: any) => u.role === 'MIS Executive' || u.role === 'Tender Executive' || u.role === 'Executive')
            .map((u: any) => u.username);
          setExecutivesList(execs);

          const specMembers = data.users
            .filter((u: any) => u.role === 'Specification Team' || u.role === 'Clearance Team')
            .map((u: any) => u.username);
          setSpecTeamMembers(specMembers);
        }
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  const fetchOfferedModels = async (tenderId: string) => {
    try {
      const [modelsRes, tenderModelsRes] = await Promise.all([
        fetchWithAuth('/api/products/models?status=VERIFIED'),
        fetchWithAuth(`/api/tenders/${tenderId}/offered-models`)
      ]);
      if (modelsRes.ok) {
        const mData = await modelsRes.json();
        if (mData.success && Array.isArray(mData.models)) {
          setAvailableModels(mData.models);
        }
      }
      if (tenderModelsRes.ok) {
        const tData = await tenderModelsRes.json();
        if (tData.success && tData.data) {
          if (tData.data.selected_model_id) setSelectedModelId(tData.data.selected_model_id);
          if (tData.data.schedule_models) setScheduleModels(tData.data.schedule_models);
        }
      }
    } catch (e) {
      console.error('Failed to fetch offered models:', e);
    }
  };

  const updateTenderField = async (fields: Partial<Tender>) => {
    if (!id || !selectedTender) return;
    try {
      const response = await fetchWithAuth(`/api/tenders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
      const data = await response.json();
      if (data.success) {
        showToast('Workflow updated successfully!', 'success');
        
        // Show explicit alerts for key workflow steps
        if (fields.spec_verification_status === 'Pending') {
          alert('Technical specification verification request submitted successfully!');
        } else if (fields.spec_verification_status === 'Approved') {
          alert('Technical specification verified and approved successfully!');
        } else if (fields.spec_verification_status === 'Rejected') {
          alert('Technical specification verification rejected.');
        } else if (fields.payment_status === 'Pending') {
          alert('EMD Payment approval request submitted successfully!');
        } else if (fields.payment_status === 'Approved') {
          alert('EMD Payment approved successfully!');
        } else if (fields.payment_status === 'Rejected') {
          alert('EMD Payment rejected.');
        } else if (fields.verification_status === 'Pending') {
          alert('Document verification request submitted successfully!');
        } else if (fields.verification_status === 'Approved') {
          alert('Documents verified and approved successfully!');
        } else if (fields.verification_status === 'Rejected') {
          alert('Documents verification rejected.');
        } else if (fields.submission_status === 'Pending') {
          alert('Tender submission verification request submitted!');
        } else if (fields.submission_status === 'Approved') {
          alert('Tender marked as Submitted successfully!');
        } else if (fields.status === 'Won' || fields.status === 'Awarded') {
          alert('Tender successfully marked as Won!');
        } else if (fields.status === 'Lost' || fields.status === 'Not Awarded') {
          alert('Tender successfully marked as Lost.');
        }

        // Update local state instantly
        setSelectedTender(prev => prev ? { ...prev, ...fields } : null);
        
        // Refresh detail metrics
        fetchTenderDetails();
        fetchComments(id);
      } else {
        showToast(data.error || 'Failed to update workflow.', 'error');
        alert('Error updating workflow: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
      alert('Error communicating with server.');
    }
  };

  const specInputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    background: 'var(--bg-app)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
  };

  const validateSpecCalendarDate = (dateStr: string, isPreBid: boolean = false): string | null => {
    if (!dateStr || !dateStr.trim()) return null;
    const s = dateStr.trim();
    if (isPreBid && (s.toLowerCase() === 'no' || s.toLowerCase() === 'n/a')) {
      return null;
    }
    // Check YYYY-MM-DD
    const dateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
      const year = parseInt(dateMatch[1], 10);
      const month = parseInt(dateMatch[2], 10);
      const day = parseInt(dateMatch[3], 10);
      if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
        return isPreBid ? "Enter a valid date or 'No'." : "Enter a valid date.";
      }
      const d = new Date(year, month - 1, day);
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
        return isPreBid ? "Enter a valid date or 'No'." : "Enter a valid date.";
      }
      return null;
    }

    // Check YYYY-MM-DD HH:mm:ss or YYYY-MM-DDTHH:mm(:ss)?
    const dtMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(:(\d{2}))?$/);
    if (dtMatch) {
      const year = parseInt(dtMatch[1], 10);
      const month = parseInt(dtMatch[2], 10);
      const day = parseInt(dtMatch[3], 10);
      const hour = parseInt(dtMatch[4], 10);
      const min = parseInt(dtMatch[5], 10);
      const sec = dtMatch[7] ? parseInt(dtMatch[7], 10) : 0;
      if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) {
        return "Enter a valid date.";
      }
      const d = new Date(year, month - 1, day, hour, min, sec);
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
        return "Enter a valid date.";
      }
      return null;
    }

    // Check legacy "d MMM uuuu" e.g. "8 Oct 2026" or "24 Sep 2026"
    const legacyMatch = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
    if (legacyMatch) {
      const day = parseInt(legacyMatch[1], 10);
      const monthStr = legacyMatch[2].toLowerCase();
      const year = parseInt(legacyMatch[3], 10);
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIdx = months.indexOf(monthStr);
      if (monthIdx === -1 || year < 1900 || year > 2100 || day < 1 || day > 31) {
        return isPreBid ? "Enter a valid date or 'No'." : "Enter a valid date.";
      }
      const d = new Date(year, monthIdx, day);
      if (d.getFullYear() !== year || d.getMonth() !== monthIdx || d.getDate() !== day) {
        return isPreBid ? "Enter a valid date or 'No'." : "Enter a valid date.";
      }
      return null;
    }

    return isPreBid ? "Enter a valid date or 'No'." : "Enter a valid date.";
  };

  const validateSpecNumeric = (val: string | number, isFee: boolean): string | null => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') {
      if (val < 0) return isFee ? "Fee cannot be negative." : "Amount cannot be negative.";
      return null;
    }
    const s = String(val).trim();
    if (!s || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'null') return null;

    let isNegative = s.startsWith('-') || /^[^\d]*-\s*\d/.test(s);
    let numStr = s.replace(/^(?:₹|Rs\.?|INR|[$€£])\s*/i, '').trim();
    if (numStr.startsWith('-')) {
      isNegative = true;
      numStr = numStr.substring(1).trim();
    }

    if (!numStr) {
      return isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.";
    }

    // Reject multiple decimal points
    const dotCount = (numStr.match(/\./g) || []).length;
    if (dotCount > 1) {
      return isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.";
    }

    // Reject invalid characters or malformed numeric format
    if (!/^[0-9,]+(?:\.[0-9]+)?$/.test(numStr)) {
      return isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.";
    }

    // If commas are present, validate strict Indian or Western grouping
    if (numStr.includes(',')) {
      const validWestern = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(numStr);
      const validIndian = /^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(numStr);
      if (!validWestern && !validIndian) {
        return isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.";
      }
    }

    const cleaned = numStr.replace(/,/g, '');
    const num = Number(cleaned);
    if (isNaN(num)) {
      return isFee ? "Enter a valid numeric fee." : "Enter a valid numeric amount.";
    }
    if (isNegative || num < 0) {
      return isFee ? "Fee cannot be negative." : "Amount cannot be negative.";
    }
    return null;
  };

  const validateSpecQuantity = (val: string | number): string | null => {
    if (val === null || val === undefined || val === '') return null;
    const s = String(val).trim();
    if (!s || s.toLowerCase() === 'n/a') return null;
    if (s.includes('.')) {
      const num = Number(s);
      if (isNaN(num)) return "Enter a valid numeric quantity.";
      if (num < 0) return "Quantity cannot be negative.";
      return "Quantity must be an integer.";
    }
    const num = Number(s);
    if (isNaN(num)) {
      return "Enter a valid numeric quantity.";
    }
    if (num < 0) {
      return "Quantity cannot be negative.";
    }
    return null;
  };

  const validateSpecUrl = (urlStr: string): string | null => {
    if (!urlStr || !urlStr.trim()) return "Source URL cannot be empty.";
    const s = urlStr.trim();
    if (!s.startsWith('http://') && !s.startsWith('https://')) {
      return "Enter a valid URL (e.g. https://...).";
    }
    try {
      new URL(s);
      return null;
    } catch {
      return "Enter a valid URL (e.g. https://...).";
    }
  };

  const validateSpecField = (field: string, value: any): string | null => {
    if (field === 'title') {
      if (!value || !String(value).trim()) return "Tender Brief / Description cannot be empty.";
      return null;
    }
    if (field === 'ref_no') {
      if (!value || !String(value).trim()) return "Official Reference No cannot be empty.";
      if (String(value).trim().length > 255) return "Official Reference No cannot exceed 255 characters.";
      return null;
    }
    if (['place', 'state', 'sector', 'vertical_name', 'source_id'].includes(field)) {
      if (value && String(value).trim().length > 255) return `${field} cannot exceed 255 characters.`;
      return null;
    }
    if (field === 'document_fee_raw') {
      return validateSpecNumeric(value, true);
    }
    if (field === 'estimated_cost_raw' || field === 'emd_raw') {
      return validateSpecNumeric(value, false);
    }
    if (field === 'bid_qty' || field === 'quoted_qty') {
      return validateSpecQuantity(value);
    }
    if (['opening_date', 'publish_date', 'start_date', 'due_date', 'entry_date'].includes(field)) {
      return validateSpecCalendarDate(String(value || ''));
    }
    if (field === 'pre_bid_date') {
      return validateSpecCalendarDate(String(value || ''), true);
    }
    if (field === 'time') {
      if (value && String(value).trim() && String(value).trim() !== 'N/A') {
        const s = String(value).trim();
        if (!s.match(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)) {
          return "Enter a valid time (e.g. 15:00:00).";
        }
      }
      return null;
    }
    if (field === 'original_url') {
      return validateSpecUrl(String(value || ''));
    }
    return null;
  };

  const validateAllSpecFields = (form: Record<string, any>): Record<string, string> => {
    const errors: Record<string, string> = {};
    for (const [key, val] of Object.entries(form)) {
      const err = validateSpecField(key, val);
      if (err) {
        errors[key] = err;
      }
    }
    return errors;
  };

  const handleSpecFieldChange = (field: string, val: any) => {
    setSpecForm(prev => ({ ...prev, [field]: val }));
    const err = validateSpecField(field, val);
    setSpecValidationErrors(prev => {
      const copy = { ...prev };
      if (err) {
        copy[field] = err;
      } else {
        delete copy[field];
      }
      return copy;
    });
  };

  const handleStartEditingSpecs = () => {
    if (!selectedTender) return;
    const initialForm = {
      authority: selectedTender.authority || '',
      ref_no: selectedTender.ref_no || '',
      estimated_cost_raw: selectedTender.estimated_cost_raw || '',
      emd_raw: selectedTender.emd_raw || '',
      document_fee_raw: selectedTender.document_fee_raw || '',
      tender_type: selectedTender.tender_type || 'GeM',
      source: selectedTender.source || 'GeM',
      source_id: selectedTender.source_id || '',
      location: selectedTender.location || '',
      place: selectedTender.place || '',
      state: selectedTender.state || '',
      sector: selectedTender.sector || '',
      vertical_name: selectedTender.vertical_name || '',
      publish_date: selectedTender.publish_date || '',
      start_date: selectedTender.start_date || '',
      due_date: selectedTender.due_date || '',
      opening_date: selectedTender.opening_date || '',
      pre_bid_date: selectedTender.pre_bid_date || '',
      time: selectedTender.time || '',
      entry_date: selectedTender.entry_date || '',
      bid_qty: selectedTender.bid_qty !== null && selectedTender.bid_qty !== undefined ? selectedTender.bid_qty : '',
      quoted_qty: selectedTender.quoted_qty !== null && selectedTender.quoted_qty !== undefined ? selectedTender.quoted_qty : '',
      corrigendum_remark: selectedTender.corrigendum_remark || 'No',
      product_name_as_per_tender: selectedTender.product_name_as_per_tender || '',
      product_name_as_per_marken: selectedTender.product_name_as_per_marken || '',
      title: selectedTender.title || '',
      original_url: selectedTender.original_url || ''
    };
    setSpecForm(initialForm);
    setOriginalSpecForm(initialForm);
    // Validate immediately on enter so existing invalid data (e.g. 2026- or maha) is caught and flagged!
    const initialErrors = validateAllSpecFields(initialForm);
    setSpecValidationErrors(initialErrors);
    setIsEditingSpecs(true);
  };

  const handleCancelEditingSpecs = () => {
    setIsEditingSpecs(false);
    if (originalSpecForm) {
      setSpecForm(originalSpecForm);
    }
    setSpecValidationErrors({});
  };

  const handleSaveSpecs = async () => {
    if (!selectedTender || savingSpecs) return;
    
    // Strict full validation before save
    const errors = validateAllSpecFields(specForm);
    if (Object.keys(errors).length > 0) {
      setSpecValidationErrors(errors);
      showToast('Please fix validation errors before saving.', 'error');
      return;
    }

    setSavingSpecs(true);
    try {
      const payload: Record<string, any> = {
        authority: specForm.authority,
        ref_no: specForm.ref_no,
        estimated_cost_raw: specForm.estimated_cost_raw,
        emd_raw: specForm.emd_raw,
        document_fee_raw: specForm.document_fee_raw,
        tender_type: specForm.tender_type,
        source: specForm.source,
        source_id: specForm.source_id,
        location: specForm.location,
        place: specForm.place,
        state: specForm.state,
        sector: specForm.sector,
        vertical_name: specForm.vertical_name,
        publish_date: specForm.publish_date,
        start_date: specForm.start_date,
        due_date: specForm.due_date,
        opening_date: specForm.opening_date,
        pre_bid_date: specForm.pre_bid_date,
        time: specForm.time,
        entry_date: specForm.entry_date,
        bid_qty: specForm.bid_qty === '' ? null : Number(specForm.bid_qty),
        quoted_qty: specForm.quoted_qty === '' ? null : Number(specForm.quoted_qty),
        corrigendum_remark: specForm.corrigendum_remark,
        product_name_as_per_tender: specForm.product_name_as_per_tender,
        product_name_as_per_marken: specForm.product_name_as_per_marken,
        title: specForm.title.trim(),
        original_url: specForm.original_url
      };

      const response = await fetchWithAuth(`/api/tenders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) {
        showToast('Tender specification parameters saved successfully!', 'success');
        setSelectedTender(prev => prev ? { ...prev, ...payload } : null);
        if (payload.bid_qty !== undefined) setBidQty(payload.bid_qty !== null ? payload.bid_qty : '');
        if (payload.quoted_qty !== undefined) setQuotedQty(payload.quoted_qty !== null ? payload.quoted_qty : '');
        setIsEditingSpecs(false);
        setOriginalSpecForm(null);
        setSpecValidationErrors({});
        fetchTenderDetails();
      } else {
        if (data.errors && typeof data.errors === 'object') {
          setSpecValidationErrors(data.errors);
        }
        showToast(data.error || 'Failed to save specification parameters.', 'error');
      }
    } catch (err) {
      console.error('Error saving specification parameters:', err);
      showToast('Error communicating with server while saving parameters.', 'error');
    } finally {
      setSavingSpecs(false);
    }
  };

  const isValidTechSpecFile = (file: File) => {
    const name = file.name.toLowerCase();
    return name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.doc') ||
           name.endsWith('.txt') || name.endsWith('.xlsx') || name.endsWith('.xls');
  };

  const handleTechSpecUpload = async (fileToUpload: File) => {
    if (!selectedTender || !fileToUpload || techSpecUploadInFlight.current) return;
    if (!isValidTechSpecFile(fileToUpload)) {
      showToast('Unsupported file format. Supported formats are PDF, DOCX, TXT, XLSX, and XLS.', 'error');
      return;
    }
    const tenderId = selectedTender.id;
    techSpecUploadInFlight.current = true;
    setUploadingTechSpec(true);
    setTechSpecProgress({
      status: 'UPLOADING',
      message: 'Uploading document & initializing AI extraction...',
      percent: 5,
      completedBatches: 0,
      totalBatches: 0,
      clauses: 0
    });

    let pollInterval: NodeJS.Timeout | null = setInterval(async () => {
      try {
        const res = await fetchWithAuth(`/api/tenders/${tenderId}/tech-spec-progress`);
        if (res.ok) {
          const prog = await res.json();
          if (prog && prog.status) {
            setTechSpecProgress(prog);
          }
        }
      } catch (e) {
        console.error('Progress poll error:', e);
      }
    }, 1000);

    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);
      if (selectedModelId) {
        formData.append('selected_model_id', String(selectedModelId));
      }
      if (scheduleModels && Object.keys(scheduleModels).length > 0) {
        formData.append('schedule_models', JSON.stringify(scheduleModels));
      }
      const response = await fetchWithAuth(`/api/tenders/${tenderId}/upload-tech-spec`, {
        method: 'POST', body: formData,
      });
      const data = await response.json();

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      if (!response.ok || data.success !== true) {
        showToast(data.error || 'Failed to upload technical specification.', 'error');
        setTechSpecProgress(null);
        return;
      }
      if (data.generated === false) {
        showToast(data.message || 'No technical specifications were found.', 'success');
        setTechSpecProgress(null);
        return;
      }
      if (data.generated !== true) {
        showToast('The server did not confirm specification generation.', 'error');
        setTechSpecProgress(null);
        return;
      }
      setTechSpecProgress(prev => ({ ...prev, status: 'COMPLETED', percent: 100, message: 'Technical specification generated successfully!' }));
      showToast(data.message || 'Technical specification sheets generated successfully.', 'success');
      try {
        const refreshed = await fetchWithAuth(`/api/tenders/${tenderId}`);
        if (refreshed.ok) {
          const result = await refreshed.json();
          if (result.success && result.tender) {
            setSelectedTender(prev => prev?.id === tenderId ? { ...prev, ...result.tender } : prev);
          }
        }
      } catch (refreshError) {
        console.error('Sheets were generated, but refreshing tender details failed:', refreshError);
      }
    } catch {
      showToast('Error uploading technical specification.', 'error');
    } finally {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      techSpecUploadInFlight.current = false;
      setTimeout(() => {
        setUploadingTechSpec(false);
        setTechSpecProgress(null);
      }, 1200);
    }
  };

  const postComment = async (phase: string) => {
    let commentBody = '';
    if (phase === 'Spec') {
      commentBody = specCommentText;
      setSpecCommentText('');
    } else if (phase === 'Payment') {
      commentBody = paymentCommentText;
      setPaymentCommentText('');
    } else if (phase === 'Verification') {
      commentBody = verificationCommentText;
      setVerificationCommentText('');
    } else {
      commentBody = submissionCommentText;
      setSubmissionCommentText('');
    }

    if (!commentBody.trim() || !id) return;
    try {
      const response = await fetchWithAuth(`/api/tenders/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: commentBody, phase })
      });
      const data = await response.json();
      if (data.success) {
        showToast('Comment posted successfully!', 'success');
        fetchComments(id);
      } else {
        showToast(data.error || 'Failed to post comment.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const saveNotes = async () => {
    if (!id || !selectedTender) return;
    try {
      setNotesSaving(true);
      const updatedFields: any = {
        notes: tenderNotes
      };

      const response = await fetchWithAuth(`/api/tenders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields)
      });
      const data = await response.json();
      if (data.success) {
        showToast('Notes saved successfully', 'success');
        setSelectedTender(prev => prev ? { ...prev, ...updatedFields } : null);
        fetchTenderDetails();
      } else {
        showToast(data.error || 'Failed to save notes', 'error');
      }
    } catch (e) {
      showToast('Communication error saving notes', 'error');
    } finally {
      setNotesSaving(false);
    }
  };

  const handleAssignAndParticipate = async () => {
    if (!id || !selectedTender || isParticipatingSubmitting) return;

    // 1. Validate that an eligible executive has been selected
    const trimmedExec = (misExecutive || '').trim();
    if (!trimmedExec) {
      showToast('Please select an executive to assign.', 'error');
      return;
    }
    if (executivesList.length > 0 && !executivesList.includes(trimmedExec)) {
      showToast('Selected executive is not in the eligible executives list.', 'error');
      return;
    }

    // 2. Validate Bid Quantity
    const bidQtyErr = validateSpecQuantity(bidQty);
    if (bidQtyErr) {
      showToast(`Bid Quantity: ${bidQtyErr}`, 'error');
      return;
    }

    // 3. Validate Quoted Quantity
    const quotedQtyErr = validateSpecQuantity(quotedQty);
    if (quotedQtyErr) {
      showToast(`Quoted Quantity: ${quotedQtyErr}`, 'error');
      return;
    }

    try {
      setIsParticipatingSubmitting(true);
      const updatedFields: any = {
        status: 'Participating',
        mis_executive: trimmedExec,
        bid_qty: bidQty === '' || bidQty === null ? null : Number(bidQty),
        quoted_qty: quotedQty === '' || quotedQty === null ? null : Number(quotedQty),
        assigned_by: currentUser?.username || 'MIS Team',
        assigned_at: new Date().toISOString()
      };

      const response = await fetchWithAuth(`/api/tenders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields)
      });
      const data = await response.json();

      if (data.success) {
        showToast('Tender assigned and marked as Participating!', 'success');
        setSelectedTender(prev => prev ? { 
          ...prev, 
          ...updatedFields,
          current_stage: prev.current_stage === 'NEW' || !prev.current_stage ? 'SPEC_CLEARANCE' : prev.current_stage 
        } : null);
        await fetchTenderDetails();
      } else {
        showToast(data.error || 'Failed to assign and participate.', 'error');
      }
    } catch (e) {
      showToast('Communication error while updating participation.', 'error');
    } finally {
      setIsParticipatingSubmitting(false);
    }
  };

  const handleNotParticipating = async () => {
    if (!id || !selectedTender || isParticipatingSubmitting) return;

    try {
      setIsParticipatingSubmitting(true);
      const updatedFields = {
        status: 'Not Participating'
      };

      const response = await fetchWithAuth(`/api/tenders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields)
      });
      const data = await response.json();

      if (data.success) {
        showToast('Tender marked as Not Participating.', 'success');
        setSelectedTender(prev => prev ? { ...prev, status: 'Not Participating' } : null);
        await fetchTenderDetails();
      } else {
        showToast(data.error || 'Failed to update status.', 'error');
      }
    } catch (e) {
      showToast('Communication error while updating status.', 'error');
    } finally {
      setIsParticipatingSubmitting(false);
    }
  };

  const openBidDocForm = () => {
    if (!selectedTender) return;
    setBidFormFields({
      orientation: 'portrait',
      bidNumber: selectedTender.id || '',
      bidDate: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD
      authorityName: selectedTender.authority || '',
      authorityDept: '',
      authorityAddress: selectedTender.location || '',
      productDescription: selectedTender.product_name_as_per_tender || selectedTender.title || '',
      requiredQuantity: selectedTender.bid_qty !== null && selectedTender.bid_qty !== undefined ? String(selectedTender.bid_qty) : '300',
      ...COMPANY_PRESETS.me
    });
    setIsBidDocFormOpen(true);
  };

  const handleGenerateBidDocs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTender) return;

    try {
      setGeneratingBidDocs(true);
      showToast('Generating bid documents...', 'success');
      
      const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/generate-bid-docs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bidFormFields)
      });
      
      const data = await res.json();
      setGeneratingBidDocs(false);
      
      if (data.success) {
        showToast('Bid documents (Word & PDF) generated successfully!', 'success');
        setIsBidDocFormOpen(false);
        setSelectedTender(prev => prev ? {
          ...prev,
          current_stage: 'DOC_VERIFICATION',
          verification_status: 'Pending'
        } : null);
        fetchTenderDetails();
      } else {
        showToast(data.error || 'Failed to generate bid documents.', 'error');
      }
    } catch (e) {
      setGeneratingBidDocs(false);
      showToast('Error communicating with server.', 'error');
    }
  };

  if (!mounted || !currentUser) return null;

  const isOutcomeState = selectedTender ? (
    selectedTender.status === 'Submitted' || 
    selectedTender.status === 'Filed' || 
    selectedTender.status === 'Won' || 
    selectedTender.status === 'Lost' || 
    selectedTender.status === 'Awarded' || 
    selectedTender.status === 'Not Awarded' ||
    selectedTender.outcome_status === 'Pending' ||
    selectedTender.current_stage === 'WIN_LOSS_PENDING'
  ) : false;

  const areDocsGenerated = selectedTender ? (isOutcomeState || areBidDocsGenerated(selectedTender)) : false;

  // Sequential Pipeline Stage Visibility:
  // When a tender is at stage 1, do not show remaining stages in the frontend to any user.
  // The horizontal sections in the tender are only visible if previous required changes are completed.
  const isStage1Complete = Boolean(selectedTender && selectedTender.spec_verification_status === 'Approved');
  const isStage2Complete = (isStage1Complete && Boolean(selectedTender && selectedTender.mis_final_price && Number(selectedTender.mis_final_price) > 0)) || isOutcomeState;
  const isStage3Complete = (isStage2Complete && areDocsGenerated) || isOutcomeState;
  const isStage4Complete = (isStage3Complete && Boolean(selectedTender && selectedTender.verification_status === 'Approved')) || isOutcomeState;
  const isStage5Complete = (isStage4Complete && Boolean(selectedTender && selectedTender.payment_status === 'Approved')) || isOutcomeState;
  const isStage6Complete = (isStage5Complete && Boolean(selectedTender && (selectedTender.submission_status === 'Approved' || selectedTender.status === 'Submitted' || selectedTender.status === 'Filed'))) || isOutcomeState;

  const isOperationalRole = currentUser?.role !== 'Specification Team' && currentUser?.role !== 'Clearance Team';
  const isStage1Visible = true; // Stage 1 is always visible
  const isStage2Visible = isOperationalRole && (isStage1Complete || isOutcomeState);
  const isStage3Visible = isOperationalRole && (isStage2Complete || isOutcomeState);
  const isStage4Visible = isOperationalRole && (isStage3Complete || isOutcomeState);
  const isStage5Visible = isOperationalRole && (isStage4Complete || isOutcomeState);
  const isStage6Visible = isOperationalRole && (isStage5Complete || isOutcomeState);
  const isStage7Visible = isOperationalRole && (isStage6Complete || isOutcomeState);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)', padding: '24px' }}>
      
      {/* Toast Notification */}
      <div className={`toast ${toast.show ? 'show' : ''} ${toast.type}`}>
        {toast.type === 'success' ? <CheckCircle2 size={18} className="toast-icon success" /> : <AlertCircle size={18} className="toast-icon error" />}
        <span>{toast.message}</span>
      </div>

      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        
        {/* Header Bar */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => {
                if (isEditingSpecs && hasUnsavedSpecChanges) {
                  if (!window.confirm('You have unsaved changes in Tender Specifications & Parameters. Discard them and leave?')) {
                    return;
                  }
                }
                router.push('/');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px' }}
            >
              <ChevronLeft size={16} /> Back to Dashboard
            </button>
            {selectedTender && (
              <div>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>
                  {selectedTender.product_name_as_per_tender || selectedTender.title}
                </h1>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Tender ID: <strong>{selectedTender.id}</strong> | Reference: <strong>{selectedTender.ref_no || 'N/A'}</strong>
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="theme-toggle-btn" 
              onClick={toggleTheme}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '12px' }}
            >
              {theme === 'dark' ? <Sun size={15} style={{ color: '#f59e0b' }} /> : <Moon size={15} style={{ color: '#6366f1' }} />}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
            {selectedTender && (
              <span className={`status-badge ${selectedTender.status}`} style={{ fontSize: '13px', padding: '6px 14px', borderRadius: '20px', fontWeight: 'bold' }}>
                {selectedTender.status}
              </span>
            )}
          </div>
        </header>

        {loadingDetails || !selectedTender ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0' }}>
            <RefreshCw className="animate-spin" size={32} style={{ color: 'var(--primary)', marginBottom: '16px' }} />
            <p style={{ color: 'var(--text-muted)' }}>Loading tender details...</p>
          </div>
        ) : (
          /* Dynamic Content Stack */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
            
            {/* ==================== SECTION 1: TENDER DETAILS ==================== */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* Row 1: AI Analyses & Notes (Side-by-side grid) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '24px', alignItems: 'stretch' }}>
                
                {/* AI Summaries */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '700', color: 'var(--primary)' }}>AI-Powered Analyses</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Tender Overview Summary</h4>
                        <p style={{ fontSize: '13px', lineHeight: '1.6', margin: 0, color: 'var(--text-secondary)' }}>
                          {detailsSummary || 'No overview summary available.'}
                        </p>
                      </div>
                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Workflow Timeline Progression</h4>
                        <p style={{ fontSize: '13px', lineHeight: '1.6', margin: 0, color: 'var(--text-secondary)' }}>
                          {statusHistorySummary || 'No history summary available.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Assignment & Notes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  {/* Executive & Quantity Assignment - Viewable only for non-MIS roles; for MIS Team, assignment is unified in the Participation Decision Pending section */}
                  {!isMisRole && (
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>Executive & Quantities Assignment</h3>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                              MIS Executive
                            </label>
                            {selectedTender.mis_executive && selectedTender.assigned_by && (
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Assigned by {selectedTender.assigned_by} {selectedTender.assigned_at ? `on ${new Date(selectedTender.assigned_at).toLocaleDateString()}` : ''}
                              </span>
                            )}
                          </div>
                          <input
                            type="text"
                            disabled
                            value={misExecutive || 'Not Assigned'}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-app)',
                              color: 'var(--text-muted)',
                              fontSize: '13px',
                              cursor: 'not-allowed'
                            }}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                              Bid Quantity
                            </label>
                            <input
                              type="number"
                              placeholder="Bid Qty"
                              value={bidQty}
                              disabled
                              style={{
                                padding: '10px 12px',
                                borderRadius: '8px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-app)',
                                color: 'var(--text-primary)',
                                fontSize: '13px',
                                opacity: 0.7,
                                cursor: 'not-allowed'
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                              Quoted Quantity
                            </label>
                            <input
                              type="number"
                              placeholder="Quoted Qty"
                              value={quotedQty}
                              disabled
                              style={{
                                padding: '10px 12px',
                                borderRadius: '8px',
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-app)',
                                color: 'var(--text-primary)',
                                fontSize: '13px',
                                opacity: 0.7,
                                cursor: 'not-allowed'
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Internal Bidding Notes */}
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>Internal Bidding Notes</h3>
                      {!isAdmin && (
                        <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={saveNotes} disabled={notesSaving}>
                          {notesSaving ? 'Saving...' : 'Save Notes'}
                        </button>
                      )}
                    </div>
                    <textarea
                      id="notes-textarea"
                      placeholder={isAdmin ? "Internal bidding notes are view-only for Admin." : "Record credentials, contact details, pricing estimates, task checklists, or notes for this bid..."}
                      value={tenderNotes}
                      disabled={isAdmin}
                      onChange={(e) => setTenderNotes(e.target.value)}
                      style={{ 
                        width: '100%',
                        flexGrow: 1,
                        minHeight: '160px',
                        padding: '10px',
                        borderRadius: '8px',
                        background: 'var(--bg-app)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-primary)',
                        fontSize: '12.5px',
                        lineHeight: '1.5',
                        outline: 'none',
                        resize: 'vertical',
                        opacity: isAdmin ? 0.8 : 1
                      }}
                    />
                  </div>
                </div>

              </div>

              {/* Row 2: Tender Specifications Visual Grid */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building size={18} style={{ color: 'var(--primary)' }} />
                    Tender Specifications & Parameters
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {!isEditingSpecs ? (
                      <button
                        id="btn-edit-parameters"
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleStartEditingSpecs}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px', fontWeight: '600' }}
                      >
                        <Edit3 size={14} /> Edit Parameters
                      </button>
                    ) : (
                      <>
                        <span style={{ fontSize: '11px', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 10px', borderRadius: '12px', fontWeight: '600' }}>
                          ● Edit Mode Active
                        </span>
                        <button
                          id="btn-cancel-parameters"
                          type="button"
                          className="btn btn-secondary"
                          disabled={savingSpecs}
                          onClick={handleCancelEditingSpecs}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 14px', fontWeight: '600' }}
                        >
                          <RotateCcw size={14} /> Cancel
                        </button>
                        <button
                          id="btn-save-parameters"
                          type="button"
                          className="btn btn-primary"
                          disabled={savingSpecs}
                          onClick={handleSaveSpecs}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 16px', fontWeight: '600', minWidth: '120px', justifyContent: 'center' }}
                        >
                          {savingSpecs ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" /> Saving...
                            </>
                          ) : (
                            <>
                              <Save size={14} /> Save Changes
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isEditingSpecs ? (
                  <form onSubmit={(e) => { e.preventDefault(); handleSaveSpecs(); }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                      {/* 1. Procuring Authority */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-authority" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Building size={14} style={{ color: 'var(--primary)' }} /> Procuring Authority
                        </label>
                        <input
                          id="spec-input-authority"
                          type="text"
                          value={specForm.authority}
                          onChange={(e) => handleSpecFieldChange('authority', e.target.value)}
                          style={specValidationErrors.authority ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. Director General of Health Services"
                        />
                        {specValidationErrors.authority && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.authority}</span>
                        )}
                      </div>

                      {/* 2. Official Reference No */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-ref-no" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <FileText size={14} style={{ color: 'var(--primary)' }} /> Official Reference No <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          id="spec-input-ref-no"
                          type="text"
                          value={specForm.ref_no}
                          onChange={(e) => handleSpecFieldChange('ref_no', e.target.value)}
                          style={specValidationErrors.ref_no ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. GEM/2026/B/12345"
                        />
                        {specValidationErrors.ref_no && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.ref_no}</span>
                        )}
                      </div>

                      {/* 3. Estimated Cost */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-estimated-cost-raw" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <DollarSign size={14} style={{ color: 'var(--primary)' }} /> Estimated Cost
                        </label>
                        <input
                          id="spec-input-estimated-cost-raw"
                          type="text"
                          value={specForm.estimated_cost_raw}
                          onChange={(e) => handleSpecFieldChange('estimated_cost_raw', e.target.value)}
                          style={specValidationErrors.estimated_cost_raw ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. ₹ 5,00,000"
                        />
                        {specValidationErrors.estimated_cost_raw && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.estimated_cost_raw}</span>
                        )}
                      </div>

                      {/* 4. EMD Amount Requirement */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-emd-raw" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <DollarSign size={14} style={{ color: 'var(--primary)' }} /> EMD Amount Requirement
                        </label>
                        <input
                          id="spec-input-emd-raw"
                          type="text"
                          value={specForm.emd_raw}
                          onChange={(e) => handleSpecFieldChange('emd_raw', e.target.value)}
                          style={specValidationErrors.emd_raw ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. ₹ 25,000"
                        />
                        {specValidationErrors.emd_raw && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.emd_raw}</span>
                        )}
                      </div>

                      {/* 5. Tender Document Fee */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-document-fee-raw" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Tag size={14} style={{ color: 'var(--primary)' }} /> Tender Document Fee
                        </label>
                        <input
                          id="spec-input-document-fee-raw"
                          type="text"
                          value={specForm.document_fee_raw}
                          onChange={(e) => handleSpecFieldChange('document_fee_raw', e.target.value)}
                          style={specValidationErrors.document_fee_raw ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. ₹ 500"
                        />
                        {specValidationErrors.document_fee_raw && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.document_fee_raw}</span>
                        )}
                      </div>

                      {/* 6. Tender Type (GeM / Non GeM) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-tender-type" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <FileText size={14} style={{ color: 'var(--primary)' }} /> Tender Type (GeM / Non GeM)
                        </label>
                        <select
                          id="spec-input-tender-type"
                          value={specForm.tender_type}
                          onChange={(e) => handleSpecFieldChange('tender_type', e.target.value)}
                          style={specInputStyle}
                        >
                          <option value="GeM">GeM</option>
                          <option value="Non GeM">Non GeM</option>
                          <option value="Custom">Custom</option>
                        </select>
                      </div>

                      {/* 7. Source Portal */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-source" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Globe size={14} style={{ color: 'var(--primary)' }} /> Source Portal
                        </label>
                        <select
                          id="spec-input-source"
                          value={specForm.source}
                          onChange={(e) => handleSpecFieldChange('source', e.target.value)}
                          style={specInputStyle}
                        >
                          <option value="GeM">GeM Portal</option>
                          <option value="Tender247">Tender247 Portal</option>
                        </select>
                      </div>

                      {/* 8. Source ID */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-source-id" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Tag size={14} style={{ color: 'var(--primary)' }} /> Source ID
                        </label>
                        <input
                          id="spec-input-source-id"
                          type="text"
                          value={specForm.source_id}
                          onChange={(e) => handleSpecFieldChange('source_id', e.target.value)}
                          style={specValidationErrors.source_id ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="Source Portal Tender ID"
                        />
                        {specValidationErrors.source_id && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.source_id}</span>
                        )}
                      </div>

                      {/* 9. Location / Region */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-location" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <MapPin size={14} style={{ color: 'var(--primary)' }} /> Location / Region
                        </label>
                        <input
                          id="spec-input-location"
                          type="text"
                          value={specForm.location}
                          onChange={(e) => handleSpecFieldChange('location', e.target.value)}
                          style={specValidationErrors.location ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. Mumbai, MH"
                        />
                        {specValidationErrors.location && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.location}</span>
                        )}
                      </div>

                      {/* 10. Place */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-place" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <MapPin size={14} style={{ color: 'var(--primary)' }} /> Place
                        </label>
                        <input
                          id="spec-input-place"
                          type="text"
                          value={specForm.place}
                          onChange={(e) => handleSpecFieldChange('place', e.target.value)}
                          style={specValidationErrors.place ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. Pune"
                        />
                        {specValidationErrors.place && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.place}</span>
                        )}
                      </div>

                      {/* 11. State */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-state" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <MapPin size={14} style={{ color: 'var(--primary)' }} /> State
                        </label>
                        <input
                          id="spec-input-state"
                          type="text"
                          value={specForm.state}
                          onChange={(e) => handleSpecFieldChange('state', e.target.value)}
                          style={specValidationErrors.state ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. Maharashtra"
                        />
                        {specValidationErrors.state && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.state}</span>
                        )}
                      </div>

                      {/* 12. Sector / Category */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-sector" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Tag size={14} style={{ color: 'var(--primary)' }} /> Sector / Category
                        </label>
                        <input
                          id="spec-input-sector"
                          type="text"
                          value={specForm.sector}
                          onChange={(e) => handleSpecFieldChange('sector', e.target.value)}
                          style={specValidationErrors.sector ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. Healthcare"
                        />
                        {specValidationErrors.sector && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.sector}</span>
                        )}
                      </div>

                      {/* 13. Vertical Name */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-vertical-name" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Tag size={14} style={{ color: 'var(--primary)' }} /> Vertical Name
                        </label>
                        <input
                          id="spec-input-vertical-name"
                          type="text"
                          value={specForm.vertical_name}
                          onChange={(e) => handleSpecFieldChange('vertical_name', e.target.value)}
                          style={specValidationErrors.vertical_name ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. Medical Devices"
                        />
                        {specValidationErrors.vertical_name && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.vertical_name}</span>
                        )}
                      </div>

                      {/* 14. Publish Date */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-publish-date" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Calendar size={14} style={{ color: 'var(--primary)' }} /> Publish Date
                        </label>
                        <input
                          id="spec-input-publish-date"
                          type="text"
                          value={specForm.publish_date}
                          onChange={(e) => handleSpecFieldChange('publish_date', e.target.value)}
                          style={specValidationErrors.publish_date ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="YYYY-MM-DD"
                        />
                        {specValidationErrors.publish_date && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.publish_date}</span>
                        )}
                      </div>

                      {/* 15. Start Date */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-start-date" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Calendar size={14} style={{ color: 'var(--primary)' }} /> Start Date
                        </label>
                        <input
                          id="spec-input-start-date"
                          type="text"
                          value={specForm.start_date}
                          onChange={(e) => handleSpecFieldChange('start_date', e.target.value)}
                          style={specValidationErrors.start_date ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="YYYY-MM-DD"
                        />
                        {specValidationErrors.start_date && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.start_date}</span>
                        )}
                      </div>

                      {/* 16. Closing Due Date */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-due-date" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Calendar size={14} style={{ color: 'var(--primary)' }} /> Closing Due Date
                        </label>
                        <input
                          id="spec-input-due-date"
                          type="text"
                          value={specForm.due_date}
                          onChange={(e) => handleSpecFieldChange('due_date', e.target.value)}
                          style={specValidationErrors.due_date ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="YYYY-MM-DD"
                        />
                        {specValidationErrors.due_date && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.due_date}</span>
                        )}
                      </div>

                      {/* 17. Tender Opening Date */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-opening-date" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Calendar size={14} style={{ color: 'var(--primary)' }} /> Tender Opening Date
                        </label>
                        <input
                          id="spec-input-opening-date"
                          type="text"
                          value={specForm.opening_date}
                          onChange={(e) => handleSpecFieldChange('opening_date', e.target.value)}
                          style={specValidationErrors.opening_date ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="YYYY-MM-DD"
                        />
                        {specValidationErrors.opening_date && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.opening_date}</span>
                        )}
                      </div>

                      {/* 18. Pre-Bid Meeting Date */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-pre-bid-date" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Calendar size={14} style={{ color: 'var(--primary)' }} /> Pre-Bid Meeting Date
                        </label>
                        <input
                          id="spec-input-pre-bid-date"
                          type="text"
                          value={specForm.pre_bid_date}
                          onChange={(e) => handleSpecFieldChange('pre_bid_date', e.target.value)}
                          style={specValidationErrors.pre_bid_date ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="YYYY-MM-DD or No"
                        />
                        {specValidationErrors.pre_bid_date && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.pre_bid_date}</span>
                        )}
                      </div>

                      {/* 19. Bid Submission Time */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-time" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Calendar size={14} style={{ color: 'var(--primary)' }} /> Bid Submission Time
                        </label>
                        <input
                          id="spec-input-time"
                          type="text"
                          value={specForm.time}
                          onChange={(e) => handleSpecFieldChange('time', e.target.value)}
                          style={specValidationErrors.time ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. 15:00:00"
                        />
                        {specValidationErrors.time && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.time}</span>
                        )}
                      </div>

                      {/* 20. Entry Date */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-entry-date" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Calendar size={14} style={{ color: 'var(--primary)' }} /> Entry Date
                        </label>
                        <input
                          id="spec-input-entry-date"
                          type="text"
                          value={specForm.entry_date}
                          onChange={(e) => handleSpecFieldChange('entry_date', e.target.value)}
                          style={specValidationErrors.entry_date ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="YYYY-MM-DD"
                        />
                        {specValidationErrors.entry_date && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.entry_date}</span>
                        )}
                      </div>

                      {/* 21. Scraped At (Read Only) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-color)' }}>
                        <label htmlFor="spec-input-scraped-at" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Lock size={14} style={{ color: 'var(--text-muted)' }} /> Scraped At (System Generated)
                        </label>
                        <input
                          id="spec-input-scraped-at"
                          type="text"
                          disabled
                          readOnly
                          value={selectedTender.scraped_at || 'N/A'}
                          style={{ ...specInputStyle, opacity: 0.6, cursor: 'not-allowed', background: 'rgba(255,255,255,0.03)' }}
                        />
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Read-only system timestamp</span>
                      </div>

                      {/* 22. Bid Quantity */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-bid-qty" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Layers size={14} style={{ color: 'var(--primary)' }} /> Bid Quantity
                        </label>
                        <input
                          id="spec-input-bid-qty"
                          type="text"
                          inputMode="numeric"
                          value={specForm.bid_qty}
                          onChange={(e) => handleSpecFieldChange('bid_qty', e.target.value)}
                          style={specValidationErrors.bid_qty ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. 100"
                        />
                        {specValidationErrors.bid_qty && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.bid_qty}</span>
                        )}
                      </div>

                      {/* 23. Quoted Quantity */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-quoted-qty" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Layers size={14} style={{ color: 'var(--primary)' }} /> Quoted Quantity
                        </label>
                        <input
                          id="spec-input-quoted-qty"
                          type="text"
                          inputMode="numeric"
                          value={specForm.quoted_qty}
                          onChange={(e) => handleSpecFieldChange('quoted_qty', e.target.value)}
                          style={specValidationErrors.quoted_qty ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="e.g. 100"
                        />
                        {specValidationErrors.quoted_qty && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.quoted_qty}</span>
                        )}
                      </div>

                      {/* 24. Corrigendum Remark */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                        <label htmlFor="spec-input-corrigendum-remark" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                          <Activity size={14} style={{ color: 'var(--primary)' }} /> Corrigendum Remark
                        </label>
                        <select
                          id="spec-input-corrigendum-remark"
                          value={specForm.corrigendum_remark}
                          onChange={(e) => handleSpecFieldChange('corrigendum_remark', e.target.value)}
                          style={specInputStyle}
                        >
                          <option value="No">No</option>
                          <option value="Yes">Yes (Alert)</option>
                        </select>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                      {/* Product Name As Per Tender */}
                      <div>
                        <label htmlFor="spec-input-product-name-as-per-tender" style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px' }}>
                          Product Name (As per Tender)
                        </label>
                        <input
                          id="spec-input-product-name-as-per-tender"
                          type="text"
                          value={specForm.product_name_as_per_tender}
                          onChange={(e) => handleSpecFieldChange('product_name_as_per_tender', e.target.value)}
                          style={specValidationErrors.product_name_as_per_tender ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="Product Name as per Tender..."
                        />
                        {specValidationErrors.product_name_as_per_tender && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.product_name_as_per_tender}</span>
                        )}
                      </div>

                      {/* Product Name As Per Marken */}
                      <div>
                        <label htmlFor="spec-input-product-name-as-per-marken" style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px' }}>
                          Product Name (As per Marken)
                        </label>
                        <input
                          id="spec-input-product-name-as-per-marken"
                          type="text"
                          value={specForm.product_name_as_per_marken}
                          onChange={(e) => handleSpecFieldChange('product_name_as_per_marken', e.target.value)}
                          style={specValidationErrors.product_name_as_per_marken ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="Product Name as per Marken..."
                        />
                        {specValidationErrors.product_name_as_per_marken && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>{specValidationErrors.product_name_as_per_marken}</span>
                        )}
                      </div>

                      {/* Full Tender Brief / Description */}
                      <div>
                        <label htmlFor="spec-input-title" style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px' }}>
                          Full Tender Brief / Description <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <textarea
                          id="spec-input-title"
                          rows={3}
                          value={specForm.title}
                          onChange={(e) => handleSpecFieldChange('title', e.target.value)}
                          style={specValidationErrors.title ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="Enter complete tender title / description..."
                        />
                        {specValidationErrors.title && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>
                            {specValidationErrors.title}
                          </span>
                        )}
                      </div>

                      {/* Source URLs */}
                      <div>
                        <label htmlFor="spec-input-original-url" style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700', marginBottom: '6px' }}>
                          Source Portal Details URL <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          id="spec-input-original-url"
                          type="url"
                          value={specForm.original_url}
                          onChange={(e) => handleSpecFieldChange('original_url', e.target.value)}
                          style={specValidationErrors.original_url ? { ...specInputStyle, borderColor: '#ef4444' } : specInputStyle}
                          placeholder="https://..."
                        />
                        {specValidationErrors.original_url && (
                          <span style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px', display: 'block' }}>
                            {specValidationErrors.original_url}
                          </span>
                        )}
                      </div>

                      {/* Bottom Action Bar */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={savingSpecs}
                          onClick={handleCancelEditingSpecs}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 18px', fontWeight: '600' }}
                        >
                          <RotateCcw size={14} /> Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          disabled={savingSpecs || Object.keys(specValidationErrors).length > 0}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '12px',
                            padding: '8px 20px',
                            fontWeight: '600',
                            minWidth: '130px',
                            justifyContent: 'center',
                            opacity: Object.keys(specValidationErrors).length > 0 ? 0.6 : 1,
                            cursor: Object.keys(specValidationErrors).length > 0 ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {savingSpecs ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" /> Saving...
                            </>
                          ) : (
                            <>
                              <Save size={14} /> Save Changes
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                      {[
                        { label: 'Procuring Authority', value: selectedTender.authority, icon: Building },
                        { label: 'Official Reference No', value: selectedTender.ref_no, icon: FileText },
                        { label: 'Estimated Cost', value: selectedTender.estimated_cost_raw, icon: DollarSign, highlight: true },
                        { label: 'EMD Amount Requirement', value: selectedTender.emd_raw, icon: DollarSign },
                        { label: 'Tender Document Fee', value: selectedTender.document_fee_raw, icon: Tag },
                        { label: 'Tender Type (GeM / Non GeM)', value: selectedTender.tender_type, icon: FileText, color: selectedTender.tender_type === 'GeM' ? '#10b981' : '#3b82f6' },
                        { label: 'Source Portal', value: selectedTender.source === 'GeM' ? 'GeM Portal' : 'Tender247 Portal', icon: Globe, color: selectedTender.source === 'GeM' ? '#10b981' : '#3b82f6' },
                        { label: 'Source ID', value: selectedTender.source_id, icon: Tag },
                        { label: 'Location / Region', value: selectedTender.location, icon: MapPin },
                        { label: 'Place', value: selectedTender.place, icon: MapPin },
                        { label: 'State', value: selectedTender.state, icon: MapPin },
                        { label: 'Sector / Category', value: selectedTender.sector, icon: Tag },
                        { label: 'Vertical Name', value: selectedTender.vertical_name, icon: Tag },
                        { label: 'Publish Date', value: selectedTender.publish_date, icon: Calendar },
                        { label: 'Start Date', value: selectedTender.start_date, icon: Calendar },
                        { label: 'Closing Due Date', value: selectedTender.due_date, icon: Calendar },
                        { label: 'Tender Opening Date', value: selectedTender.opening_date, icon: Calendar },
                        { label: 'Pre-Bid Meeting Date', value: selectedTender.pre_bid_date, icon: Calendar },
                        { label: 'Bid Submission Time', value: selectedTender.time, icon: Calendar },
                        { label: 'Entry Date', value: selectedTender.entry_date, icon: Calendar },
                        { label: 'Scraped At', value: selectedTender.scraped_at, icon: Calendar },
                        { label: 'Bid Quantity', value: selectedTender.bid_qty !== null && selectedTender.bid_qty !== undefined ? String(selectedTender.bid_qty) : 'N/A', icon: Layers },
                        { label: 'Quoted Quantity', value: selectedTender.quoted_qty !== null && selectedTender.quoted_qty !== undefined ? String(selectedTender.quoted_qty) : 'N/A', icon: Layers },
                        { label: 'Corrigendum Remark', value: selectedTender.corrigendum_remark === 'Yes' ? 'Yes (Alert)' : 'No', icon: Activity, color: selectedTender.corrigendum_remark === 'Yes' ? '#ef4444' : 'var(--text-secondary)' }
                      ].map((spec, index) => {
                        const Icon = spec.icon;
                        return (
                          <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', color: 'var(--primary)' }}>
                              <Icon size={18} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '600' }}>{spec.label}</span>
                              <span style={{ 
                                fontSize: '13px', 
                                fontWeight: spec.highlight ? '700' : '600', 
                                color: spec.color || 'var(--text-primary)' 
                              }}>
                                {spec.value || 'N/A'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Product Name (As per Tender)</span>
                        <p style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{selectedTender.product_name_as_per_tender || selectedTender.title || 'N/A'}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Product Name (As per Marken)</span>
                        <p style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: '700', color: 'var(--primary)' }}>{selectedTender.product_name_as_per_marken || 'N/A'}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Full Tender Brief / Description</span>
                        <p style={{ margin: '4px 0 0 0', fontSize: '13.5px', color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: '1.5' }}>{selectedTender.title || 'N/A'}</p>
                      </div>
                      <div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Source URLs</span>
                        <div style={{ marginTop: '6px' }}>
                          <a href={selectedTender.original_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 16px', textDecoration: 'none' }}>
                            View Portal Details Page <ExternalLink size={14} />
                          </a>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Row 3: Document Repository (Full width card) */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={18} style={{ color: 'var(--primary)' }} />
                  Document Repository
                </h3>
                
                {(() => {
                  let docList: any[] = [];
                  const rawDocs = selectedTender.downloaded_docs || selectedTender.downloadedDocs;
                  if (rawDocs) {
                    try {
                      docList = typeof rawDocs === 'string' ? JSON.parse(rawDocs) : rawDocs;
                    } catch {
                      docList = [];
                    }
                  }
                  if (!Array.isArray(docList)) docList = [];

                  // Ensure Original Tender Document PDF is always present if document_url / original_url is available
                  const origUrl = selectedTender.document_url || selectedTender.documentUrl || selectedTender.original_url || selectedTender.originalUrl;
                  if (origUrl) {
                    const hasOriginal = docList.some((d: any) => 
                      d.local_path === origUrl || 
                      (d.name && (d.name.toLowerCase().includes('original') || d.name.toLowerCase().includes('gem bid'))) || 
                      (d.filename && (d.filename.toLowerCase().includes('gem_bid') || d.filename.toLowerCase().includes('tender_document')))
                    );
                    if (!hasOriginal) {
                      docList.unshift({
                        name: 'Original GeM Bid Document (PDF)',
                        filename: 'GeM_Bid_Document.pdf',
                        local_path: origUrl,
                        created_date: 'Official Download'
                      });
                    }
                  }
                  
                  if (docList.length === 0) {
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 0', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                        <Inbox size={28} style={{ marginBottom: '8px', opacity: 0.5 }} />
                        <p style={{ fontSize: '12.5px', margin: 0 }}>No documents generated or downloaded for this tender yet.</p>
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                      {docList.map((doc: any, i: number) => {
                        const isPdf = doc.filename?.toLowerCase().endsWith('.pdf');
                        const isDocx = doc.filename?.toLowerCase().endsWith('.docx');
                        
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: '8px', background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden', marginRight: '12px' }}>
                              <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                width: '36px', 
                                height: '36px', 
                                borderRadius: '6px', 
                                background: isPdf ? 'rgba(239, 68, 68, 0.1)' : isDocx ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                color: isPdf ? '#ef4444' : isDocx ? '#3b82f6' : 'var(--text-muted)' 
                              }}>
                                <FileText size={18} />
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <span style={{ fontSize: '12.5px', fontWeight: '700', color: 'var(--text-primary)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }} title={doc.name || doc.filename}>
                                  {doc.name || doc.filename}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  Added: {doc.created_date || 'N/A'}
                                </span>
                              </div>
                            </div>
                            {doc.local_path && (
                              <a 
                                href={doc.local_path} 
                                download={doc.filename}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-secondary"
                                style={{ padding: '6px 12px', fontSize: '11px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                              >
                                <Download size={12} /> Download
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

            </div>

            {/* ==================== SECTION 2: WORKFLOW PIPELINE ==================== */}
            <div style={{ borderTop: '2px dashed var(--border-color)', paddingTop: '28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              
              {/* Participation Decision Section - Exclusive to MIS Team */}
              {isMisRole && (selectedTender.status === 'New' || selectedTender.status === 'Issued' || selectedTender.status === 'Lapsed' || selectedTender.status === 'Not Participating') && (
                <div 
                  id="participation-decision-section"
                  style={{ 
                    background: 'var(--bg-card)', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '12px', 
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px'
                  }}
                >
                  {/* Header & Supporting Text */}
                  <div>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      Participation Decision Pending
                    </h3>
                    <p style={{ margin: '6px 0 0 0', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                      Review this tender, assign it to an executive, and decide whether to participate.
                    </p>
                  </div>

                  {/* Form Controls Grid: Assign to, Bid Quantity, Quoted Quantity */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
                    gap: '16px', 
                    alignItems: 'flex-start' 
                  }}>
                    {/* 1. Assign to: */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <label 
                          htmlFor="assign-to-select" 
                          style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}
                        >
                          Assign to:
                        </label>
                        {selectedTender.mis_executive && selectedTender.assigned_by && (
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Assigned by {selectedTender.assigned_by} {selectedTender.assigned_at ? `on ${new Date(selectedTender.assigned_at).toLocaleDateString()}` : ''}
                          </span>
                        )}
                      </div>
                      <select
                        id="assign-to-select"
                        value={misExecutive}
                        disabled={isParticipatingSubmitting}
                        onChange={(e) => setMisExecutive(e.target.value)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          outline: 'none',
                          cursor: isParticipatingSubmitting ? 'not-allowed' : 'pointer',
                          width: '100%'
                        }}
                      >
                        <option value="">-- Unassigned --</option>
                        {executivesList.map(exec => (
                          <option key={exec} value={exec}>{exec}</option>
                        ))}
                      </select>
                    </div>

                    {/* 2. Bid Quantity */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label 
                        htmlFor="bid-qty-input" 
                        style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}
                      >
                        Bid Quantity
                      </label>
                      <input
                        id="bid-qty-input"
                        type="number"
                        placeholder="Bid Qty"
                        value={bidQty}
                        disabled={isParticipatingSubmitting}
                        onChange={(e) => setBidQty(e.target.value === '' ? '' : Number(e.target.value))}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          outline: 'none',
                          width: '100%',
                          cursor: isParticipatingSubmitting ? 'not-allowed' : 'text'
                        }}
                      />
                    </div>

                    {/* 3. Quoted Quantity */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label 
                        htmlFor="quoted-qty-input" 
                        style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}
                      >
                        Quoted Quantity
                      </label>
                      <input
                        id="quoted-qty-input"
                        type="number"
                        placeholder="Quoted Qty"
                        value={quotedQty}
                        disabled={isParticipatingSubmitting}
                        onChange={(e) => setQuotedQty(e.target.value === '' ? '' : Number(e.target.value))}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          outline: 'none',
                          width: '100%',
                          cursor: isParticipatingSubmitting ? 'not-allowed' : 'text'
                        }}
                      />
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingTop: '4px' }}>
                    <button
                      id="btn-assign-participate"
                      className="btn btn-primary"
                      disabled={isParticipatingSubmitting}
                      onClick={handleAssignAndParticipate}
                      style={{ 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        fontSize: '12.5px', 
                        padding: '8px 16px',
                        fontWeight: '600',
                        opacity: isParticipatingSubmitting ? 0.7 : 1,
                        cursor: isParticipatingSubmitting ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <CheckCircle2 size={16} /> Assign & Participate
                    </button>
                    <button
                      id="btn-not-participating"
                      className="btn btn-secondary"
                      disabled={isParticipatingSubmitting}
                      onClick={handleNotParticipating}
                      style={{ 
                        display: 'inline-flex', 
                        alignItems: 'center', 
                        gap: '6px', 
                        fontSize: '12.5px', 
                        padding: '8px 16px', 
                        color: 'var(--accent-red)', 
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                        fontWeight: '600',
                        opacity: isParticipatingSubmitting ? 0.7 : 1,
                        cursor: isParticipatingSubmitting ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <XCircle size={16} /> Not Participating
                    </button>
                  </div>
                </div>
              )}

              {/* Stepper Card */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  {currentUser?.role === 'Clearance Team' || currentUser?.role === 'Specification Team' ? 'Technical Specification Review' : 'Workflow Pipeline Progress'}
                </h3>
                
                {currentUser?.role === 'Clearance Team' || currentUser?.role === 'Specification Team' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(147, 51, 234, 0.05)', padding: '14px 18px', borderRadius: '8px', border: '1px solid rgba(147, 51, 234, 0.2)' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>Technical Review Status:</span>
                    <span style={{ 
                      fontSize: '12px', 
                      padding: '3px 10px', 
                      borderRadius: '12px', 
                      backgroundColor: selectedTender.spec_verification_status === 'Approved' ? 'rgba(16, 185, 129, 0.1)' : selectedTender.spec_verification_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : selectedTender.spec_verification_status === 'Rejected' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                      color: selectedTender.spec_verification_status === 'Approved' ? '#10b981' : selectedTender.spec_verification_status === 'Pending' ? '#f59e0b' : selectedTender.spec_verification_status === 'Rejected' ? '#ef4444' : 'var(--text-muted)', 
                      fontWeight: '700' 
                    }}>
                      {selectedTender.spec_verification_status || 'Not Started'}
                    </span>
                  </div>
                ) : (
                  <WorkflowPipelineStepper
                    tender={selectedTender}
                    currentUser={currentUser}
                    showStageTitle={true}
                    showActionBanner={true}
                  />
                )}
              </div>

              {/* 1. Technical Specification Clearance Card */}
              <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                  
                  {/* Left Panel: Controls */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>1. Technical Specification Clearance</h4>
                      <span style={{ 
                        fontSize: '11px', 
                        padding: '2px 8px', 
                        borderRadius: '12px', 
                        backgroundColor: selectedTender.spec_verification_status === 'Approved' ? 'rgba(16, 185, 129, 0.1)' : selectedTender.spec_verification_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : selectedTender.spec_verification_status === 'Rejected' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                        color: selectedTender.spec_verification_status === 'Approved' ? '#10b981' : selectedTender.spec_verification_status === 'Pending' ? '#f59e0b' : selectedTender.spec_verification_status === 'Rejected' ? '#ef4444' : 'var(--text-muted)', 
                        fontWeight: '600' 
                      }}>
                        {selectedTender.spec_verification_status || 'Not Started'}
                      </span>
                    </div>

                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
                      Review technical parameters and product specifications. Before bid documents can be generated, the Specification Team must verify and approve technical compliance.
                    </p>

                    {/* Tender Quantities Parameter Badges for Clearance Team Review */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', color: 'var(--primary)' }}>
                          <Layers size={16} />
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700', display: 'block' }}>Bid Quantity</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                            {selectedTender.bid_qty != null ? String(selectedTender.bid_qty) : (selectedTender.bidQty != null ? String(selectedTender.bidQty) : 'N/A')}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(255,255,255,0.04)', color: 'var(--primary)' }}>
                          <Layers size={16} />
                        </div>
                        <div>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700', display: 'block' }}>Quoted Quantity</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                            {selectedTender.quoted_qty != null ? String(selectedTender.quoted_qty) : (selectedTender.quotedQty != null ? String(selectedTender.quotedQty) : 'N/A')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Display Assigned Specification Team Member */}
                    {((selectedTender.spec_verification_status === 'Pending' || selectedTender.spec_verification_status === 'Approved' || currentUser?.role !== 'MIS Executive') && selectedTender.assigned_mis_member_spec) ? (
                      <div style={{ marginBottom: '16px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                        <strong>Target Specification Representative:</strong> <span style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_spec}</span>
                      </div>
                    ) : null}

                    {/* Executive Controls: 2-Phase Sequence (1. Generate/Upload -> 2. Send to Clearance Team) */}
                    {canPerform(currentUser?.role, 'uploadSpecs') && selectedTender.spec_verification_status !== 'Approved' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
                        {(!selectedTender.has_tech_spec && selectedTender.spec_verification_status !== 'Pending' && selectedTender.spec_verification_status !== 'Generated') ? (
                          /* PHASE 1: UPLOAD DOCUMENT TO GENERATE TECHNICAL SPECIFICATION */
                          <div 
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsTechSpecDragOver(true);
                            }}
                            onDragLeave={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsTechSpecDragOver(false);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsTechSpecDragOver(false);
                              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                const droppedFile = e.dataTransfer.files[0];
                                if (!isValidTechSpecFile(droppedFile)) {
                                  showToast('Unsupported file format. Supported formats are PDF, DOCX, TXT, XLSX, and XLS.', 'error');
                                  return;
                                }
                                const inputEl = document.getElementById('tech-spec-file-input-detail') as HTMLInputElement;
                                if (inputEl) {
                                  const dt = new DataTransfer();
                                  dt.items.add(droppedFile);
                                  inputEl.files = dt.files;
                                }
                                handleTechSpecUpload(droppedFile);
                              }
                            }}
                            style={{ 
                              display: 'flex', 
                              flexDirection: 'column', 
                              gap: '10px', 
                              background: isTechSpecDragOver ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.05)', 
                              padding: '12px', 
                              borderRadius: '8px', 
                              border: isTechSpecDragOver ? '2px dashed var(--primary)' : '1px solid rgba(99, 102, 241, 0.2)',
                              transition: 'all 0.2s ease'
                            }}
                          >
                            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--primary)', textTransform: 'uppercase' }}>
                              Step 1: Upload Document to Generate Technical Specification
                            </span>
                            <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0 }}>
                              Upload the tender document or specification file to process and generate the technical specification parameters.
                            </p>

                            {/* Offered Product Model Selection for Evidence Matching */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '10px', background: 'rgba(249, 115, 22, 0.05)', borderRadius: '8px', border: '1px solid rgba(249, 115, 22, 0.2)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <label style={{ fontSize: '10.5px', color: '#f97316', fontWeight: '700', textTransform: 'uppercase' }}>
                                  Offered Product Model (Column 4 Evidence Link)
                                </label>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  {availableModels.length} verified models
                                </span>
                              </div>
                              <select
                                value={selectedModelId}
                                onChange={async (e) => {
                                  const val = e.target.value ? Number(e.target.value) : '';
                                  setSelectedModelId(val);
                                  try {
                                    await fetchWithAuth(`/api/tenders/${id}/offered-models`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ selected_model_id: val || null, schedule_models: scheduleModels }),
                                    });
                                  } catch (ignored) {}
                                }}
                                disabled={uploadingTechSpec}
                                style={{ fontSize: '12px', color: 'var(--text-primary)', padding: '6px 8px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                              >
                                <option value="">-- No Model Selected (Column 4 will remain blank) --</option>
                                {availableModels.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.model_number} ({m.make}) — {m.product_category} [{m.verified_specs || 0} verified specs]
                                  </option>
                                ))}
                              </select>
                              <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>
                                {selectedModelId
                                  ? 'Verified specifications from this model’s manufacturer datasheet will be matched and cited in Column 4.'
                                  : 'Strict evidence rule: Without an offered model, Column 4 strictly remains empty to avoid fabricating specifications.'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Select Specification Document (PDF / DOCX / TXT / XLS / XLSX)</label>
                              <input 
                                type="file" 
                                id="tech-spec-file-input-detail"
                                disabled={uploadingTechSpec}
                                accept=".pdf,.docx,.doc,.txt,.xlsx,.xls"
                                style={{ fontSize: '12px', color: 'var(--text-primary)', padding: '6px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                                onChange={(e) => {
                                  if (e.target.files && e.target.files[0]) {
                                    const file = e.target.files[0];
                                    if (!isValidTechSpecFile(file)) {
                                      showToast('Unsupported file format. Supported formats are PDF, DOCX, TXT, XLSX, and XLS.', 'error');
                                      e.target.value = '';
                                    }
                                  }
                                }}
                              />
                            </div>

                            <button 
                              className="btn btn-primary" 
                              disabled={uploadingTechSpec}
                              style={{ width: '100%', justifyContent: 'center', fontSize: '12.5px', marginTop: '4px' }}
                              onClick={async () => {
                                const inputEl = document.getElementById('tech-spec-file-input-detail') as HTMLInputElement;
                                const fileToUpload = inputEl?.files?.[0];
                                if (!fileToUpload) {
                                  showToast('Please select a specification document to upload first.', 'error');
                                  return;
                                }
                                if (!isValidTechSpecFile(fileToUpload)) {
                                  showToast('Unsupported file format. Supported formats are PDF, DOCX, TXT, XLSX, and XLS.', 'error');
                                  return;
                                }
                                await handleTechSpecUpload(fileToUpload);
                              }}
                            >
                              {uploadingTechSpec ? 'Generating...' : 'Upload & Generate Technical Specification'}
                            </button>
                          </div>
                        ) : (
                          /* PHASE 2: SEND TO CLEARANCE TEAM */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(16, 185, 129, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '12px', fontWeight: '700' }}>
                              <span>✅ Technical Specification document has been created and attached.</span>
                            </div>

                            {selectedTender.spec_verification_status !== 'Pending' ? (
                              <>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Assign Clearance Representative</label>
                                  <select 
                                    value={selectedMisMemberSpec} 
                                    onChange={(e) => {
                                      setSelectedMisMemberSpec(e.target.value);
                                      updateTenderField({ assigned_mis_member_spec: e.target.value });
                                    }}
                                    style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                                  >
                                    <option value="">-- Select Clearance Representative --</option>
                                    {specTeamMembers.map(m => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                </div>

                                <button 
                                  className="btn btn-primary" 
                                  style={{ width: '100%', justifyContent: 'center', opacity: submittingSpecClearance ? 0.7 : 1 }}
                                  disabled={submittingSpecClearance}
                                  onClick={async () => {
                                    if (submittingSpecClearance) return;
                                    if (!selectedMisMemberSpec) {
                                      showToast('Please select a Target Clearance Representative first.', 'error');
                                      alert('Please select a Target Clearance Representative first.');
                                      return;
                                    }
                                    setSubmittingSpecClearance(true);
                                    try {
                                      const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/clearance-request`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ assignedClearanceRep: selectedMisMemberSpec })
                                      });
                                      const data = await res.json();
                                      if (data.success) {
                                        setSelectedTender(prev => prev ? {
                                          ...prev,
                                          spec_verification_status: 'Pending',
                                          current_stage: 'SPEC_CLEARANCE',
                                          assigned_mis_member_spec: selectedMisMemberSpec
                                        } : null);
                                        showToast('Submitted to Clearance Team for Approval!', 'success');
                                        alert('Submitted to Clearance Team for Approval!');
                                        fetchTenderDetails();
                                      } else {
                                        showToast(data.error || 'Failed to submit clearance request', 'error');
                                        alert('Error: ' + (data.error || 'Failed to submit clearance request'));
                                      }
                                    } catch (e) {
                                      showToast('Error communicating with server.', 'error');
                                      alert('Error communicating with server.');
                                    } finally {
                                      setSubmittingSpecClearance(false);
                                    }
                                  }}
                                >
                                  {submittingSpecClearance ? '⏳ Submitting...' : '🚀 Send Technical Specification to Clearance Team'}
                                </button>
                              </>
                            ) : (
                              <div style={{ fontSize: '12px', color: 'var(--accent-yellow)', fontWeight: '600' }}>
                                ⏳ Submitted to Clearance Team for Approval (Pending Clearance Review).
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Clearance Team Verification Controls */}
                    {(currentUser?.role === 'Clearance Team' || currentUser?.role === 'Specification Team') && selectedTender.spec_verification_status === 'Pending' && (
                      canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_spec) ? (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', background: 'rgba(147, 51, 234, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(147, 51, 234, 0.2)' }}>
                          <button 
                            className="btn btn-primary" 
                            style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center', opacity: submittingApproveClearance ? 0.7 : 1 }}
                            disabled={submittingApproveClearance}
                            onClick={async () => {
                              if (submittingApproveClearance) return;
                              setSubmittingApproveClearance(true);
                              try {
                                const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/approve-clearance`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ comment: 'Technical specification verified and approved.' })
                                });
                                const data = await res.json();
                                if (data.notification) {
                                  alert(data.notification);
                                }
                              } catch (e) {
                                console.error('Failed to notify backend on spec clearance:', e);
                              } finally {
                                setSubmittingApproveClearance(false);
                              }
                              await updateTenderField({ spec_verification_status: 'Approved' });
                            }}
                          >
                            {submittingApproveClearance ? '⏳ Approving...' : '✅ Approve Technical Specs'}
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            style={{ flex: 1, color: 'var(--accent-red)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                            onClick={() => updateTenderField({ spec_verification_status: 'Rejected' })}
                          >
                            ❌ Reject Technical Specs
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', color: 'var(--primary-light, #a5b4fc)', marginBottom: '12px' }}>
                          <Shield size={14} style={{ color: 'var(--primary)' }} />
                          <span>View-Only Access · Assigned to: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_spec || 'Clearance Team'}</strong></span>
                        </div>
                      )
                    )}
                  </div>

                  {/* Right Panel: Specification Comment Discussion */}
                  <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    {(() => {
                      const phaseComments = comments.filter(c => c.phase === 'Specification' || c.phase === 'Spec');
                      const isReadonlyRole = currentUser?.role === 'Admin';
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '8px' }}>
                              Specification Discussion ({phaseComments.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', marginBottom: '12px' }}>
                              {phaseComments.length === 0 ? (
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No discussion messages yet.</span>
                              ) : (
                                phaseComments.map((c, i) => (
                                  <div key={i} style={{ background: 'rgba(255, 255, 255, 0.015)', padding: '6px 10px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid rgba(255, 255, 255, 0.02)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '3px' }}>
                                      <span style={{ fontWeight: '700' }}>{c.author || c.username} ({c.author_role})</span>
                                      <span>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                                    </div>
                                    <div style={{ color: 'var(--text-primary)' }}>{c.comment}</div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <input 
                              type="text" 
                              placeholder={isReadonlyRole ? "Discussion is read-only for Admin" : "Discuss specifications..."} 
                              value={specCommentText} 
                              onChange={(e) => setSpecCommentText(e.target.value)} 
                              disabled={isReadonlyRole}
                              style={{ flexGrow: 1, padding: '6px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', opacity: isReadonlyRole ? 0.7 : 1 }}
                            />
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '6px 12px', fontSize: '11px' }}
                              onClick={() => postComment('Spec')}
                              disabled={isReadonlyRole}
                            >
                              Post
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                </div>
              </div>

              {/* 2. Pricing Review & Verification (TPC & MIS) Card */}
              {isStage2Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                        2. Pricing Review & Verification (TPC & MIS)
                      </h4>
                    </div>
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      backgroundColor: selectedTender.mis_final_price ? 'rgba(16, 185, 129, 0.1)' : selectedTender.tpc_purchase_price ? 'rgba(59, 130, 246, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                      color: selectedTender.mis_final_price ? '#10b981' : selectedTender.tpc_purchase_price ? '#3b82f6' : '#f59e0b',
                      fontWeight: '600'
                    }}>
                      {selectedTender.mis_final_price ? 'Provided Price Set' : selectedTender.tpc_purchase_price ? 'Awaiting Provided Price' : 'Pending TPC Review'}
                    </span>
                  </div>

                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.4' }}>
                    The TPC Team submits the Transfer Price (total production cost) to Admin & MIS Team. Admin or MIS Team then sets the Provided Price for the Tender Executive.
                  </p>

                  {/* If user is Tender Executive: strictly hide TPC price per role security */}
                  {(currentUser?.role === 'Tender Executive' || currentUser?.role === 'Executive') ? (
                    <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', background: 'rgba(255, 255, 255, 0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      {selectedTender.mis_final_price ? (
                        <div style={{ color: '#10b981', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>✅ Provided Price:</span>
                          <span style={{ fontSize: '15px', color: '#10b981', fontWeight: '800' }}>₹{Number(selectedTender.mis_final_price).toLocaleString('en-IN')}</span>
                        </div>
                      ) : selectedTender.current_stage === 'MIS_PRICING' ? (
                        <span style={{ color: 'var(--accent-yellow)', fontWeight: '600' }}>
                          ⏳ TPC Team submitted Transfer Price. Awaiting Admin / MIS Team to configure Provided Price.
                        </span>
                      ) : selectedTender.spec_verification_status === 'Approved' ? (
                        <span style={{ color: 'var(--accent-yellow)', fontWeight: '600' }}>
                          ⏳ Specification cleared. Awaiting TPC Team to submit Transfer Price.
                        </span>
                      ) : (
                        <span>⏳ Waiting for Technical Specification Clearance before pricing review.</span>
                      )}
                    </div>
                  ) : (
                    /* For TPC Team, MIS Team, Admin */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {/* Section A: TPC Transfer Price (Total Production Cost) */}
                      {(currentUser?.role === 'TPC Pricing Team' || currentUser?.role === 'TPC Team' || Boolean(selectedTender.tpc_purchase_price)) && (
                        <div style={{ background: selectedTender.tpc_purchase_price ? 'rgba(16, 185, 129, 0.06)' : 'rgba(147, 51, 234, 0.05)', padding: '14px 16px', borderRadius: '8px', border: `1px solid ${selectedTender.tpc_purchase_price ? 'rgba(16, 185, 129, 0.2)' : 'rgba(147, 51, 234, 0.2)'}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: selectedTender.tpc_purchase_price ? '0' : '10px' }}>
                            <div>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: '#9333ea', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                1. TPC Transfer Price (Total Production Cost)
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {selectedTender.tpc_purchase_price ? 'Verified by TPC Team & forwarded securely to Admin and MIS Team' : 'Confidential: Input total production cost for Admin and MIS Team review'}
                              </span>
                            </div>
                            {selectedTender.tpc_purchase_price && (
                              <span style={{ fontSize: '16px', fontWeight: '800', color: '#10b981' }}>
                                ₹{Number(selectedTender.tpc_purchase_price).toLocaleString('en-IN')}
                              </span>
                            )}
                          </div>

                          {/* If TPC Team */}
                          {(currentUser?.role === 'TPC Pricing Team' || currentUser?.role === 'TPC Team') && (
                            <div style={{ marginTop: selectedTender.tpc_purchase_price ? '10px' : '0' }}>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                  type="number"
                                  placeholder={selectedTender.tpc_purchase_price ? `Update transfer price (Current: ₹${Number(selectedTender.tpc_purchase_price).toLocaleString('en-IN')})` : "Enter total production cost / transfer price (₹)..."}
                                  value={tpcPurchasePriceInput}
                                  onChange={(e) => setTpcPurchasePriceInput(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                  style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                                />
                                <button
                                  className="btn btn-primary"
                                  disabled={submittingTpcPrice || !tpcPurchasePriceInput}
                                  onClick={async () => {
                                    if (!tpcPurchasePriceInput || Number(tpcPurchasePriceInput) <= 0) return;
                                    setSubmittingTpcPrice(true);
                                    try {
                                      const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/tpc-price`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ tpcPurchasePrice: tpcPurchasePriceInput })
                                      });
                                      const data = await res.json();
                                      if (data.success) {
                                        showToast(data.message || 'Transfer price submitted!', 'success');
                                        setSelectedTender(prev => prev ? { ...prev, tpc_purchase_price: Number(tpcPurchasePriceInput), current_stage: 'MIS_PRICING' } : null);
                                        setTpcPurchasePriceInput('');
                                        alert(data.message || 'Transfer price forwarded securely to Admin & MIS Team.');
                                      } else {
                                        showToast(data.error || 'Failed to submit price', 'error');
                                      }
                                    } catch (e) {
                                      showToast('Network error submitting price', 'error');
                                    } finally {
                                      setSubmittingTpcPrice(false);
                                    }
                                  }}
                                  style={{ fontSize: '12px', padding: '8px 14px', background: '#9333ea', borderColor: '#9333ea' }}
                                >
                                  {submittingTpcPrice ? 'Submitting...' : '🚀 Send Transfer Price to Admin & MIS'}
                                </button>
                              </div>
                              <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginTop: '6px' }}>
                                🔒 Confidential: Sent to Admin and MIS Team. Not visible to Tender Executive.
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* If MIS Team or Admin and TPC price not yet entered */}
                      {(currentUser?.role === 'MIS Team' || currentUser?.role === 'Admin') && !selectedTender.tpc_purchase_price && (
                        <div style={{ background: 'rgba(245, 158, 11, 0.05)', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)', fontSize: '12px', color: '#d97706' }}>
                          ⏳ <strong>Awaiting TPC Transfer Price:</strong> The TPC Team has not yet submitted the total production cost. Once submitted, MIS Team & Admin can configure the Provided Price for the Tender Executive.
                        </div>
                      )}

                      {/* Section B: Provided Price Configuration */}
                      {(currentUser?.role === 'MIS Team' || currentUser?.role === 'Admin') && (
                        <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '14px 16px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <div>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: '#3b82f6', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                2. Provided Price (For Tender Executive)
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                This final provided price will be visible to the Tender Executive to unblock Bid Document generation.
                              </span>
                            </div>
                            {selectedTender.mis_final_price ? (
                              <span style={{ fontSize: '14px', color: '#10b981', fontWeight: '800' }}>
                                ₹{Number(selectedTender.mis_final_price).toLocaleString('en-IN')}
                              </span>
                            ) : null}
                          </div>
                          {(currentUser?.role === 'MIS Team' || currentUser?.role === 'Admin') ? (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                              <input
                                type="number"
                                placeholder={selectedTender.mis_final_price ? `Update Provided Price (Current: ₹${Number(selectedTender.mis_final_price).toLocaleString('en-IN')})` : "Enter Provided Price (₹)"}
                                value={misFinalPriceInput}
                                onChange={(e) => setMisFinalPriceInput(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12.5px' }}
                              />
                              <button
                                className="btn btn-primary"
                                disabled={submittingMisPrice || !misFinalPriceInput}
                                onClick={async () => {
                                  if (!misFinalPriceInput || Number(misFinalPriceInput) <= 0) return;
                                  setSubmittingMisPrice(true);
                                  try {
                                    const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/mis-price`, {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ misFinalPrice: misFinalPriceInput })
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                      showToast(data.message || 'Provided price configured!', 'success');
                                      setSelectedTender(prev => prev ? { ...prev, mis_final_price: Number(misFinalPriceInput), current_stage: 'BID_DOC_PENDING' } : null);
                                      setMisFinalPriceInput('');
                                      alert(data.message || 'Provided Price released to Tender Executive.');
                                    } else {
                                      showToast(data.error || 'Failed to update Provided Price', 'error');
                                    }
                                  } catch (e) {
                                    showToast('Network error updating Provided Price', 'error');
                                  } finally {
                                    setSubmittingMisPrice(false);
                                  }
                                }}
                                style={{ fontSize: '12px', padding: '8px 14px' }}
                              >
                                {submittingMisPrice ? 'Saving...' : 'Send Provided Price to Executive'}
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                              {selectedTender.mis_final_price ? (
                                <span>Provided Price configured by MIS Team: <strong>₹{Number(selectedTender.mis_final_price).toLocaleString('en-IN')}</strong> (View Only for Admin)</span>
                              ) : (
                                <span>Awaiting MIS Team to configure Provided Price (View Only for Admin).</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 3. Preparation & Bid Documents ("Docs Prep") Card */}
              {isStage3Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>3. Preparation & Bid Documents ("Docs Prep")</h4>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', backgroundColor: areDocsGenerated ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: areDocsGenerated ? '#10b981' : '#f59e0b', fontWeight: '600' }}>
                    {areDocsGenerated ? 'Completed' : 'Pending'}
                  </span>
                </div>
                {!areDocsGenerated ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
                      No bid documents have been generated yet. Use the document builder to compile the PDF/DOCX bundle.
                    </p>
                    {selectedTender.spec_verification_status !== 'Approved' ? (
                      <div style={{
                        background: 'rgba(239, 68, 68, 0.05)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#ef4444',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '8px'
                      }}>
                        <span>🔒</span>
                        <span><strong>Locked:</strong> Technical Specification Clearance from the Clearance Team is required before bid documents can be generated. Current status: <em>{selectedTender.spec_verification_status || 'Not Started'}</em>.</span>
                      </div>
                    ) : (!selectedTender.mis_final_price || Number(selectedTender.mis_final_price) <= 0) ? (
                      <div style={{
                        background: 'rgba(245, 158, 11, 0.05)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        color: '#d97706',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '8px'
                      }}>
                        <span>🔒</span>
                        <span><strong>Locked:</strong> Provided Price from MIS Team is required before bid documents can be generated. (Specification Cleared ✅, Awaiting Provided Price ⏳).</span>
                      </div>
                    ) : (
                      canPerform(currentUser?.role, 'generateBids') && (
                        <button 
                          className="btn btn-primary" 
                          style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}
                          onClick={openBidDocForm}
                        >
                          Generate Bid Documents
                        </button>
                      )
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
                      Bid document package compiled successfully in Word & PDF formats.
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <a 
                        href={`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.docx`} 
                        download 
                        className="btn btn-secondary" 
                        style={{ fontSize: '11px', padding: '6px 10px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        📄 Download Bid Documents (Word)
                      </a>
                      <a 
                        href={`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.pdf`} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="btn btn-secondary" 
                        style={{ fontSize: '11px', padding: '6px 10px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        📑 View Bid Documents (PDF)
                      </a>
                      <a 
                        href={`/documents/${selectedTender.id}/Technical_Specification_Sheet_${selectedTender.id}.pdf`} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="btn btn-secondary" 
                        style={{ fontSize: '11px', padding: '6px 10px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        📑 Tech Spec Sheet (PDF)
                      </a>
                    </div>
                    {selectedTender.working_path && (
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        📁 Working folder: <code>{selectedTender.working_path}</code>
                      </span>
                    )}
                    {canPerform(currentUser?.role, 'generateBids') && (
                      <button 
                        className="btn btn-primary" 
                        style={{ fontSize: '11px', padding: '6px 12px', alignSelf: 'flex-start', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={openBidDocForm}
                      >
                        🔄 Re-Generate Bid Documents
                      </button>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* 4. Generated Bid Documents Approval (MIS Team) Card */}
              {isStage4Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                    
                    {/* Left Panel: Status & Actions */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>4. Generated Bid Documents Approval (MIS Team)</h4>
                        <span style={{ 
                          fontSize: '11px', 
                          padding: '2px 8px', 
                          borderRadius: '12px', 
                          backgroundColor: selectedTender.verification_status === 'Approved' ? 'rgba(16, 185, 129, 0.1)' : selectedTender.verification_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : selectedTender.verification_status === 'Rejected' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                          color: selectedTender.verification_status === 'Approved' ? '#10b981' : selectedTender.verification_status === 'Pending' ? '#f59e0b' : selectedTender.verification_status === 'Rejected' ? '#ef4444' : 'var(--text-muted)', 
                          fontWeight: '600' 
                        }}>
                          {selectedTender.verification_status === 'Approved' ? 'Approved' : selectedTender.verification_status === 'Pending' ? 'Pending MIS Approval' : selectedTender.verification_status === 'Rejected' ? 'Changes Requested' : 'Not Started'}
                        </span>
                      </div>

                      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
                        Review generated Word & PDF bid document package. The MIS Team must verify and authorize documents before EMD payment can proceed.
                      </p>

                      {/* Download Links */}
                      {areDocsGenerated && (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                          <a 
                            href={`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.docx`} 
                            download 
                            className="btn btn-secondary" 
                            style={{ fontSize: '11.5px', padding: '6px 12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                          >
                            <Download size={13} /> DOCX Package
                          </a>
                          <a 
                            href={`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.pdf`} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="btn btn-secondary" 
                            style={{ fontSize: '11.5px', padding: '6px 12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                          >
                            <FileText size={13} /> View PDF
                          </a>
                        </div>
                      )}

                      {/* Working Folder Path (Documents Store) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                          Working Folder Path (Optional Documents Store)
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input 
                            id="working-path-input"
                            type="text" 
                            value={workingPath}
                            onChange={(e) => setWorkingPath(e.target.value)}
                            placeholder="e.g. /Shared/Tenders/2026/GEM-7324078"
                            disabled={!canRecordOperationalStages || selectedTender.verification_status === 'Approved'}
                            style={{ 
                              flexGrow: 1, 
                              padding: '8px 12px', 
                              borderRadius: '6px', 
                              background: 'var(--bg-app)', 
                              border: '1px solid var(--border-color)', 
                              color: 'var(--text-primary)', 
                              fontSize: '13px',
                              opacity: (!canRecordOperationalStages || selectedTender.verification_status === 'Approved') ? 0.6 : 1
                            }}
                          />
                          {canRecordOperationalStages && selectedTender.verification_status !== 'Approved' && (
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '8px 12px', fontSize: '12px' }}
                              onClick={() => updateTenderField({ working_path: workingPath })}
                            >
                              💾 Save Path
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Display assigned MIS Team Representative */}
                      {((selectedTender.verification_status === 'Pending' || selectedTender.verification_status === 'Approved' || !canRecordOperationalStages) && selectedTender.assigned_mis_member_docs) ? (
                        <div style={{ marginBottom: '16px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          <strong>Target MIS Representative:</strong> <span style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_docs}</span>
                        </div>
                      ) : null}

                      {(currentUser?.role === 'Tender Executive' || currentUser?.role === 'Executive') && selectedTender.verification_status !== 'Approved' && selectedTender.verification_status !== 'Pending' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>TARGET MIS TEAM REPRESENTATIVE</label>
                            <select 
                              value={selectedMisMemberDocs} 
                              onChange={(e) => {
                                setSelectedMisMemberDocs(e.target.value);
                                updateTenderField({ assigned_mis_member_docs: e.target.value });
                              }}
                              style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                            >
                              <option value="">-- Select MIS Member --</option>
                              {misTeamMembers.map(m => (
                                  <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                          {!hasWorkingPathSaved(selectedTender) && !workingPath?.trim() && (
                            <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', color: '#f59e0b' }}>
                              ⚠️ <strong>Working Folder Path Required:</strong> Please enter and save the Working Folder Path above before submitting for MIS approval.
                            </div>
                          )}
                          <button 
                            className="btn btn-primary" 
                            disabled={!hasWorkingPathSaved(selectedTender) && !workingPath?.trim()}
                            style={{ width: '100%', justifyContent: 'center', opacity: (hasWorkingPathSaved(selectedTender) || workingPath?.trim()) ? 1 : 0.5, cursor: (hasWorkingPathSaved(selectedTender) || workingPath?.trim()) ? 'pointer' : 'not-allowed' }}
                            onClick={() => {
                              if (!selectedMisMemberDocs) {
                                showToast('Please select a Target MIS Team Representative first.', 'error');
                                alert('Please select a Target MIS Team Representative first.');
                                return;
                              }
                              if (!hasWorkingPathSaved(selectedTender) && !workingPath?.trim()) {
                                showToast('Please enter and save the Working Folder Path first.', 'error');
                                return;
                              }
                              updateTenderField({ verification_status: 'Pending', working_path: workingPath, assigned_mis_member_docs: selectedMisMemberDocs, current_stage: 'DOC_VERIFICATION' });
                            }}
                          >
                            🚀 Submit Bid Documents for MIS Approval
                          </button>
                        </div>
                      )}

                      {selectedTender.verification_status === 'Pending' && (
                        (canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_docs || selectedTender.assigned_mis_member) && isMisRole) ? (
                          <>
                            {!hasWorkingPathSaved(selectedTender) ? (
                              <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>
                                ⚠️ <strong>Working Folder Path Required:</strong> The Tender Executive has not saved the Working Folder Path yet. Bid document approval will unlock once the Working Folder Path is saved.
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                                <button 
                                  className="btn btn-primary" 
                                  style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                                  onClick={() => updateTenderField({ verification_status: 'Approved', current_stage: 'PAYMENT_APPROVAL' })}
                                >
                                  ✅ Approve Bid Documents
                                </button>
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ flex: 1, color: 'var(--accent-red)', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                                  onClick={() => updateTenderField({ verification_status: 'Rejected' })}
                                >
                                  ❌ Request Changes
                                </button>
                              </div>
                            )}
                          </>
                        ) : isMisRole ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', color: 'var(--primary-light, #a5b4fc)', marginBottom: '12px' }}>
                            <Shield size={14} style={{ color: 'var(--primary)' }} />
                            <span>View-Only Access · Assigned to: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_docs || selectedTender.assigned_mis_member || 'MIS Team'}</strong></span>
                          </div>
                        ) : null
                      )}
                    </div>

                    {/* Right Panel: Comment Discussion */}
                    <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      {(() => {
                        const phaseComments = comments.filter(c => c.phase === 'Verification');
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '8px' }}>
                                Verification Discussion ({phaseComments.length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', marginBottom: '12px' }}>
                                {phaseComments.length === 0 ? (
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No discussion messages yet.</span>
                                ) : (
                                  phaseComments.map((c, i) => (
                                    <div key={i} style={{ background: 'rgba(255, 255, 255, 0.015)', padding: '6px 10px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid rgba(255, 255, 255, 0.02)' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '3px' }}>
                                        <span style={{ fontWeight: '700' }}>{c.author || c.username} ({c.author_role})</span>
                                        <span>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                                      </div>
                                      <div style={{ color: 'var(--text-primary)' }}>{c.comment}</div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <input 
                                type="text" 
                                placeholder={currentUser?.role === 'Admin' ? "Discussion is read-only" : "Discuss verification..."} 
                                value={verificationCommentText} 
                                onChange={(e) => setVerificationCommentText(e.target.value)} 
                                disabled={currentUser?.role === 'Admin'}
                                style={{ flexGrow: 1, padding: '6px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', opacity: currentUser?.role === 'Admin' ? 0.7 : 1 }}
                              />
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '11px' }}
                                onClick={() => postComment('Verification')}
                                disabled={currentUser?.role === 'Admin'}
                              >
                                Post
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                  </div>
                </div>
              )}

              {/* 5. EMD Payment Card */}
              {isStage5Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                    
                    {/* Left Panel: Fields */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>5. EMD Payment Details</h4>
                        <span style={{ 
                          fontSize: '11px', 
                          padding: '2px 8px', 
                          borderRadius: '12px', 
                          backgroundColor: selectedTender.payment_status === 'Approved' ? 'rgba(16, 185, 129, 0.1)' : selectedTender.payment_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : selectedTender.payment_status === 'Rejected' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                          color: selectedTender.payment_status === 'Approved' ? '#10b981' : selectedTender.payment_status === 'Pending' ? '#f59e0b' : selectedTender.payment_status === 'Rejected' ? '#ef4444' : 'var(--text-muted)', 
                          fontWeight: '600' 
                        }}>
                          {selectedTender.payment_status || 'Not Started'}
                        </span>
                      </div>

                      {selectedTender.verification_status !== 'Approved' && (!selectedTender.payment_status || selectedTender.payment_status === 'None') ? (
                        <div style={{
                          background: 'rgba(239, 68, 68, 0.05)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          padding: '12px 14px',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#ef4444',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}>
                          <span>🔒</span>
                          <span><strong>Locked:</strong> Generated Bid Documents must be approved by the MIS Team in Step 4 before EMD Payment can be processed. (Current Bid Docs Status: <em>{selectedTender.verification_status || 'Pending Generation'}</em>).</span>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>EMD PAYMENT MODE</label>
                              <input 
                                id="emd-mode-input"
                                type="text" 
                                value={emdPaymentMode}
                                onChange={(e) => setEmdPaymentMode(e.target.value)}
                                placeholder="e.g. Online / DD / BG"
                                disabled={selectedTender.payment_status === 'Approved' || !canRecordOperationalStages}
                                style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>ACTUAL AMOUNT (₹)</label>
                              <input 
                                id="emd-amount-input"
                                type="number" 
                                value={emdAmountActual}
                                onChange={(e) => setEmdAmountActual(e.target.value === '' ? '' : Number(e.target.value))}
                                placeholder="e.g. 50000"
                                disabled={selectedTender.payment_status === 'Approved' || !canRecordOperationalStages}
                                style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>REFERENCE / TXN ID</label>
                              <input 
                                id="emd-ref-input"
                                type="text" 
                                value={emdPaymentRef}
                                onChange={(e) => setEmdPaymentRef(e.target.value)}
                                placeholder="e.g. TXN-9402850"
                                disabled={selectedTender.payment_status === 'Approved' || !canRecordOperationalStages}
                                style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                              />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>PAYMENT DATE</label>
                              <input 
                                id="emd-date-input"
                                type="date" 
                                value={emdPaymentDate}
                                onChange={(e) => setEmdPaymentDate(e.target.value)}
                                disabled={selectedTender.payment_status === 'Approved' || !canRecordOperationalStages}
                                style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                              />
                            </div>
                          </div>

                          {/* Action buttons */}
                          {selectedTender.payment_status !== 'Approved' && canRecordOperationalStages && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>TARGET MIS TEAM REPRESENTATIVE</label>
                                <select 
                                  value={selectedMisMemberEmd} 
                                  onChange={(e) => {
                                    setSelectedMisMemberEmd(e.target.value);
                                    updateTenderField({ assigned_mis_member_emd: e.target.value });
                                  }}
                                  style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                                >
                                  <option value="">-- Select MIS Member --</option>
                                  {misTeamMembers.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ flex: 1, padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                                  onClick={() => {
                                    updateTenderField({
                                      emd_payment_mode: emdPaymentMode,
                                      emd_amount_actual: emdAmountActual === '' ? null : Number(emdAmountActual),
                                      emd_payment_ref: emdPaymentRef,
                                      emd_payment_date: emdPaymentDate,
                                      assigned_mis_member_emd: selectedMisMemberEmd
                                    });
                                  }}
                                >
                                  💾 Save Payment Details
                                </button>
                                <button 
                                  className="btn btn-primary" 
                                  style={{ flex: 1.5, padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                                  onClick={() => {
                                    if (!selectedMisMemberEmd) {
                                      showToast('Please select a Target MIS Team Representative first.', 'error');
                                      alert('Please select a Target MIS Team Representative first.');
                                      return;
                                    }
                                    updateTenderField({
                                      emd_payment_mode: emdPaymentMode,
                                      emd_amount_actual: emdAmountActual === '' ? null : Number(emdAmountActual),
                                      emd_payment_ref: emdPaymentRef,
                                      emd_payment_date: emdPaymentDate,
                                      assigned_mis_member_emd: selectedMisMemberEmd,
                                      payment_status: 'Pending'
                                    });
                                  }}
                                >
                                  🚀 Submit for MIS Approval
                                </button>
                              </div>
                            </div>
                          )}

                          {/* MIS Verification Controls */}
                          {selectedTender.payment_status === 'Pending' && (
                            (canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_emd || selectedTender.assigned_mis_member) && isMisRole) ? (
                              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', marginTop: '12px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                                <button 
                                  className="btn btn-primary" 
                                  style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                                  onClick={() => updateTenderField({ payment_status: 'Approved', current_stage: 'SUBMISSION_PENDING' })}
                                >
                                  ✅ Approve Payment
                                </button>
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ flex: 1, color: 'var(--accent-red)', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                                  onClick={() => updateTenderField({ payment_status: 'Rejected' })}
                                >
                                  ❌ Reject Payment
                                </button>
                              </div>
                            ) : isMisRole ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', color: 'var(--primary-light, #a5b4fc)', marginBottom: '12px', marginTop: '12px' }}>
                                <Shield size={14} style={{ color: 'var(--primary)' }} />
                                <span>View-Only Access · Assigned to: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_emd || selectedTender.assigned_mis_member || 'MIS Team'}</strong></span>
                              </div>
                            ) : null
                          )}
                        </>
                      )}
                    </div>

                    {/* Right Panel: Comment Discussion */}
                    <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      {(() => {
                        const phaseComments = comments.filter(c => c.phase === 'Payment');
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '8px' }}>
                                EMD Discussion ({phaseComments.length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', marginBottom: '12px' }}>
                                {phaseComments.length === 0 ? (
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No discussion messages yet.</span>
                                ) : (
                                  phaseComments.map((c, i) => (
                                    <div key={i} style={{ background: 'rgba(255, 255, 255, 0.015)', padding: '6px 10px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid rgba(255, 255, 255, 0.02)' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '3px' }}>
                                        <span style={{ fontWeight: '700' }}>{c.author || c.username} ({c.author_role})</span>
                                        <span>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                                      </div>
                                      <div style={{ color: 'var(--text-primary)' }}>{c.comment}</div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <input 
                                type="text" 
                                placeholder={currentUser?.role === 'Admin' ? "Discussion is read-only" : "Discuss payment..."} 
                                value={paymentCommentText} 
                                onChange={(e) => setPaymentCommentText(e.target.value)} 
                                disabled={currentUser?.role === 'Admin'}
                                style={{ flexGrow: 1, padding: '6px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', opacity: currentUser?.role === 'Admin' ? 0.7 : 1 }}
                              />
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '11px' }}
                                onClick={() => postComment('Payment')}
                                disabled={currentUser?.role === 'Admin'}
                              >
                                Post
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                  </div>
                </div>
              )}

              {/* 6. Submission Verification Card */}
              {isStage6Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                    
                    {/* Left Panel: Status & Actions */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>6. Submission Verification</h4>
                        <span style={{ 
                          fontSize: '11px', 
                          padding: '2px 8px', 
                          borderRadius: '12px', 
                          backgroundColor: selectedTender.submission_status === 'Approved' ? 'rgba(16, 185, 129, 0.1)' : selectedTender.submission_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                          color: selectedTender.submission_status === 'Approved' ? '#10b981' : selectedTender.submission_status === 'Pending' ? '#f59e0b' : 'var(--text-muted)', 
                          fontWeight: '600' 
                        }}>
                          {selectedTender.submission_status || 'Not Started'}
                        </span>
                      </div>

                      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
                        Upload bid pack to the official portal (GeM / Tender247). Once submission screenshot is verified, mark the submission as complete.
                      </p>

                      {canRecordOperationalStages && selectedTender.submission_status !== 'Approved' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>TARGET MIS TEAM REPRESENTATIVE</label>
                            <select 
                              value={selectedMisMemberSubmission} 
                              onChange={(e) => {
                                setSelectedMisMemberSubmission(e.target.value);
                                updateTenderField({ assigned_mis_member_submission: e.target.value });
                              }}
                              style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                            >
                              <option value="">-- Select MIS Member --</option>
                              {misTeamMembers.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                          <button 
                            className="btn btn-primary" 
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={() => {
                              if (!selectedMisMemberSubmission) {
                                showToast('Please select a Target MIS Team Representative first.', 'error');
                                alert('Please select a Target MIS Team Representative first.');
                                return;
                              }
                              updateTenderField({ submission_status: 'Pending', assigned_mis_member_submission: selectedMisMemberSubmission });
                            }}
                          >
                            🚀 Request Submission Verification
                          </button>
                        </div>
                      )}

                      {(!canRecordOperationalStages || selectedTender.submission_status === 'Approved') && selectedTender.assigned_mis_member_submission && (
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                          <strong>Target MIS Representative:</strong> <span style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_submission}</span>
                        </div>
                      )}

                      {selectedTender.submission_status === 'Pending' && (
                        (canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_submission || selectedTender.assigned_mis_member) && isMisRole) ? (
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                            <button 
                              className="btn btn-primary" 
                              style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                              onClick={() => updateTenderField({ submission_status: 'Approved', outcome_status: 'Pending', current_stage: 'WIN_LOSS_PENDING', status: 'Submitted' })}
                            >
                              ✅ Verify & Mark Submitted
                            </button>
                          </div>
                        ) : isMisRole ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', color: 'var(--primary-light, #a5b4fc)', marginBottom: '12px' }}>
                            <Shield size={14} style={{ color: 'var(--primary)' }} />
                            <span>View-Only Access · Assigned to: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_submission || selectedTender.assigned_mis_member || 'MIS Team'}</strong></span>
                          </div>
                        ) : null
                      )}
                    </div>

                    {/* Right Panel: Comment Discussion */}
                    <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      {(() => {
                        const phaseComments = comments.filter(c => c.phase === 'Submission');
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '8px' }}>
                                Submission Discussion ({phaseComments.length})
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', marginBottom: '12px' }}>
                                {phaseComments.length === 0 ? (
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>No discussion messages yet.</span>
                                ) : (
                                  phaseComments.map((c, i) => (
                                    <div key={i} style={{ background: 'rgba(255, 255, 255, 0.015)', padding: '6px 10px', borderRadius: '6px', fontSize: '11.5px', border: '1px solid rgba(255, 255, 255, 0.02)' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '3px' }}>
                                        <span style={{ fontWeight: '700' }}>{c.author || c.username} ({c.author_role})</span>
                                        <span>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</span>
                                      </div>
                                      <div style={{ color: 'var(--text-primary)' }}>{c.comment}</div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <input 
                                type="text" 
                                placeholder={currentUser?.role === 'Admin' ? "Discussion is read-only for Admin" : "Discuss submission..."} 
                                value={submissionCommentText} 
                                onChange={(e) => setSubmissionCommentText(e.target.value)} 
                                disabled={currentUser?.role === 'Admin'}
                                style={{ flexGrow: 1, padding: '6px 10px', fontSize: '11.5px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', opacity: currentUser?.role === 'Admin' ? 0.7 : 1 }}
                              />
                              <button 
                                className="btn btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '11px' }}
                                onClick={() => postComment('Submission')}
                                disabled={currentUser?.role === 'Admin'}
                              >
                                Post
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                  </div>
                </div>
              )}

              {/* 5. Final Outcome Declaration Card */}
              {isStage7Visible && (() => {
                const isWon = selectedTender.status === 'Awarded' || selectedTender.status === 'Won' || selectedTender.outcome_status === 'Won' || selectedTender.current_stage === 'WON';
                const isLost = selectedTender.status === 'Not Awarded' || selectedTender.status === 'Lost' || selectedTender.outcome_status === 'Lost' || selectedTender.current_stage === 'LOST';
                return (
                  <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>6. Final Bidding Outcome</h4>
                      <span style={{ 
                        fontSize: '11px', 
                        padding: '2px 8px', 
                        borderRadius: '12px', 
                        backgroundColor: isWon 
                          ? 'rgba(16, 185, 129, 0.1)' 
                          : isLost 
                            ? 'rgba(239, 68, 68, 0.1)' 
                            : 'rgba(245, 158, 11, 0.1)', 
                        color: isWon 
                          ? '#10b981' 
                          : isLost 
                            ? '#ef4444' 
                            : '#f59e0b', 
                        fontWeight: '600' 
                      }}>
                        {isWon ? 'Won' : isLost ? 'Lost' : 'Pending'}
                      </span>
                    </div>
                    
                    {isWon && (
                      <div style={{
                        background: 'rgba(16, 185, 129, 0.05)',
                        border: '1px solid rgba(16, 185, 129, 0.25)',
                        borderRadius: '8px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '8px',
                        textAlign: 'center'
                      }}>
                        <span style={{ fontSize: '24px' }}>🎉</span>
                        <h5 style={{ margin: 0, color: 'var(--accent-green)', fontWeight: '700', fontSize: '15px' }}>Tender Won / Awarded</h5>
                        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          Congratulations! The bid has been successfully won and marked as Awarded.
                        </p>
                      </div>
                    )}

                    {isLost && (
                      <div style={{
                        background: 'rgba(239, 68, 68, 0.05)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        borderRadius: '8px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        <h5 style={{ margin: 0, color: 'var(--accent-red)', fontWeight: '700', fontSize: '15px' }}>
                          Tender Lost
                        </h5>
                        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          The bidding outcome has been marked as Lost/Not Awarded.
                        </p>
                        {selectedTender.loss_reason && (
                          <div style={{ background: 'rgba(255, 255, 255, 0.015)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.03)', fontSize: '12px', color: 'var(--text-primary)', marginTop: '4px' }}>
                            <strong>Reason for Loss:</strong> {selectedTender.loss_reason}
                          </div>
                        )}
                      </div>
                    )}

                    {(() => {
                      const canRecordOutcome = isMisRole && canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_submission || selectedTender.assigned_mis_member);
                      if (canRecordOutcome && !isWon && !isLost) {
                        return (
                          <>
                            {/* Loss Reason Input */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                              <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Reason for Loss (Filled if Lost)</label>
                              <textarea 
                                id="loss-reason-textarea"
                                value={lossReason}
                                onChange={(e) => setLossReason(e.target.value)}
                                placeholder="State reason for loss (e.g. L1 Price difference, technical qualification failure, etc.)..."
                                style={{ minHeight: '60px', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                              />
                              <button 
                                className="btn btn-secondary" 
                                style={{ padding: '6px 12px', fontSize: '11px', alignSelf: 'flex-end', marginTop: '4px' }}
                                onClick={() => updateTenderField({ loss_reason: lossReason })}
                              >
                                💾 Save Reason
                              </button>
                            </div>

                            {/* Outcome Choice Action Buttons */}
                            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                              <button 
                                className="btn btn-primary" 
                                style={{ flex: 1, background: '#10b981', borderColor: '#10b981', color: '#ffffff', padding: '9px 16px', justifyContent: 'center', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => updateTenderField({ status: 'Awarded', outcome_status: 'Won', current_stage: 'WON' })}
                              >
                                🏆 Mark as Won
                              </button>
                              <button 
                                className="btn btn-secondary" 
                                style={{ flex: 1, color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.05)', padding: '9px 16px', justifyContent: 'center', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}
                                onClick={() => updateTenderField({ status: 'Not Awarded', outcome_status: 'Lost', current_stage: 'LOST', loss_reason: lossReason || 'Not Awarded' })}
                              >
                                ❌ Mark as Lost
                              </button>
                            </div>
                          </>
                        );
                      }
                      if (!isWon && !isLost) {
                        return (
                          <div style={{ padding: '12px', background: 'rgba(99, 102, 241, 0.08)', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.25)', fontSize: '12.5px', color: 'var(--primary-light, #a5b4fc)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Shield size={14} style={{ color: 'var(--primary)' }} />
                            <span>View-Only Access · Outcome pending. Final outcome selection is reserved for {selectedTender.assigned_mis_member_submission || selectedTender.assigned_mis_member ? `assigned MIS Representative: ${selectedTender.assigned_mis_member_submission || selectedTender.assigned_mis_member}` : 'MIS Team'}.</span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Generate Bid Documents Input Form Modal */}
      {isBidDocFormOpen && (
        <div className="modal-backdrop" onClick={() => setIsBidDocFormOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title">Generate Bid Documents</h3>
              <button className="modal-close" onClick={() => setIsBidDocFormOpen(false)}>
                <X size={18} />
              </button>
            </header>

            <form onSubmit={handleGenerateBidDocs} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                  Please fill out the corporate and dynamic signatory parameters below to compile the official 15-document bid package:
                </p>

                {/* Form Sections */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  
                  {/* Tender details */}
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary)' }}>Tender Parameters</h4>
                    <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)', marginBottom: '12px' }}>
                      <label style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>🏢 Letterhead & Template Format</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select Company</label>
                          <select
                            value={bidFormFields.companyKey || 'me'}
                            onChange={(e) => {
                              const val = e.target.value as 'me' | 'healthtech';
                              const preset = COMPANY_PRESETS[val] || COMPANY_PRESETS.me;
                              setBidFormFields(prev => ({
                                ...prev,
                                ...preset
                              }));
                            }}
                            style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: '600' }}
                          >
                            <option value="me">Mark Enterprises (ME)</option>
                            <option value="healthtech">Healthtech Limited (Marken)</option>
                          </select>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Bid / Tender ID</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.bidNumber}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, bidNumber: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Publish Date</label>
                        <input 
                          type="date" 
                          required 
                          value={bidFormFields.bidDate}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, bidDate: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Procuring Authority Name</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.authorityName}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, authorityName: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Procuring Department</label>
                        <input 
                          type="text" 
                          placeholder="e.g. BD & IT Department"
                          value={bidFormFields.authorityDept}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, authorityDept: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Authority Address/City</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.authorityAddress}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, authorityAddress: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Product Scope / Description</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.productDescription}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, productDescription: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bidder details */}
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary)' }}>Bidder Corporate Details</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Bidder Company Name</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.companyName}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, companyName: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Company Contact Phone</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.companyContact}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, companyContact: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Company Address</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.companyAddress}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, companyAddress: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Company Email Address</label>
                        <input 
                          type="email" 
                          required 
                          value={bidFormFields.companyEmail}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, companyEmail: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Company Website URL</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.companyWebsite}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, companyWebsite: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Signatory details */}
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary)' }}>Signatory & Witness Parameters</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Authorized Signatory Name</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.signatoryName}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, signatoryName: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Signatory Designation</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.signatoryDesignation}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, signatoryDesignation: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Signatory Address</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.signatoryAddress}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, signatoryAddress: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Witness Name & Designation</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.witnessDetails}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, witnessDetails: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Policy clauses */}
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary)' }}>Policy & Location Compliance</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Local Content Percentage (%)</label>
                        <input 
                          type="number" 
                          required 
                          value={bidFormFields.localContentPercentage}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, localContentPercentage: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Preference Policy Clause</label>
                        <select 
                          value={bidFormFields.preferencePolicy}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, preferencePolicy: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                        >
                          <option value="yes">Yes (Prefer Local content)</option>
                          <option value="no">No preference</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Local Content Audit Place</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.localContentLocation}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, localContentLocation: e.target.value }))}
                          placeholder="e.g. New Delhi Plant"
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Audit City / Location Place</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.place}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, place: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                    </div>
                  </div>
                </div>

                  {/* Technical Compliance Details */}
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--primary)' }}>Technical Compliance Details</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Make / Brand</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.make}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, make: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Model Name / Number</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.model}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, model: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Required Quantity</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.requiredQuantity}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, requiredQuantity: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Compliance Sheet Company Name</label>
                        <input 
                          type="text" 
                          required 
                          value={bidFormFields.companyNameCompliance}
                          onChange={(e) => setBidFormFields(prev => ({ ...prev, companyNameCompliance: e.target.value }))}
                          style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                        />
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              <footer className="modal-footer" style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setIsBidDocFormOpen(false)}
                  disabled={generatingBidDocs}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={generatingBidDocs}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  {generatingBidDocs ? (
                    <>
                      <Loader2Icon className="animate-spin" size={14} /> Generating...
                    </>
                  ) : (
                    'Generate Packages (15 Docs)'
                  )}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* Floating Active Session Indicator */}
      {currentUser && (
        <div className="active-session-indicator" style={{ left: '24px' }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: currentUser.role === 'Admin' ? '#f59e0b' : currentUser.role === 'MIS Team' ? '#10b981' : currentUser.role === 'Clearance Team' ? '#8b5cf6' : currentUser.role === 'TPC Pricing Team' || currentUser.role === 'TPC Team' ? '#ec4899' : 'var(--primary)',
            boxShadow: `0 0 6px ${currentUser.role === 'Admin' ? '#f59e0b' : currentUser.role === 'MIS Team' ? '#10b981' : currentUser.role === 'Clearance Team' ? '#8b5cf6' : currentUser.role === 'TPC Pricing Team' || currentUser.role === 'TPC Team' ? '#ec4899' : 'var(--primary)'}`
          }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.5px' }}>
              Active Session
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '600' }}>
              {currentUser.username} • <span style={{ color: 'var(--primary)' }}>{currentUser.role}</span>
            </span>
          </div>
        </div>
      )}

    </div>
  );
}

// Simple loader helper icon
function Loader2Icon({ className, size }: { className?: string; size?: number }) {
  return <RefreshCw className={className} size={size} />;
}
