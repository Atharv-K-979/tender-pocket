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
import { canPerform, canReviewAssignment, isAuthorizedForEmdReceipt } from '@/lib/workflowAuthorization';
import WorkflowPipelineStepper from '@/app/components/WorkflowPipelineStepper';
import { areBidDocsGenerated, hasWorkingPathSaved } from '@/lib/tenderStatus';
import { getClassificationDisplay, getClassificationLabel, getSourceBadgeLabel, getSourcePortalLabel } from '@/lib/tenderClassification';

interface Toast {
  message: string;
  type: 'success' | 'error';
  show: boolean;
}

// Values that mean "nobody assigned" even though the column is non-empty. The retired
// gemSyncEngine importer stored mis_executive as 'Unassigned', and those rows are still in the DB.
const UNASSIGNED_EXECUTIVE_PLACEHOLDERS = ['unassigned', 'not assigned', 'n/a', 'none', 'null', '-'];

/** The executive actually assigned to a tender, or '' when none is (blank or a placeholder value). */
function assignedExecutiveOf(misExecutive: string | null | undefined): string {
  const value = (misExecutive || '').trim();
  return UNASSIGNED_EXECUTIVE_PLACEHOLDERS.includes(value.toLowerCase()) ? '' : value;
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
  const isExecutiveRole = currentUser?.role === 'Tender Executive' || currentUser?.role === 'Executive';
  const isMisRole = currentUser?.role === 'MIS Team' || currentUser?.role === 'MIS';
  const isTpcRole = currentUser?.role === 'TPC Pricing Team' || currentUser?.role === 'TPC Team';
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
  const [selectedMisMemberTpc, setSelectedMisMemberTpc] = useState('');
  const [selectedMisMemberPricingRoute, setSelectedMisMemberPricingRoute] = useState('');
  const [routingPricing, setRoutingPricing] = useState(false);
  
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
  const [submittingDocDecision, setSubmittingDocDecision] = useState(false);
  const [submittingSpecClearance, setSubmittingSpecClearance] = useState(false);
  const [submittingApproveClearance, setSubmittingApproveClearance] = useState(false);
  const [clearanceMode, setClearanceMode] = useState<'ALL COMPLY' | 'COMPLY WITH DEVIATIONS'>('ALL COMPLY');
  const [clearancePdfFile, setClearancePdfFile] = useState<File | null>(null);
  const [clearanceDocxFile, setClearanceDocxFile] = useState<File | null>(null);
  const [clearanceXlsxFile, setClearanceXlsxFile] = useState<File | null>(null);

  const getDocDownloadUrl = (pathOrUrl: string) => {
    if (!pathOrUrl) return '';
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) return pathOrUrl;
    const separator = pathOrUrl.includes('?') ? '&' : '?';
    return `${pathOrUrl}${separator}token=${encodeURIComponent(token)}`;
  };

  const [manifestDocs, setManifestDocs] = useState<any[]>([]);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [emdApplicableSelection, setEmdApplicableSelection] = useState<boolean>(true);
  const [uploadingEmdReceipt, setUploadingEmdReceipt] = useState(false);
  const emdFileInputRef = useRef<HTMLInputElement>(null);

  const canViewConfidentialEmd = useMemo(() => {
    return isAuthorizedForEmdReceipt(currentUser?.role, currentUser?.username, selectedTender);
  }, [currentUser, selectedTender]);

  const handleUploadEmdReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedTender?.id) return;
    try {
      setUploadingEmdReceipt(true);
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/upload-emd-receipt`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.emd_receipt_doc_path) {
        showToast('EMD payment receipt attached successfully (marked confidential).', 'success');
        setSelectedTender((prev: any) => prev ? {
          ...prev,
          emd_receipt_doc_path: data.emd_receipt_doc_path,
          emd_receipt_confidential: true
        } : prev);
      } else {
        showToast(data.error || 'Failed to upload EMD receipt.', 'error');
      }
    } catch (err: any) {
      showToast('Error uploading EMD receipt: ' + err.message, 'error');
    } finally {
      setUploadingEmdReceipt(false);
      if (emdFileInputRef.current) emdFileInputRef.current.value = '';
    }
  };

  const handleRemoveEmdReceipt = async () => {
    if (!selectedTender?.id) return;
    try {
      await updateTenderField({ emd_receipt_doc_path: null });
      setSelectedTender((prev: any) => prev ? { ...prev, emd_receipt_doc_path: null } : prev);
      showToast('EMD receipt attachment removed.', 'success');
    } catch (_) {}
  };

  const [isParticipatingSubmitting, setIsParticipatingSubmitting] = useState(false);
  const [isTechSpecDragOver, setIsTechSpecDragOver] = useState(false);



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
    tender_type: 'Unverified',
    source: '',
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
        const hasLocalMisExecutiveChanges = prevTender && latestMisExecutive !== assignedExecutiveOf(prevTender.mis_executive);
        if (isFirstLoad || !hasLocalMisExecutiveChanges) {
          setMisExecutive(assignedExecutiveOf(tender.mis_executive));
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
          setSelectedMisMemberTpc(tender.assigned_mis_member || '');
          setSelectedMisMemberPricingRoute(tender.assigned_mis_member || '');
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

  const submitClearanceDecision = async (complianceOption: 'ALL COMPLY' | 'COMPLY WITH DEVIATIONS') => {
    if (!selectedTender || submittingApproveClearance) return;
    setSubmittingApproveClearance(true);
    try {
      const formData = new FormData();
      formData.append('complianceType', complianceOption);
      const hasUploadedFiles = Boolean(clearancePdfFile || clearanceDocxFile || clearanceXlsxFile);
      const defaultComment = complianceOption === 'ALL COMPLY'
        ? (hasUploadedFiles ? 'All Comply. Clearance superior specification documents uploaded.' : 'All Comply. Technical specification verified.')
        : (hasUploadedFiles ? 'Comply with deviations. Clearance superior specification documents uploaded.' : 'Comply with deviations accepted.');
      formData.append('comment', specCommentText.trim() || defaultComment);
      if (clearancePdfFile) formData.append('pdfFile', clearancePdfFile);
      if (clearanceDocxFile) formData.append('docxFile', clearanceDocxFile);
      if (clearanceXlsxFile) formData.append('xlsxFile', clearanceXlsxFile);

      const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/approve-clearance`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || 'Clearance could not be granted.', 'error');
        alert('Error: ' + (data.error || 'Clearance could not be granted.'));
        return;
      }
      showToast(data.message || `Clearance granted (${complianceOption})!`, 'success');
      alert(`Clearance granted (${complianceOption})! Returned to Tender Executive to prepare the standard bid package.`);
      setClearancePdfFile(null);
      setClearanceDocxFile(null);
      setClearanceXlsxFile(null);
      setSelectedTender(prev => prev ? {
        ...prev,
        spec_verification_status: 'Approved',
        spec_compliance_type: complianceOption,
        current_stage: data.currentStage || 'BID_DOCS_PREPARATION'
      } : prev);
      fetchTenderDetails();
    } catch {
      showToast('Network error while granting clearance. Please try again.', 'error');
    } finally {
      setSubmittingApproveClearance(false);
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

  const handleSelectPricingRoute = async (route: 'TPC' | 'MIS', misMember?: string) => {
    if (!id || !selectedTender) return;
    setRoutingPricing(true);
    try {
      const res = await fetchWithAuth(`/api/v2/workflow/${selectedTender.id}/route-pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route, misMember })
      });
      const data = await res.json();
      if (data.success || data.tender) {
        showToast(route === 'TPC' ? 'Tender routed to TPC Team for pricing.' : 'Tender routed directly to MIS Team for pricing (TPC bypassed).', 'success');
        setSelectedTender((prev: any) => prev ? {
          ...prev,
          pricing_route: route,
          current_stage: route === 'TPC' ? 'TPC_PRICING' : 'MIS_PRICING',
          assigned_mis_member: misMember || prev.assigned_mis_member
        } : null);
        fetchTenderDetails(false);
        fetchComments(id);
      } else {
        showToast(data.error || 'Failed to set pricing route', 'error');
      }
    } catch (e) {
      showToast('Network error setting pricing route', 'error');
    } finally {
      setRoutingPricing(false);
    }
  };

  const handleSubmitTpcPrice = async () => {
    if (!selectedTender || !tpcPurchasePriceInput || Number(tpcPurchasePriceInput) <= 0) return;
    setSubmittingTpcPrice(true);
    try {
      const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/tpc-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tpcPurchasePrice: tpcPurchasePriceInput,
          assignedMisMember: selectedMisMemberTpc || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Transfer price saved and forwarded to MIS Team!', 'success');
        setSelectedTender((prev: any) => prev ? {
          ...prev,
          tpc_purchase_price: Number(tpcPurchasePriceInput),
          assigned_mis_member: selectedMisMemberTpc || prev.assigned_mis_member,
          current_stage: 'MIS_PRICING'
        } : null);
        setTpcPurchasePriceInput('');
        fetchTenderDetails(false);
        fetchComments(id);
      } else {
        showToast(data.error || 'Failed to submit price', 'error');
      }
    } catch (e) {
      showToast('Network error saving price', 'error');
    } finally {
      setSubmittingTpcPrice(false);
    }
  };

  const handleSubmitMisPrice = async (priceToSubmit?: number) => {
    if (!selectedTender) return;
    const price = priceToSubmit !== undefined ? priceToSubmit : misFinalPriceInput;
    if (!price || Number(price) <= 0) return;
    setSubmittingMisPrice(true);
    try {
      const res = await fetchWithAuth(`/api/tenders/${selectedTender.id}/mis-price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ misFinalPrice: price })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Commercial go-ahead price granted and sent to Executive!', 'success');
        setSelectedTender((prev: any) => prev ? {
          ...prev,
          mis_final_price: Number(price),
          pricing_status: 'Approved'
        } : null);
        setMisFinalPriceInput('');
        fetchTenderDetails(false);
        fetchComments(id);
      } else {
        showToast(data.error || 'Failed to update Provided Price', 'error');
      }
    } catch (e) {
      showToast('Network error updating Provided Price', 'error');
    } finally {
      setSubmittingMisPrice(false);
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
      tender_type: selectedTender.tender_type || selectedTender.tenderType || 'Unverified',
      source: selectedTender.source || '',
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
          current_stage: data.currentStage || prev.current_stage || 'EMD_PAYMENT',
          payment_status: data.paymentStatus || prev.payment_status,
          downloaded_docs: data.downloadedDocs || prev.downloaded_docs,
          downloadedDocs: data.downloadedDocs || prev.downloadedDocs
        } : null);
        await fetchTenderDetails();
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
  // Canonical 6-Step Workflow Milestones:
  // Step 2: Spec Clearance
  const isStep2Complete = Boolean(selectedTender && (
    selectedTender.spec_verification_status === 'Approved' ||
    selectedTender.final_tech_spec_filename
  )) || isOutcomeState;

  // Step 3: Executive Handover & Document Preparation (Bid Docs Prep)
  // Returned to Executive immediately after clearance - NOT blocked on pricing!
  const isStep3Complete = (isStep2Complete && areDocsGenerated) || isOutcomeState;

  // Step 4: EMD Payment Step
  const isEmdExempt = Boolean(
    selectedTender?.emd_applicable === false ||
    (selectedTender?.emd != null && Number(selectedTender.emd) === 0) ||
    selectedTender?.payment_status === 'Exempt' ||
    selectedTender?.emd_status === 'EXEMPT_SKIPPED'
  );
  const isStep4Complete = (isStep3Complete && (isEmdExempt || selectedTender?.payment_status === 'Approved')) || isOutcomeState;

  // Step 5: Dual Track (Simultaneous Pricing + All-Path Document Verification)
  const isPricingApproved = Boolean(
    selectedTender?.pricing_status === 'Approved' ||
    (selectedTender?.mis_final_price && Number(selectedTender.mis_final_price) > 0)
  ) || isOutcomeState;

  const isDocsVerified = Boolean(
    selectedTender?.verification_status === 'Approved'
  ) || isOutcomeState;

  const isStep5Complete = (isStep4Complete && isPricingApproved && isDocsVerified) || isOutcomeState;

  // Step 6: Final Submission (Unlocked ONLY when Dual Track passes!)
  const isStep6Complete = (isStep5Complete && Boolean(
    selectedTender?.submission_status === 'Approved' ||
    selectedTender?.status === 'Submitted' ||
    selectedTender?.status === 'Filed'
  )) || isOutcomeState;

  const canFinalSubmit = isStep5Complete && !isStep6Complete;

  const isOperationalRole = currentUser?.role !== 'Specification Team' && currentUser?.role !== 'Clearance Team';

  // Section Visibility:
  const isCard1Visible = true; // Step 2 (Tech Spec) is always visible
  const isCard2Visible = isOperationalRole && (isStep2Complete || isOutcomeState); // Step 3 (Bid Docs Prep)
  const isCard3Visible = isOperationalRole && (isStep3Complete || isOutcomeState); // Step 4 EMD opens after the bid package exists
  const isCard4Visible = isOperationalRole && (isStep4Complete || isOutcomeState); // Step 5 (Dual Track)
  const isCard5Visible = isOperationalRole && (isStep5Complete || isOutcomeState); // Step 6 (Final Submission)
  const isCard6Visible = isOperationalRole && (isStep6Complete || isOutcomeState); // Step 7 (Outcome)

  const isStage1Complete = isStep2Complete;
  const isStage2Complete = isStep3Complete;
  const isStage3Complete = isStep4Complete;
  const isStage4Complete = isStep5Complete;
  const isStage5Complete = isStep5Complete;
  const isStage6Complete = isStep6Complete;
  const isStage1Visible = isCard1Visible;
  const isStage2Visible = isCard2Visible;
  const isStage3Visible = isCard3Visible;
  const isStage4Visible = isCard4Visible;
  const isStage5Visible = isCard5Visible;
  const isStage6Visible = isCard5Visible;
  const isStage7Visible = isCard6Visible;

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {(() => {
                  const classification = getClassificationDisplay(selectedTender.tender_type || selectedTender.tenderType);
                  const sourceLabel = getSourceBadgeLabel(selectedTender.source);
                  return (
                    <>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: '600',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        backgroundColor: classification.bgColor,
                        color: classification.color,
                        border: `1px solid ${classification.borderColor}`
                      }}>
                        {classification.label}
                      </span>
                      {sourceLabel && (
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '500',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          backgroundColor: 'rgba(107, 114, 128, 0.1)',
                          color: 'var(--text-muted, #6b7280)',
                          border: '1px solid rgba(107, 114, 128, 0.2)'
                        }}>
                          {sourceLabel}
                        </span>
                      )}
                    </>
                  );
                })()}
                <span className={`status-badge ${selectedTender.status}`} style={{ fontSize: '13px', padding: '6px 14px', borderRadius: '20px', fontWeight: 'bold' }}>
                  {selectedTender.status}
                </span>
              </div>
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
                          <option value="Non GeM">Non-GeM</option>
                          <option value="Custom">Custom</option>
                          <option value="Unverified">Non-GeM</option>
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
                          <option value="">Not Specified</option>
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
                        { label: 'Tender Type (GeM / Non GeM)', value: getClassificationLabel(selectedTender.tender_type || selectedTender.tenderType), icon: FileText, color: getClassificationDisplay(selectedTender.tender_type || selectedTender.tenderType).color },
                        { label: 'Source Portal', value: getSourcePortalLabel(selectedTender.source), icon: Globe, color: selectedTender.source === 'GeM' ? '#10b981' : ((selectedTender.source === 'Tender247' || selectedTender.source === 'Tender 247') ? '#3b82f6' : 'var(--text-muted)') },
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
              
              {/* Participation Decision Section - Exclusive to MIS Team.
                  Shown for every tender until MIS has assigned it to an executive. Gated on the
                  assignment rather than on status, because the status served here is derived by
                  TenderStatusResolver (e.g. an unassigned past-due tender arrives as "Missed Deadline")
                  and a status whitelist hid the panel for those tenders. A tender marked
                  Not Participating keeps the panel so the decision can be reversed. */}
              {isMisRole && (!assignedExecutiveOf(selectedTender.mis_executive) || selectedTender.status === 'Not Participating') && (
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

              {/* 2. Technical Specification Clearance Card */}
              <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                  
                  {/* Left Panel: Controls */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>2. Technical Specification Clearance</h4>
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
                      Choose All Comply to send this tender to the Tender Executive for EMD payment, or Comply with deviations and upload three replacement documents. Those new PDF, DOCX, and XLSX files replace the previous specification documents and continue through the rest of the tender.
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
                    {(currentUser?.role === 'Clearance Team' || currentUser?.role === 'Specification Team' || currentUser?.role === 'Admin') && selectedTender.spec_verification_status === 'Pending' && (
                      canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_spec) ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '14px', background: 'rgba(147, 51, 234, 0.05)', padding: '16px', borderRadius: '10px', border: '1px solid rgba(147, 51, 234, 0.25)' }}>
                          
                          {/* 1. VIEW GENERATED SPECS (MANDATORY FOR CLEARANCE TEAM) */}
                          <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <FileText size={14} style={{ color: 'var(--primary)' }} />
                                Generated Technical Specifications (from Executive &amp; AI):
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--accent-green)', textTransform: 'uppercase', fontWeight: '700' }}>Ready for Review</span>
                            </div>
                            <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: '0 0 10px 0', lineHeight: '1.4' }}>
                              Review the specification documents generated via Azure OpenAI before deciding compliance:
                            </p>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <a
                                href={getDocDownloadUrl(`/documents/${selectedTender.id}/Combined_Technical_Data_Sheet.pdf`)}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-secondary"
                                style={{ fontSize: '11px', padding: '6px 12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                              >
                                <ExternalLink size={12} style={{ color: '#ef4444' }} /> View PDF Specification
                              </a>
                              <a
                                href={getDocDownloadUrl(`/documents/${selectedTender.id}/Combined_Technical_Data_Sheet.docx`)}
                                className="btn btn-secondary"
                                style={{ fontSize: '11px', padding: '6px 12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                              >
                                <Download size={12} style={{ color: '#3b82f6' }} /> Download Word (DOCX)
                              </a>
                              <a
                                href={getDocDownloadUrl(`/documents/${selectedTender.id}/Combined_Technical_Data_Sheet.xlsx`)}
                                className="btn btn-secondary"
                                style={{ fontSize: '11px', padding: '6px 12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                              >
                                <Download size={12} style={{ color: '#10b981' }} /> Download Excel (XLSX)
                              </a>
                            </div>
                          </div>

                          {/* 2. THREE OPTIONAL UPLOAD FIELDS (PDF, WORD, EXCEL) - NONE STRICTLY REQUIRED */}
                          <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>
                              Upload Clearance Documents (Optional — Superior Specification Files):
                            </div>
                            <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                              None of these fields are required. Any document uploaded here is superior and will replace the previous docs generated by the executive through AI (Azure API key).
                            </p>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
                              {/* PDF upload field */}
                              <div style={{ padding: '10px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                                  1. PDF Document (.pdf)
                                </label>
                                <input
                                  type="file"
                                  accept=".pdf"
                                  id="clearance-pdf-input"
                                  onChange={e => setClearancePdfFile(e.target.files?.[0] || null)}
                                  style={{ fontSize: '11px', width: '100%' }}
                                />
                                {clearancePdfFile && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '10.5px', color: '#10b981' }}>
                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '140px' }}>✓ {clearancePdfFile.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setClearancePdfFile(null);
                                        const el = document.getElementById('clearance-pdf-input') as HTMLInputElement;
                                        if (el) el.value = '';
                                      }}
                                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Word upload field */}
                              <div style={{ padding: '10px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                                  2. Word Document (.docx / .doc)
                                </label>
                                <input
                                  type="file"
                                  accept=".docx,.doc"
                                  id="clearance-docx-input"
                                  onChange={e => setClearanceDocxFile(e.target.files?.[0] || null)}
                                  style={{ fontSize: '11px', width: '100%' }}
                                />
                                {clearanceDocxFile && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '10.5px', color: '#10b981' }}>
                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '140px' }}>✓ {clearanceDocxFile.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setClearanceDocxFile(null);
                                        const el = document.getElementById('clearance-docx-input') as HTMLInputElement;
                                        if (el) el.value = '';
                                      }}
                                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Excel upload field */}
                              <div style={{ padding: '10px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-primary)', display: 'block', marginBottom: '4px' }}>
                                  3. Excel Document (.xlsx / .xls)
                                </label>
                                <input
                                  type="file"
                                  accept=".xlsx,.xls"
                                  id="clearance-xlsx-input"
                                  onChange={e => setClearanceXlsxFile(e.target.files?.[0] || null)}
                                  style={{ fontSize: '11px', width: '100%' }}
                                />
                                {clearanceXlsxFile && (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', fontSize: '10.5px', color: '#10b981' }}>
                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '140px' }}>✓ {clearanceXlsxFile.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setClearanceXlsxFile(null);
                                        const el = document.getElementById('clearance-xlsx-input') as HTMLInputElement;
                                        if (el) el.value = '';
                                      }}
                                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0 }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 3. TWO CLEARANCE OPTIONS: ALL COMPLY & COMPLY WITH DEVIATIONS */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)' }}>
                              Clearance Compliance Decision:
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                              <label style={{
                                display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                                border: clearanceMode === 'ALL COMPLY' ? '2px solid #10b981' : '1px solid var(--border-color)',
                                background: clearanceMode === 'ALL COMPLY' ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                                transition: 'all 0.2s ease'
                              }}>
                                <input
                                  type="radio"
                                  name="clearanceModeDetail"
                                  checked={clearanceMode === 'ALL COMPLY'}
                                  onChange={() => setClearanceMode('ALL COMPLY')}
                                  style={{ marginTop: '3px' }}
                                />
                                <div>
                                  <strong style={{ fontSize: '13px', color: '#10b981', display: 'block' }}>ALL COMPLY</strong>
                                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginTop: '2px', lineHeight: '1.4' }}>
                                    All specification requirements fully comply. Forwards to Tender Executive for Bid Document Preparation.
                                  </span>
                                </div>
                              </label>

                              <label style={{
                                display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                                border: clearanceMode === 'COMPLY WITH DEVIATIONS' ? '2px solid #f59e0b' : '1px solid var(--border-color)',
                                background: clearanceMode === 'COMPLY WITH DEVIATIONS' ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                                transition: 'all 0.2s ease'
                              }}>
                                <input
                                  type="radio"
                                  name="clearanceModeDetail"
                                  checked={clearanceMode === 'COMPLY WITH DEVIATIONS'}
                                  onChange={() => setClearanceMode('COMPLY WITH DEVIATIONS')}
                                  style={{ marginTop: '3px' }}
                                />
                                <div>
                                  <strong style={{ fontSize: '13px', color: '#f59e0b', display: 'block' }}>COMPLY WITH DEVIATIONS</strong>
                                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginTop: '2px', lineHeight: '1.4' }}>
                                    Accepted with deviations. Any uploaded clearance documents act as superior specifications.
                                  </span>
                                </div>
                              </label>
                            </div>
                          </div>

                          {/* 4. BUTTON NAMED "GRANT CLEARANCE" */}
                          <button
                            className="btn btn-primary"
                            style={{
                              width: '100%',
                              padding: '12px 20px',
                              fontSize: '13px',
                              fontWeight: '700',
                              letterSpacing: '0.5px',
                              justifyContent: 'center',
                              background: clearanceMode === 'COMPLY WITH DEVIATIONS' ? '#d97706' : '#10b981',
                              borderColor: clearanceMode === 'COMPLY WITH DEVIATIONS' ? '#d97706' : '#10b981',
                              opacity: submittingApproveClearance ? 0.7 : 1,
                              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
                              marginTop: '4px'
                            }}
                            disabled={submittingApproveClearance}
                            onClick={() => submitClearanceDecision(clearanceMode)}
                          >
                            {submittingApproveClearance ? '⏳ Granting Clearance...' : 'GRANT CLEARANCE'}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', color: 'var(--primary-light, #a5b4fc)', marginBottom: '12px' }}>
                          <Shield size={14} style={{ color: 'var(--primary)' }} />
                          <span>View-Only Access · Assigned to: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_spec || 'Clearance Team'}</strong></span>
                        </div>
                      )
                    )}

                    {/* 5. EXECUTIVE & GENERAL VIEW: DISPLAYED WHEN SPEC CLEARANCE IS APPROVED */}
                    {selectedTender.spec_verification_status === 'Approved' && (
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        marginBottom: '16px',
                        padding: '16px',
                        borderRadius: '10px',
                        background: selectedTender.spec_compliance_type?.includes('DEVIAT') ? 'rgba(245, 158, 11, 0.06)' : 'rgba(16, 185, 129, 0.06)',
                        border: selectedTender.spec_compliance_type?.includes('DEVIAT') ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(16, 185, 129, 0.3)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <CheckCircle2 size={18} style={{ color: selectedTender.spec_compliance_type?.includes('DEVIAT') ? '#f59e0b' : '#10b981' }} />
                            <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
                              Technical Specification Clearance Granted
                            </span>
                          </div>
                          
                          {/* Compliance decision badge known to Executive */}
                          <span style={{
                            fontSize: '11.5px',
                            fontWeight: '800',
                            letterSpacing: '0.5px',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            backgroundColor: selectedTender.spec_compliance_type?.includes('DEVIAT') ? 'rgba(245, 158, 11, 0.18)' : 'rgba(16, 185, 129, 0.18)',
                            color: selectedTender.spec_compliance_type?.includes('DEVIAT') ? '#f59e0b' : '#10b981',
                            border: `1px solid ${selectedTender.spec_compliance_type?.includes('DEVIAT') ? 'rgba(245, 158, 11, 0.45)' : 'rgba(16, 185, 129, 0.45)'}`
                          }}>
                            {selectedTender.spec_compliance_type?.includes('DEVIAT') ? 'COMPLY WITH DEVIATIONS' : 'ALL COMPLY'}
                          </span>
                        </div>

                        {/* Executive informative description */}
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
                          {selectedTender.spec_compliance_type?.includes('DEVIAT') ? (
                            <>
                              The Clearance Team granted clearance with <strong style={{ color: '#f59e0b' }}>COMPLY WITH DEVIATIONS</strong>. Any superior documents uploaded by the Clearance Team have replaced previous specifications and are active for this tender.
                            </>
                          ) : (
                            <>
                              The Clearance Team granted clearance with <strong style={{ color: '#10b981' }}>ALL COMPLY</strong>. Specifications satisfy all tender clauses.
                            </>
                          )}
                        </p>

                        {/* Superior Cleared Specification Documents Links - Only files carried forward are displayed */}
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

                          // Check for clearance superior docs
                          const clearanceDocs = docList.filter((d: any) => d && (
                            d.superior === true || 
                            (d.name && d.name.toLowerCase().includes('clearance superior'))
                          ));

                          let finalDocs: any[] = [];
                          let isSuperior = false;

                          if (clearanceDocs.length > 0) {
                            // ONLY things uploaded by clearance are carried forward and displayed
                            finalDocs = clearanceDocs;
                            isSuperior = true;
                          } else if (selectedTender.final_tech_spec_uploaded_by && selectedTender.final_tech_spec_filename) {
                            // Single file uploaded by clearance recorded in final_tech_spec_filename
                            const fn = selectedTender.final_tech_spec_filename;
                            const match = docList.find((d: any) => d && (d.filename === fn || d.local_path?.includes(fn)));
                            finalDocs = match ? [match] : [{
                              name: fn.endsWith('.docx') ? 'Final Spec (Word)' : fn.endsWith('.xlsx') ? 'Final Spec (Excel)' : 'Final Spec (PDF)',
                              filename: fn,
                              local_path: `/documents/${selectedTender.id}/${fn}`
                            }];
                            isSuperior = true;
                          } else {
                            // Standard clearance (0 uploads / All Comply): show available specification documents
                            const specDocs = docList.filter((d: any) => {
                              if (!d) return false;
                              const fn = (d.filename || d.local_path || d.name || '').toLowerCase();
                              return fn.includes('combined_technical') || fn.includes('tech_spec') || fn.includes('technical_specification');
                            });
                            finalDocs = specDocs.length > 0 ? specDocs : [
                              { name: 'Final Spec (PDF)', filename: 'Combined_Technical_Data_Sheet.pdf', local_path: `/documents/${selectedTender.id}/Combined_Technical_Data_Sheet.pdf` },
                              { name: 'Final Spec (Word)', filename: 'Combined_Technical_Data_Sheet.docx', local_path: `/documents/${selectedTender.id}/Combined_Technical_Data_Sheet.docx` },
                              { name: 'Final Spec (Excel)', filename: 'Combined_Technical_Data_Sheet.xlsx', local_path: `/documents/${selectedTender.id}/Combined_Technical_Data_Sheet.xlsx` }
                            ];
                          }

                          return (
                            <div style={{ marginTop: '4px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                                {isSuperior ? 'Superior Cleared Specification Documents (Clearance Team):' : 'Cleared Specification Documents:'}
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {finalDocs.map((doc: any, idx: number) => {
                                  const fn = (doc.filename || doc.name || doc.local_path || '').toLowerCase();
                                  const isPdf = fn.endsWith('.pdf');
                                  const isWord = fn.endsWith('.docx') || fn.endsWith('.doc');
                                  const isExcel = fn.endsWith('.xlsx') || fn.endsWith('.xls');
                                  const label = isPdf ? 'Final Spec (PDF)' : isWord ? 'Final Spec (Word)' : isExcel ? 'Final Spec (Excel)' : (doc.name || doc.filename);
                                  const icon = isPdf ? <FileText size={12} style={{ color: '#ef4444' }} />
                                              : isWord ? <Download size={12} style={{ color: '#3b82f6' }} />
                                              : <Download size={12} style={{ color: '#10b981' }} />;
                                  return (
                                    <a
                                      key={idx}
                                      href={getDocDownloadUrl(doc.local_path || `/documents/${selectedTender.id}/${doc.filename}`)}
                                      target={isPdf ? '_blank' : undefined}
                                      rel="noreferrer"
                                      download={!isPdf ? (doc.filename || undefined) : undefined}
                                      className="btn btn-secondary"
                                      style={{ fontSize: '11px', padding: '6px 12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                      {icon} {label}
                                    </a>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Sign-off metadata */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                          <span>Cleared by: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.final_tech_spec_uploaded_by || selectedTender.assigned_mis_member_spec || 'Clearance Team'}</strong></span>
                          {selectedTender.final_tech_spec_uploaded_at && (
                            <span>Cleared on: {new Date(selectedTender.final_tech_spec_uploaded_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
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

              {/* 3. Executive Handover & Bid Document Preparation Card */}
              {isCard2Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                        3. Executive Handover &amp; Document Preparation
                      </h4>
                    </div>
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      backgroundColor: areDocsGenerated ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                      color: areDocsGenerated ? '#10b981' : '#f59e0b',
                      fontWeight: '600'
                    }}>
                      {areDocsGenerated ? 'Completed' : 'Pending Bid Package'}
                    </span>
                  </div>

                  <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.5' }}>
                    After clearance, the Tender Executive prepares the bid package from the standard template. The cleared specification is the one that continues. EMD opens after this package is generated.
                  </p>

                  {!areDocsGenerated ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
                        No bid documents have been generated yet. Compile the PDF and Word package from the standard template. Pricing is not required for this step.
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
                          gap: '8px'
                        }}>
                          <Lock size={14} />
                          <span><strong>Locked:</strong> Technical Specification Clearance from the Clearance Team is required before bid documents can be generated.</span>
                        </div>
                      ) : (
                        canPerform(currentUser?.role, 'generateBids') && (
                          <button
                            className="btn btn-primary"
                            style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}
                            onClick={openBidDocForm}
                          >
                            📄 Generate Bid Documents Package
                          </button>
                        )
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '12px', fontWeight: '700' }}>
                        <CheckCircle2 size={16} />
                        <span>Bid document package compiled successfully in Word &amp; PDF formats.</span>
                      </div>

                      {/* Download links */}
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <a
                          href={getDocDownloadUrl(`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.docx`)}
                          download={`Bid_Documents_${selectedTender.id}.docx`}
                          className="btn btn-secondary"
                          style={{ fontSize: '11.5px', padding: '6px 14px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <Download size={13} /> DOCX Package
                        </a>
                        <a
                          href={getDocDownloadUrl(`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.pdf`)}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-secondary"
                          style={{ fontSize: '11.5px', padding: '6px 14px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          <FileText size={13} /> View PDF Bundle
                        </a>
                      </div>

                      {/* Working Folder Path (Documents Store) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                          Working Folder Path (Documents Store)
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            id="working-path-input"
                            type="text"
                            value={workingPath}
                            onChange={(e) => setWorkingPath(e.target.value)}
                            placeholder="e.g. /Shared/Tenders/2026/GEM-7324078"
                            disabled={!canRecordOperationalStages || isStep6Complete}
                            style={{
                              flexGrow: 1,
                              padding: '8px 12px',
                              borderRadius: '6px',
                              background: 'var(--bg-app)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-primary)',
                              fontSize: '13px'
                            }}
                          />
                          {canRecordOperationalStages && !isStep6Complete && (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '8px 14px', fontSize: '12px' }}
                              onClick={() => updateTenderField({ working_path: workingPath })}
                            >
                              💾 Save Path
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Re-generate option */}
                      {canPerform(currentUser?.role, 'generateBids') && !isStep6Complete && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '11.5px', padding: '5px 12px' }}
                            onClick={openBidDocForm}
                          >
                            🔄 Re-generate Bid Documents
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 4. EMD Payment Step Card */}
              {isCard3Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                    
                    {/* Left Panel: EMD Controls */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                          4. EMD Payment Step
                        </h4>
                        <span style={{
                          fontSize: '11px',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          backgroundColor: isEmdExempt ? 'rgba(16, 185, 129, 0.1)' : selectedTender.payment_status === 'Approved' ? 'rgba(16, 185, 129, 0.1)' : selectedTender.payment_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                          color: (isEmdExempt || selectedTender.payment_status === 'Approved') ? '#10b981' : selectedTender.payment_status === 'Pending' ? '#f59e0b' : 'var(--text-muted)',
                          fontWeight: '600'
                        }}>
                          {isEmdExempt ? 'Exempt / Not Applicable' : selectedTender.payment_status === 'Approved' ? 'Approved' : selectedTender.payment_status === 'Pending' ? 'Pending MIS Approval' : selectedTender.payment_status === 'Rejected' ? 'Changes Requested' : 'Pending Payment'}
                        </span>
                      </div>

                      {/* Applicability Check: Toggle for Executive */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px', background: 'rgba(99, 102, 241, 0.05)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', textTransform: 'uppercase' }}>
                            EMD Requirement Check:
                          </span>
                          {isEmdExempt && (
                            <span style={{ fontSize: '11px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '2px 8px', borderRadius: '10px', fontWeight: '700' }}>
                              ✓ EMD Exempt / Not Applicable
                            </span>
                          )}
                        </div>
                        
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                          Specify whether Earnest Money Deposit (EMD) payment is mandatory for this tender or exempt / not applicable.
                        </p>

                        {canRecordOperationalStages && selectedTender.payment_status !== 'Approved' && (
                          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                            <button
                              type="button"
                              className={emdApplicableSelection ? "btn btn-primary" : "btn btn-secondary"}
                              style={{ flex: 1, padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                              onClick={() => setEmdApplicableSelection(true)}
                            >
                              💳 EMD is Required
                            </button>
                            <button
                              type="button"
                              className={!emdApplicableSelection ? "btn btn-primary" : "btn btn-secondary"}
                              style={{ flex: 1, padding: '8px 12px', fontSize: '12px', justifyContent: 'center', background: !emdApplicableSelection ? '#10b981' : undefined, borderColor: !emdApplicableSelection ? '#10b981' : undefined, color: !emdApplicableSelection ? '#fff' : undefined }}
                              onClick={async () => {
                                setEmdApplicableSelection(false);
                                try {
                                  const res = await fetchWithAuth(`/api/v2/workflow/${selectedTender.id}/emd-applicability`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ applicable: false })
                                  });
                                  const data = await res.json();
                                  if (!data.success) {
                                    setEmdApplicableSelection(true);
                                    showToast(data.error || 'Could not mark EMD as exempt.', 'error');
                                    return;
                                  }
                                  setSelectedTender(prev => prev ? {
                                    ...prev,
                                    emd_applicable: false,
                                    payment_status: 'Approved',
                                    emd_status: 'EXEMPT_SKIPPED',
                                    current_stage: data.stepName || 'DUAL_TRACK'
                                  } : prev);
                                  showToast(data.message || 'EMD marked as exempt. Dual track is now open.', 'success');
                                  fetchTenderDetails();
                                } catch {
                                  setEmdApplicableSelection(true);
                                  showToast('Network error. Please try again.', 'error');
                                }
                              }}
                            >
                              ⏩ EMD Not Applicable / Exempt (Skip to Dual Track)
                            </button>
                          </div>
                        )}
                      </div>

                      {isEmdExempt ? (
                        <div style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '14px', borderRadius: '8px', fontSize: '12.5px', color: '#10b981' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', marginBottom: '4px' }}>
                            <CheckCircle2 size={16} />
                            <span>EMD Exempt / Not Applicable</span>
                          </div>
                          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '12px' }}>
                            Earnest Money Deposit is not applicable for this tender. The workflow has automatically progressed to <strong>Step 5: Dual Track (Pricing + Document Verification)</strong>.
                          </p>
                          {canRecordOperationalStages && (
                            <button
                              type="button"
                              onClick={async () => {
                                setEmdApplicableSelection(true);
                                try {
                                  const res = await fetchWithAuth(`/api/v2/workflow/${selectedTender.id}/emd-applicability`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ applicable: true })
                                  });
                                  const data = await res.json();
                                  if (!data.success) {
                                    showToast(data.error || 'Could not mark EMD as required.', 'error');
                                    return;
                                  }
                                  setSelectedTender(prev => prev ? {
                                    ...prev,
                                    emd_applicable: true,
                                    payment_status: 'None',
                                    emd_status: 'PENDING_INPUT',
                                    current_stage: data.stepName || 'EMD_PAYMENT'
                                  } : prev);
                                  showToast(data.message || 'EMD marked as required.', 'success');
                                  fetchTenderDetails();
                                } catch {
                                  showToast('Network error. Please try again.', 'error');
                                }
                              }}
                              style={{ marginTop: '10px', background: 'transparent', border: 'none', color: 'var(--primary)', fontSize: '11.5px', fontWeight: '600', cursor: 'pointer', padding: 0 }}
                            >
                              ✏️ Change to EMD Required
                            </button>
                          )}
                        </div>
                      ) : (
                        /* Form for when EMD is required */
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>EMD PAYMENT MODE</label>
                              <input
                                id="emd-mode-input"
                                type="text"
                                value={emdPaymentMode}
                                onChange={(e) => setEmdPaymentMode(e.target.value)}
                                placeholder="e.g. Online / DD / BG / RTGS"
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
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700' }}>BENEFICIARY NAME (TRANSFERRED TO)</label>
                              <input
                                id="emd-ref-input"
                                type="text"
                                value={emdPaymentRef}
                                onChange={(e) => setEmdPaymentRef(e.target.value)}
                                placeholder="e.g. Beneficiary Entity Name / Department"
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

                          {/* Confidential Receipt Upload */}
                          <div style={{
                            marginTop: '12px',
                            marginBottom: '16px',
                            padding: '12px 14px',
                            borderRadius: '8px',
                            background: 'rgba(99, 102, 241, 0.05)',
                            border: '1px solid rgba(99, 102, 241, 0.25)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Lock size={13} style={{ color: 'var(--primary)' }} />
                                <label style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--primary-light, #a5b4fc)', letterSpacing: '0.4px' }}>
                                  EMD Payment Receipt / Proof <span style={{ fontWeight: 400, opacity: 0.8 }}>(Optional · Marked Confidential)</span>
                                </label>
                              </div>
                              <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.12)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', fontWeight: 600 }}>
                                🔒 Strictly Confidential
                              </span>
                            </div>

                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              Visible strictly to the assigned Executive, his MIS Team, and Admin.
                            </div>

                            {selectedTender.emd_receipt_doc_path ? (
                              canViewConfidentialEmd ? (
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  background: 'var(--bg-app)',
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(16, 185, 129, 0.3)'
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                                    <FileText size={16} style={{ color: '#10b981', flexShrink: 0 }} />
                                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {selectedTender.emd_receipt_doc_path.split('/').pop() || 'EMD_Payment_Receipt.pdf'}
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <a
                                      href={getDocDownloadUrl(selectedTender.emd_receipt_doc_path)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        padding: '4px 10px',
                                        borderRadius: '4px',
                                        background: 'rgba(16, 185, 129, 0.12)',
                                        color: '#10b981',
                                        border: '1px solid rgba(16, 185, 129, 0.3)',
                                        fontSize: '11.5px',
                                        fontWeight: 600,
                                        textDecoration: 'none'
                                      }}
                                    >
                                      <ExternalLink size={12} /> View / Download
                                    </a>
                                    {canRecordOperationalStages && selectedTender.payment_status !== 'Approved' && (
                                      <button
                                        type="button"
                                        onClick={handleRemoveEmdReceipt}
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          color: '#ef4444',
                                          fontSize: '11px',
                                          fontWeight: 600,
                                          cursor: 'pointer',
                                          padding: '4px 6px'
                                        }}
                                      >
                                        ✕ Remove
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div style={{ fontSize: '11.5px', fontStyle: 'italic', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <Lock size={12} /> Payment receipt attached (Confidential: Access restricted)
                                </div>
                              )
                            ) : (
                              canRecordOperationalStages && selectedTender.payment_status !== 'Approved' ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <input
                                    type="file"
                                    ref={emdFileInputRef}
                                    onChange={handleUploadEmdReceipt}
                                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                    style={{ display: 'none' }}
                                    id="emd-receipt-file-input"
                                  />
                                  <label
                                    htmlFor="emd-receipt-file-input"
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      border: '1px dashed rgba(99, 102, 241, 0.4)',
                                      background: 'rgba(99, 102, 241, 0.08)',
                                      color: 'var(--primary-light, #a5b4fc)',
                                      fontSize: '11.5px',
                                      fontWeight: 600,
                                      cursor: uploadingEmdReceipt ? 'wait' : 'pointer'
                                    }}
                                  >
                                    {uploadingEmdReceipt ? '⏳ Uploading...' : '📎 Attach Payment Receipt / Proof (Optional)'}
                                  </label>
                                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                                    PDF, PNG, JPG accepted
                                  </span>
                                </div>
                              ) : (
                                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                  No payment proof attached (Optional)
                                </div>
                              )
                            )}
                          </div>

                          {/* Submission buttons */}
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
                                      payment_status: 'Pending',
                                      current_stage: 'PAYMENT_APPROVAL'
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
                                  onClick={async () => {
                                    try {
                                      await fetchWithAuth(`/api/v2/workflow/${selectedTender.id}/action`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ action: 'APPROVED', stage: 'PAYMENT_APPROVAL' })
                                      });
                                    } catch (e) {}
                                    updateTenderField({ payment_status: 'Approved', current_stage: 'DUAL_TRACK' });
                                  }}
                                >
                                  ✅ Approve Payment (Begin Dual Track)
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

              {/* 5. Dual Track (Pricing + Document Verification) Card */}
              {isCard4Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  
                  {/* Dual Track Banner Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                        5. Dual Track (Commercial Pricing &amp; Document Verification)
                      </h4>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        Track A (Commercial Pricing) and Track B (Document Verification) execute in parallel simultaneously. Both tracks must be approved before final submission unlocks.
                      </p>
                    </div>

                    {/* Status Badges */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span style={{
                        fontSize: '11px', padding: '3px 10px', borderRadius: '12px',
                        background: isPricingApproved ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                        color: isPricingApproved ? '#10b981' : '#f59e0b',
                        border: `1px solid ${isPricingApproved ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                        fontWeight: '700'
                      }}>
                        Track A: Pricing {isPricingApproved ? '✓' : '⏳'}
                      </span>
                      <span style={{
                        fontSize: '11px', padding: '3px 10px', borderRadius: '12px',
                        background: isDocsVerified ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                        color: isDocsVerified ? '#10b981' : '#f59e0b',
                        border: `1px solid ${isDocsVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                        fontWeight: '700'
                      }}>
                        Track B: Docs {isDocsVerified ? '✓' : '⏳'}
                      </span>
                    </div>
                  </div>

                  {/* Dual Track Overall Outcome Callout */}
                  {isStep5Complete ? (
                    <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
                      <CheckCircle2 size={16} />
                      <span><strong>Dual Track Complete:</strong> Commercial quote price finalized and all folder documents verified. Step 6 (Final Submission) is now unlocked!</span>
                    </div>
                  ) : (
                    <div style={{ background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', color: 'var(--primary-light, #a5b4fc)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
                      <span>⚡</span>
                      <span>
                        {!isPricingApproved && !isDocsVerified && 'Both Track A (Pricing) and Track B (Audit) are in progress simultaneously.'}
                        {isPricingApproved && !isDocsVerified && 'Track A Approved ✓. Waiting on Track B (All-Path Document Verification).'}
                        {!isPricingApproved && isDocsVerified && 'Track B Verified ✓. Waiting on Track A (Commercial Pricing Go-Ahead).'}
                      </span>
                    </div>
                  )}

                  {/* Two Parallel Tracks Side-by-Side */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
                    
                    {/* ================= TRACK A: COMMERCIAL PRICING ================= */}
                    <div style={{ background: 'rgba(147, 51, 234, 0.03)', border: '1px solid rgba(147, 51, 234, 0.2)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: '800', color: '#a855f7', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Track A: Commercial Pricing
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                            TPC Transfer Price (confidential) &amp; Final Provided Price (Quote)
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {selectedTender.pricing_route && (
                            <span style={{
                              fontSize: '10px', padding: '2px 7px', borderRadius: '8px',
                              background: selectedTender.pricing_route === 'MIS' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(147, 51, 234, 0.15)',
                              color: selectedTender.pricing_route === 'MIS' ? '#3b82f6' : '#a855f7',
                              fontWeight: '700'
                            }}>
                              {selectedTender.pricing_route === 'MIS' ? 'Route: Direct MIS' : 'Route: TPC Team'}
                            </span>
                          )}
                          <span style={{
                            fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px',
                            background: isPricingApproved ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: isPricingApproved ? '#10b981' : '#f59e0b',
                            fontWeight: '700'
                          }}>
                            {isPricingApproved ? 'Commercial Go-Ahead ✓' : (!selectedTender.pricing_route && !selectedTender.tpc_purchase_price && selectedTender.current_stage !== 'TPC_PRICING' && selectedTender.current_stage !== 'MIS_PRICING' ? 'Route Selection Required' : 'Pricing In Progress')}
                          </span>
                        </div>
                      </div>

                      {/* Track A Body */}
                      {(() => {
                        const effectiveRoute = selectedTender.pricing_route || (selectedTender.tpc_purchase_price || selectedTender.current_stage === 'TPC_PRICING' ? 'TPC' : (selectedTender.current_stage === 'MIS_PRICING' ? 'MIS' : null));
                        const isRoutePending = !effectiveRoute && !isPricingApproved;

                        // 1. Approved state: Commercial price finalized
                        if (isPricingApproved) {
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '14px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <div style={{ color: '#10b981', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <CheckCircle2 size={16} /> Final Commercial Quote (Approved)
                                  </div>
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Approved for portal submission</span>
                                </div>
                                <span style={{ fontSize: '18px', color: '#10b981', fontWeight: '800' }}>
                                  ₹{Number(selectedTender.mis_final_price).toLocaleString('en-IN')}
                                </span>
                              </div>
                              {!isExecutiveRole && selectedTender.tpc_purchase_price && (
                                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                  <span>TPC Transfer Price (Confidential):</span>
                                  <span style={{ fontWeight: '700', color: '#9333ea' }}>₹{Number(selectedTender.tpc_purchase_price).toLocaleString('en-IN')}</span>
                                </div>
                              )}
                            </div>
                          );
                        }

                        // 2. Route selection pending: Executive must choose Option 1 or Option 2
                        if (isRoutePending) {
                          if (isExecutiveRole || isAdmin) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '12px 14px', borderRadius: '8px', fontSize: '12px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span>⚠️</span>
                                  <span><strong>Select Commercial Pricing Route:</strong> Tenders do not always need to go to TPC. Choose Option 1 (Send to TPC) or Option 2 (Direct to MIS).</span>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                                  {/* Option 1: Send tender to TPC Team */}
                                  <div style={{ background: 'var(--bg-app)', border: '1px solid rgba(147, 51, 234, 0.35)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px' }}>
                                    <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#9333ea' }}>1. Send Tender to TPC Team</span>
                                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '6px', background: 'rgba(147, 51, 234, 0.15)', color: '#9333ea', fontWeight: '700' }}>TPC Route</span>
                                      </div>
                                      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                        Send to TPC Team to add manufacturer transfer price. TPC will then forward it to an MIS team member of their choice for final quote.
                                      </p>
                                    </div>
                                    <button
                                      className="btn btn-primary"
                                      disabled={routingPricing}
                                      onClick={() => handleSelectPricingRoute('TPC')}
                                      style={{ width: '100%', fontSize: '11.5px', padding: '8px 12px', background: '#9333ea', borderColor: '#9333ea', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                    >
                                      {routingPricing ? 'Routing...' : '📤 Option 1: Send to TPC Team'}
                                    </button>
                                  </div>

                                  {/* Option 2: Send tender to MIS Team for pricing */}
                                  <div style={{ background: 'var(--bg-app)', border: '1px solid rgba(59, 130, 246, 0.35)', borderRadius: '8px', padding: '14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '10px' }}>
                                    <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#3b82f6' }}>2. Send to MIS Team for Pricing</span>
                                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '6px', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', fontWeight: '700' }}>Direct MIS</span>
                                      </div>
                                      <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                                        Send directly to MIS Team to quote price. <strong>TPC bypassed:</strong> tender will NOT appear as pending on TPC's system.
                                      </p>
                                      <div style={{ marginTop: '8px' }}>
                                        <label style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Assign MIS Member (Optional):</label>
                                        <select
                                          value={selectedMisMemberPricingRoute}
                                          onChange={(e) => setSelectedMisMemberPricingRoute(e.target.value)}
                                          style={{ width: '100%', padding: '6px 8px', borderRadius: '5px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '11px' }}
                                        >
                                          <option value="">-- Any Available MIS Member --</option>
                                          {misTeamMembers.map((m) => (
                                            <option key={m} value={m}>{m}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>
                                    <button
                                      className="btn btn-primary"
                                      disabled={routingPricing}
                                      onClick={() => handleSelectPricingRoute('MIS', selectedMisMemberPricingRoute)}
                                      style={{ width: '100%', fontSize: '11.5px', padding: '8px 12px', background: '#3b82f6', borderColor: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                                    >
                                      {routingPricing ? 'Routing...' : '🚀 Option 2: Send Directly to MIS'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>⏳</span>
                              <span>Awaiting Executive pricing route selection (Option 1: TPC Team vs Option 2: Direct MIS).</span>
                            </div>
                          );
                        }

                        // 3. Option 1 Active: Routed to TPC
                        if (effectiveRoute === 'TPC') {
                          if (isExecutiveRole) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-yellow)', fontSize: '12px', marginBottom: '6px' }}>
                                    <span>⏳</span>
                                    <span><strong>Tender sent to TPC Team.</strong> Awaiting manufacturer purchase pricing &amp; MIS assignment. (Confidential Transfer Price masked).</span>
                                  </div>
                                  {selectedTender.tpc_purchase_price && (
                                    <div style={{ fontSize: '11.5px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                      <CheckCircle2 size={14} /> TPC pricing added. Forwarded to MIS Team for final commercial quote.
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={() => handleSelectPricingRoute('MIS')}
                                    disabled={routingPricing}
                                    style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '11px', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                                  >
                                    ⇄ Switch route: Send directly to MIS instead
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {/* TPC Transfer Price & MIS Assignment dropdown */}
                              <div style={{ background: selectedTender.tpc_purchase_price ? 'rgba(16, 185, 129, 0.05)' : 'rgba(147, 51, 234, 0.03)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <label style={{ fontSize: '11px', fontWeight: '700', color: '#9333ea', textTransform: 'uppercase' }}>
                                    1. TPC Transfer Price (Total Production Cost)
                                  </label>
                                  {selectedTender.tpc_purchase_price && (
                                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#10b981' }}>
                                      ₹{Number(selectedTender.tpc_purchase_price).toLocaleString('en-IN')}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginBottom: '10px' }}>
                                  🔒 Confidential: Visible only to TPC Team, MIS Team, and Admin. Masked from Tender Executive.
                                </span>

                                {(isTpcRole || isAdmin) && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                      <input
                                        type="number"
                                        placeholder={selectedTender.tpc_purchase_price ? `Update transfer price (Current: ₹${Number(selectedTender.tpc_purchase_price).toLocaleString('en-IN')})` : "Enter transfer price (₹)..."}
                                        value={tpcPurchasePriceInput}
                                        onChange={(e) => setTpcPurchasePriceInput(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                        style={{ flex: 1, minWidth: '160px', padding: '7px 10px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                                      />
                                      {/* Forward to MIS Member Dropdown */}
                                      <select
                                        value={selectedMisMemberTpc}
                                        onChange={(e) => setSelectedMisMemberTpc(e.target.value)}
                                        style={{ minWidth: '180px', padding: '7px 10px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                                      >
                                        <option value="">-- Forward to MIS Member --</option>
                                        {misTeamMembers.map((m) => (
                                          <option key={m} value={m}>{m}</option>
                                        ))}
                                      </select>
                                      <button
                                        className="btn btn-primary"
                                        disabled={submittingTpcPrice || !tpcPurchasePriceInput}
                                        onClick={handleSubmitTpcPrice}
                                        style={{ fontSize: '11px', padding: '7px 14px', background: '#9333ea', borderColor: '#9333ea', whiteSpace: 'nowrap' }}
                                      >
                                        {submittingTpcPrice ? 'Saving...' : '💾 Save & Forward to MIS'}
                                      </button>
                                    </div>
                                  </div>
                                )}

                                {selectedTender.assigned_mis_member && (
                                  <div style={{ marginTop: (isTpcRole || isAdmin) ? '8px' : '0px', fontSize: '11px', color: '#9333ea' }}>
                                    👤 Assigned to MIS Member: <strong>{selectedTender.assigned_mis_member}</strong>
                                  </div>
                                )}

                                {isMisRole && !selectedTender.tpc_purchase_price && (
                                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '6px' }}>
                                    ⏳ Awaiting TPC Team to enter manufacturer purchase price.
                                  </div>
                                )}
                              </div>

                              {/* MIS Final Provided Price */}
                              <div style={{ background: selectedTender.mis_final_price ? 'rgba(16, 185, 129, 0.05)' : 'rgba(59, 130, 246, 0.03)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <label style={{ fontSize: '11px', fontWeight: '700', color: '#3b82f6', textTransform: 'uppercase' }}>
                                    2. Final Provided Price (Commercial Go-Ahead)
                                  </label>
                                  {selectedTender.mis_final_price && (
                                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#10b981' }}>
                                      ₹{Number(selectedTender.mis_final_price).toLocaleString('en-IN')}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
                                  MIS can view TPC price and either adopt it directly or enter an updated commercial price.
                                </span>

                                {(isMisRole || isAdmin) ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {/* Option to send directly to executive using TPC price */}
                                    {selectedTender.tpc_purchase_price && (
                                      <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '10px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                        <span style={{ fontSize: '11.5px', color: '#10b981' }}>
                                          TPC Price: <strong>₹{Number(selectedTender.tpc_purchase_price).toLocaleString('en-IN')}</strong>
                                        </span>
                                        <button
                                          className="btn btn-primary"
                                          disabled={submittingMisPrice}
                                          onClick={() => handleSubmitMisPrice(Number(selectedTender.tpc_purchase_price))}
                                          style={{ fontSize: '11px', padding: '6px 12px', background: '#10b981', borderColor: '#10b981' }}
                                        >
                                          {submittingMisPrice ? 'Submitting...' : '⚡ Use TPC Price & Send Directly to Executive'}
                                        </button>
                                      </div>
                                    )}

                                    {/* Custom price input */}
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                      <input
                                        type="number"
                                        placeholder={selectedTender.mis_final_price ? `Update Quote Price (Current: ₹${Number(selectedTender.mis_final_price).toLocaleString('en-IN')})` : "Enter Provided Quote Price (₹)"}
                                        value={misFinalPriceInput}
                                        onChange={(e) => setMisFinalPriceInput(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                        style={{ flex: 1, padding: '7px 10px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                                      />
                                      <button
                                        className="btn btn-primary"
                                        disabled={submittingMisPrice || !misFinalPriceInput}
                                        onClick={() => handleSubmitMisPrice()}
                                        style={{ fontSize: '11px', padding: '7px 12px', background: '#3b82f6', borderColor: '#3b82f6' }}
                                      >
                                        {submittingMisPrice ? 'Saving...' : '✅ Save & Send to Executive'}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    {!selectedTender.tpc_purchase_price ? 'Awaiting TPC transfer price submission.' : 'Forwarded to MIS Team for final commercial quote.'}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }

                        // 4. Option 2 Active: Routed directly to MIS (TPC Bypassed)
                        if (effectiveRoute === 'MIS') {
                          if (isExecutiveRole) {
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#3b82f6', fontSize: '12px' }}>
                                    <span>🚀</span>
                                    <span><strong>Tender sent directly to MIS Team for pricing.</strong> (TPC Bypassed). Awaiting MIS commercial quote.</span>
                                  </div>
                                  {selectedTender.assigned_mis_member && (
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '6px' }}>
                                      Assigned MIS Member: <strong>{selectedTender.assigned_mis_member}</strong>
                                    </div>
                                  )}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <button
                                    onClick={() => handleSelectPricingRoute('TPC')}
                                    disabled={routingPricing}
                                    style={{ background: 'none', border: 'none', color: '#9333ea', fontSize: '11px', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}
                                  >
                                    ⇄ Switch route: Send to TPC Team instead
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          if (isTpcRole) {
                            return (
                              <div style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-app)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span>ℹ️</span>
                                <span><strong>Direct MIS Route:</strong> The Tender Executive sent this tender directly to the MIS Team for pricing. TPC review is not required.</span>
                              </div>
                            );
                          }

                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              <div style={{ background: 'rgba(59, 130, 246, 0.05)', padding: '14px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                  <label style={{ fontSize: '11px', fontWeight: '700', color: '#3b82f6', textTransform: 'uppercase' }}>
                                    Direct MIS Commercial Pricing (TPC Bypassed)
                                  </label>
                                  {selectedTender.mis_final_price && (
                                    <span style={{ fontSize: '14px', fontWeight: '800', color: '#10b981' }}>
                                      ₹{Number(selectedTender.mis_final_price).toLocaleString('en-IN')}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', display: 'block', marginBottom: '10px' }}>
                                  Executive assigned this tender directly to MIS. TPC transfer pricing was bypassed.
                                </span>

                                {(isMisRole || isAdmin) ? (
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <input
                                      type="number"
                                      placeholder={selectedTender.mis_final_price ? `Update Quote Price (Current: ₹${Number(selectedTender.mis_final_price).toLocaleString('en-IN')})` : "Enter Final Commercial Quote (₹)..."}
                                      value={misFinalPriceInput}
                                      onChange={(e) => setMisFinalPriceInput(e.target.value === '' ? '' : parseFloat(e.target.value))}
                                      style={{ flex: 1, padding: '7px 10px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                                    />
                                    <button
                                      className="btn btn-primary"
                                      disabled={submittingMisPrice || !misFinalPriceInput}
                                      onClick={() => handleSubmitMisPrice()}
                                      style={{ fontSize: '11px', padding: '7px 14px', background: '#10b981', borderColor: '#10b981' }}
                                    >
                                      {submittingMisPrice ? 'Saving...' : '✅ Commercial Go-Ahead & Send to Executive'}
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                    Reserved for MIS Team review.
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }

                        return null;
                      })()}
                    </div>

                    {/* ================= TRACK B: ALL PATH DOCUMENT VERIFICATION ================= */}
                    <div style={{ background: 'rgba(16, 185, 129, 0.03)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: '800', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            Track B: Document Verification (All Path Docs)
                          </span>
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginTop: '2px' }}>
                            MIS Team verifies all documents in folder path (specs, bid docs, and downloaded notices)
                          </span>
                        </div>
                        <span style={{
                          fontSize: '10.5px', padding: '2px 8px', borderRadius: '10px',
                          background: isDocsVerified ? 'rgba(16, 185, 129, 0.15)' : selectedTender.verification_status === 'Pending' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                          color: isDocsVerified ? '#10b981' : selectedTender.verification_status === 'Pending' ? '#f59e0b' : 'var(--text-muted)',
                          fontWeight: '700'
                        }}>
                          {isDocsVerified ? 'All Documents Verified ✓' : selectedTender.verification_status === 'Pending' ? 'Pending MIS Audit' : selectedTender.verification_status === 'Rejected' ? 'Changes Requested' : 'Pending Verification'}
                        </span>
                      </div>

                      {/* Complete All-Path Document Manifest List */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          Folder Path Documents to Verify:
                        </span>

                        <div style={{ maxHeight: '170px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-app)', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                          {/* 1. Bid Package Documents */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', fontSize: '11.5px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                              <FileText size={13} style={{ color: '#3b82f6', flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                Bid_Documents_{selectedTender.id}.docx / .pdf
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <a href={getDocDownloadUrl(`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.pdf`)} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', fontSize: '11px', textDecoration: 'none' }}>PDF</a>
                              <span style={{ color: 'var(--border-color)' }}>|</span>
                              <a href={getDocDownloadUrl(`/documents/${selectedTender.id}/Bid_Documents_${selectedTender.id}.docx`)} download style={{ color: '#10b981', fontSize: '11px', textDecoration: 'none' }}>DOCX</a>
                            </div>
                          </div>

                          {/* 2. Clearance-Approved Technical Specification */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', fontSize: '11.5px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                              <FileText size={13} style={{ color: '#10b981', flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                {selectedTender.final_tech_spec_filename || 'Combined_Technical_Data_Sheet.pdf'} (Final Cleared Spec)
                              </span>
                            </div>
                            <a href={getDocDownloadUrl(selectedTender.final_tech_spec_filename ? `/documents/${selectedTender.id}/${selectedTender.final_tech_spec_filename}` : `/documents/${selectedTender.id}/Combined_Technical_Data_Sheet.pdf`)} target="_blank" rel="noreferrer" style={{ color: '#10b981', fontSize: '11px', textDecoration: 'none' }}>View</a>
                          </div>

                          {/* 3. Original Notice or Downloaded Docs */}
                          {(() => {
                            let dlDocs: any[] = [];
                            try {
                              const raw = selectedTender.downloaded_docs || selectedTender.downloadedDocs;
                              if (raw) dlDocs = typeof raw === 'string' ? JSON.parse(raw) : raw;
                            } catch {}
                            if (!Array.isArray(dlDocs)) dlDocs = [];
                            return dlDocs.slice(0, 3).map((d: any, idx: number) => (
                              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '4px', fontSize: '11.5px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                  <FileText size={13} style={{ color: '#f59e0b', flexShrink: 0 }} />
                                  <span style={{ color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                    {d.name || d.filename || 'Downloaded Tender Document'}
                                  </span>
                                </div>
                                {d.local_path && (
                                  <a href={getDocDownloadUrl(d.local_path)} target="_blank" rel="noreferrer" style={{ color: '#3b82f6', fontSize: '11px', textDecoration: 'none' }}>Download</a>
                                )}
                              </div>
                            ));
                          })()}
                        </div>
                      </div>

                      {/* Assigned MIS Auditor & Submission Controls */}
                      {((currentUser?.role === 'Tender Executive' || currentUser?.role === 'Executive') && selectedTender.verification_status !== 'Approved' && selectedTender.verification_status !== 'Pending') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>TARGET MIS AUDITOR</label>
                            <select 
                              value={selectedMisMemberDocs} 
                              onChange={(e) => {
                                setSelectedMisMemberDocs(e.target.value);
                                updateTenderField({ assigned_mis_member_docs: e.target.value });
                              }}
                              style={{ padding: '7px 10px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px', outline: 'none' }}
                            >
                              <option value="">-- Select MIS Auditor --</option>
                              {misTeamMembers.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>

                          <button 
                            className="btn btn-primary" 
                            style={{ width: '100%', justifyContent: 'center', fontSize: '12px', padding: '8px 12px' }}
                            onClick={() => {
                              if (!selectedMisMemberDocs) {
                                showToast('Please select a Target MIS Team Auditor first.', 'error');
                                alert('Please select a Target MIS Team Auditor first.');
                                return;
                              }
                              updateTenderField({ verification_status: 'Pending', assigned_mis_member_docs: selectedMisMemberDocs, current_stage: 'DOC_VERIFICATION' });
                            }}
                          >
                            🚀 Submit All Path Documents for MIS Audit
                          </button>
                        </div>
                      )}

                      {/* MIS Team Verification Decision Controls.
                          Dual track opens this decision with pricing. It does not wait for a separate
                          executive "submit for audit" that would set verification_status to Pending. */}
                      {!isDocsVerified && (
                        (isMisRole && canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_docs)) ? (
                          <div style={{ display: 'flex', gap: '8px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                            <button
                              className="btn btn-primary"
                              disabled={submittingDocDecision}
                              style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                              onClick={async () => {
                                setSubmittingDocDecision(true);
                                try {
                                  const res = await fetchWithAuth(`/api/v2/workflow/${selectedTender.id}/verify-all-documents`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ remarks: 'All path documents verified.' })
                                  });
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok || data.success === false) {
                                    showToast(data.error || 'Could not approve the documents.', 'error');
                                    return;
                                  }
                                  showToast(data.message || 'All path documents verified.', 'success');
                                  setSelectedTender(prev => prev ? { ...prev, verification_status: 'Approved' } : null);
                                  fetchTenderDetails();
                                } catch {
                                  showToast('Network error verifying documents.', 'error');
                                } finally {
                                  setSubmittingDocDecision(false);
                                }
                              }}
                            >
                              {submittingDocDecision ? 'Saving...' : '✅ Approve Docs'}
                            </button>
                            <button
                              className="btn btn-secondary"
                              disabled={submittingDocDecision}
                              style={{ flex: 1, color: 'var(--accent-red)', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                              onClick={async () => {
                                setSubmittingDocDecision(true);
                                try {
                                  const res = await fetchWithAuth(`/api/v2/workflow/${selectedTender.id}/reject-documents`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ remarks: 'Changes requested on folder documents.' })
                                  });
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok || data.success === false) {
                                    showToast(data.error || 'Could not request document changes.', 'error');
                                    return;
                                  }
                                  showToast(data.message || 'Document changes requested.', 'success');
                                  setSelectedTender(prev => prev ? { ...prev, verification_status: 'Rejected' } : null);
                                  fetchTenderDetails();
                                } catch {
                                  showToast('Network error requesting document changes.', 'error');
                                } finally {
                                  setSubmittingDocDecision(false);
                                }
                              }}
                            >
                              ❌ Reject Docs
                            </button>
                          </div>
                        ) : isMisRole ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', color: 'var(--primary-light, #a5b4fc)' }}>
                            <Shield size={14} style={{ color: 'var(--primary)' }} />
                            <span>Audit assigned to: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_docs || 'MIS Team'}</strong></span>
                          </div>
                        ) : (
                          <div style={{ fontSize: '11.5px', color: 'var(--accent-yellow)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>⏳</span>
                            <span>Awaiting MIS Team audit of all path documents.</span>
                          </div>
                        )
                      )}

                    </div>

                  </div>
                </div>
              )}

              {/* 6. Final Submission Card */}
              {isCard5Visible && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>
                      6. Final Submission on Portal
                    </h4>
                    <span style={{ 
                      fontSize: '11px', 
                      padding: '2px 8px', 
                      borderRadius: '12px', 
                      backgroundColor: isStep6Complete ? 'rgba(16, 185, 129, 0.1)' : selectedTender.submission_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : canFinalSubmit ? 'rgba(59, 130, 246, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                      color: isStep6Complete ? '#10b981' : selectedTender.submission_status === 'Pending' ? '#f59e0b' : canFinalSubmit ? '#3b82f6' : '#ef4444', 
                      fontWeight: '600' 
                    }}>
                      {isStep6Complete ? 'Submitted & Confirmed' : selectedTender.submission_status === 'Pending' ? 'Pending MIS Audit' : canFinalSubmit ? 'Active (Ready to Submit)' : 'Locked'}
                    </span>
                  </div>

                  {!canFinalSubmit && !isStep6Complete ? (
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
                      <Lock size={14} />
                      <span><strong>Locked:</strong> Final Portal Submission requires both Track A (Commercial Pricing Go-Ahead) and Track B (Full Document Verification) to be complete. (Pricing: <em>{isPricingApproved ? 'Approved ✓' : 'Pending ⏳'}</em> · Docs: <em>{isDocsVerified ? 'Approved ✓' : 'Pending ⏳'}</em>).</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.5' }}>
                        Both commercial pricing and document verification have cleared! The Tender Executive can now officially execute the submission on the government/e-procurement portal.
                      </p>

                      {/* If Not Yet Submitted and user is Executive */}
                      {!isStep6Complete && (currentUser?.role === 'Tender Executive' || currentUser?.role === 'Executive') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'rgba(16, 185, 129, 0.05)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: '#10b981' }}>
                            Executive Portal Submission Action:
                          </span>
                          <button
                            className="btn btn-primary"
                            style={{ background: '#10b981', borderColor: '#10b981', padding: '10px 18px', fontSize: '13px', fontWeight: '700', justifyContent: 'center' }}
                            onClick={() => {
                              updateTenderField({
                                submission_status: 'Pending',
                                current_stage: 'SUBMISSION_PENDING',
                                status: 'Submitted'
                              });
                              showToast('Tender submitted on portal! Forwarded to MIS Team for filing audit.', 'success');
                            }}
                          >
                            🚀 Submit Tender on Portal
                          </button>
                        </div>
                      )}

                      {/* If Pending MIS Audit */}
                      {selectedTender.submission_status === 'Pending' && (
                        (canReviewAssignment(currentUser?.role, currentUser?.username, selectedTender.assigned_mis_member_submission || selectedTender.assigned_mis_member) && isMisRole) ? (
                          <div style={{ display: 'flex', gap: '8px', background: 'rgba(245, 158, 11, 0.05)', padding: '12px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                            <button
                              className="btn btn-primary"
                              style={{ flex: 1, background: '#10b981', borderColor: '#10b981', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                              onClick={() => {
                                updateTenderField({
                                  submission_status: 'Approved',
                                  current_stage: 'WIN_LOSS_PENDING',
                                  status: 'Submitted'
                                });
                                showToast('Portal filing confirmed! Tender is officially submitted.', 'success');
                              }}
                            >
                              ✅ Confirm &amp; Audit Portal Filing
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ flex: 1, color: '#ef4444', padding: '8px 12px', fontSize: '12px', justifyContent: 'center' }}
                              onClick={() => updateTenderField({ submission_status: 'Rejected' })}
                            >
                              ❌ Reject Filing
                            </button>
                          </div>
                        ) : (
                          <div style={{ fontSize: '12px', color: 'var(--accent-yellow)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>⏳</span>
                            <span>Tender marked as filed by Executive. Awaiting MIS Team filing audit confirmation.</span>
                          </div>
                        )
                      )}

                      {/* If Submission Complete */}
                      {isStep6Complete && (
                        <div style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontSize: '12.5px' }}>
                          <CheckCircle2 size={16} />
                          <span><strong>Officially Submitted:</strong> Tender filing has been confirmed and audited by the MIS Team. Ready for outcome tracking.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 7. Final Outcome Declaration Card */}
              {isCard6Visible && (() => {
                const isWon = selectedTender.status === 'Awarded' || selectedTender.status === 'Won' || selectedTender.outcome_status === 'Won' || selectedTender.current_stage === 'WON';
                const isLost = selectedTender.status === 'Not Awarded' || selectedTender.status === 'Lost' || selectedTender.outcome_status === 'Lost' || selectedTender.current_stage === 'LOST';
                return (
                  <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>7. Final Bidding Outcome</h4>
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
                        {isWon ? 'Won' : isLost ? 'Lost' : 'Pending Outcome'}
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
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Page Orientation</label>
                          <select
                            value={bidFormFields.orientation || 'portrait'}
                            onChange={(e) => {
                              const val = e.target.value as 'portrait' | 'landscape';
                              setBidFormFields(prev => ({
                                ...prev,
                                orientation: val
                              }));
                            }}
                            style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', fontWeight: '600' }}
                          >
                            <option value="portrait">📄 Portrait Mode (A4)</option>
                            <option value="landscape">📑 Landscape Mode (A4)</option>
                          </select>
                          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
                            * Tech specs sheet is always generated in landscape mode
                          </div>
                        </div>
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
