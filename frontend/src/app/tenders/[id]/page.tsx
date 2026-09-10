"use client";

import React, { useState, useEffect, useRef } from 'react';
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
  ExternalLink
} from 'lucide-react';
import { Tender } from '@/lib/db';

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

  // Bid Doc Generator Modal States
  const [isBidDocFormOpen, setIsBidDocFormOpen] = useState(false);
  const [generatingBidDocs, setGeneratingBidDocs] = useState(false);
  const [bidFormFields, setBidFormFields] = useState({
    bidNumber: '',
    bidDate: '',
    authorityName: '',
    authorityDept: '',
    authorityAddress: '',
    productDescription: '',
    companyName: '',
    companyContact: '',
    companyAddress: '',
    companyEmail: '',
    companyWebsite: '',
    manufacturerName: '',
    manufacturerAddress: '',
    signatoryName: '',
    signatoryDesignation: '',
    signatoryAddress: '',
    witnessDetails: '',
    localContentPercentage: '50',
    preferencePolicy: 'yes',
    localContentLocation: '',
    warrantyPeriod: '1',
    serviceSupportPeriod: '1',
    sparesAvailabilityPeriod: '10',
    place: '',
    make: 'MarkEn',
    model: 'MILR-04',
    requiredQuantity: '300',
    companyNameCompliance: 'M/s. Mark Enterprises'
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
        const prevBidQty = prevTender && prevTender.bid_qty !== undefined && prevTender.bid_qty !== null ? prevTender.bid_qty : '';
        const hasLocalBidQtyChanges = prevTender && latestBidQty !== prevBidQty;
        if (isFirstLoad || !hasLocalBidQtyChanges) {
          setBidQty(tender.bid_qty !== undefined && tender.bid_qty !== null ? tender.bid_qty : '');
        }

        // 6. Quoted Qty
        const prevQuotedQty = prevTender && prevTender.quoted_qty !== undefined && prevTender.quoted_qty !== null ? prevTender.quoted_qty : '';
        const hasLocalQuotedQtyChanges = prevTender && latestQuotedQty !== prevQuotedQty;
        if (isFirstLoad || !hasLocalQuotedQtyChanges) {
          setQuotedQty(tender.quoted_qty !== undefined && tender.quoted_qty !== null ? tender.quoted_qty : '');
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
            .filter((u: any) => u.role === 'MIS Executive')
            .map((u: any) => u.username);
          setExecutivesList(execs);

          const specMembers = data.users
            .filter((u: any) => u.role === 'Specification Team')
            .map((u: any) => u.username);
          setSpecTeamMembers(specMembers);
        }
      }
    } catch (err) {
      console.error('Error fetching users:', err);
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
        notes: tenderNotes,
        mis_executive: misExecutive || null,
        bid_qty: bidQty === '' ? null : Number(bidQty),
        quoted_qty: quotedQty === '' ? null : Number(quotedQty)
      };

      // If assignment has changed, set assigned_by and assigned_at
      if (misExecutive !== selectedTender.mis_executive) {
        updatedFields.assigned_by = misExecutive ? currentUser?.username : null;
        updatedFields.assigned_at = misExecutive ? new Date().toISOString() : null;
        if (misExecutive && (selectedTender.status === 'New' || selectedTender.status === 'Lapsed' || selectedTender.status === 'Issued')) {
          updatedFields.status = 'Participating';
        }
      }

      const response = await fetchWithAuth(`/api/tenders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields)
      });
      const data = await response.json();
      if (data.success) {
        showToast('Changes saved successfully', 'success');
        setSelectedTender(prev => prev ? { ...prev, ...updatedFields } : null);
        fetchTenderDetails();
      } else {
        showToast(data.error || 'Failed to save changes', 'error');
      }
    } catch (e) {
      showToast('Communication error saving changes', 'error');
    } finally {
      setNotesSaving(false);
    }
  };

  const openBidDocForm = () => {
    if (!selectedTender) return;
    setBidFormFields({
      bidNumber: selectedTender.id || '',
      bidDate: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD
      authorityName: selectedTender.authority || '',
      authorityDept: '',
      authorityAddress: selectedTender.location || '',
      productDescription: selectedTender.product_name_as_per_tender || selectedTender.title || '',
      companyName: 'Marken Company',
      companyContact: '+91 99999 88888',
      companyAddress: 'Industrial Zone, Sector 4, New Delhi',
      companyEmail: 'info@markencompany.com',
      companyWebsite: 'www.markencompany.com',
      manufacturerName: 'Marken OEM Division',
      manufacturerAddress: 'Industrial Area Phase 2, Mumbai',
      signatoryName: 'John Doe',
      signatoryDesignation: 'Director BD',
      signatoryAddress: 'Delhi, India',
      witnessDetails: 'Jane Smith, Manager Finance',
      localContentPercentage: '50',
      preferencePolicy: 'yes',
      localContentLocation: 'New Delhi Plant',
      warrantyPeriod: '1',
      serviceSupportPeriod: '1',
      sparesAvailabilityPeriod: '10',
      place: selectedTender.place || 'New Delhi',
      make: 'MarkEn',
      model: 'MILR-04',
      requiredQuantity: selectedTender.bid_qty !== null && selectedTender.bid_qty !== undefined ? String(selectedTender.bid_qty) : '300',
      companyNameCompliance: 'M/s. Mark Enterprises'
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
        showToast('Word documents generated successfully!', 'success');
        setIsBidDocFormOpen(false);
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
    selectedTender.status === 'Not Awarded'
  ) : false;

  const areDocsGenerated = selectedTender ? (() => {
    if (isOutcomeState) return true;
    if (!selectedTender.downloaded_docs) return false;
    try {
      const docs = JSON.parse(selectedTender.downloaded_docs);
      return Array.isArray(docs) && docs.some((d: any) => 
        d.name && (d.name.includes("Generated Bid Documents") || d.name.includes("Bid Documents"))
      );
    } catch {
      return false;
    }
  })() : false;

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
              onClick={() => router.push('/')}
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
          {selectedTender && (
            <span className={`status-badge ${selectedTender.status}`} style={{ fontSize: '13px', padding: '6px 14px', borderRadius: '20px', fontWeight: 'bold' }}>
              {selectedTender.status}
            </span>
          )}
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
                  
                  {/* Executive & Quantity Assignment */}
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>Executive & Quantities Assignment</h3>
                      {currentUser?.role !== 'Admin' && (
                        <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={saveNotes} disabled={notesSaving}>
                          {notesSaving ? 'Saving...' : 'Save Assignment'}
                        </button>
                      )}
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
                        {currentUser?.role === 'MIS Team' || currentUser?.role === 'Admin' ? (
                          <select
                            value={misExecutive}
                            onChange={(e) => setMisExecutive(e.target.value)}
                            disabled={currentUser?.role === 'Admin'}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-app)',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                              outline: 'none',
                              cursor: currentUser?.role === 'Admin' ? 'not-allowed' : 'default',
                              opacity: currentUser?.role === 'Admin' ? 0.7 : 1
                            }}
                          >
                            <option value="">-- Unassigned --</option>
                            {executivesList.map(exec => (
                              <option key={exec} value={exec}>{exec}</option>
                            ))}
                          </select>
                        ) : (
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
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                            Bid Quantity
                          </label>
                          <input
                            id="bid-qty-input"
                            type="number"
                            placeholder="Bid Qty"
                            value={bidQty}
                            onChange={(e) => setBidQty(e.target.value === '' ? '' : Number(e.target.value))}
                            disabled={currentUser?.role === 'Admin' || currentUser?.role === 'MIS Executive'}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-app)',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                              cursor: (currentUser?.role === 'Admin' || currentUser?.role === 'MIS Executive') ? 'not-allowed' : 'default',
                              opacity: (currentUser?.role === 'Admin' || currentUser?.role === 'MIS Executive') ? 0.7 : 1
                            }}
                          />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                            Quoted Quantity
                          </label>
                          <input
                            id="quoted-qty-input"
                            type="number"
                            placeholder="Quoted Qty"
                            value={quotedQty}
                            onChange={(e) => setQuotedQty(e.target.value === '' ? '' : Number(e.target.value))}
                            disabled={currentUser?.role === 'Admin' || currentUser?.role === 'MIS Executive'}
                            style={{
                              padding: '10px 12px',
                              borderRadius: '8px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-app)',
                              color: 'var(--text-primary)',
                              fontSize: '13px',
                              cursor: (currentUser?.role === 'Admin' || currentUser?.role === 'MIS Executive') ? 'not-allowed' : 'default',
                              opacity: (currentUser?.role === 'Admin' || currentUser?.role === 'MIS Executive') ? 0.7 : 1
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Internal Bidding Notes */}
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>Internal Bidding Notes</h3>
                      {currentUser?.role !== 'Admin' && (
                        <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={saveNotes} disabled={notesSaving}>
                          {notesSaving ? 'Saving...' : 'Save Notes'}
                        </button>
                      )}
                    </div>
                    <textarea
                      id="notes-textarea"
                      placeholder="Record credentials, contact details, pricing estimates, task checklists, or notes for this bid..."
                      value={tenderNotes}
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
                        resize: 'vertical'
                      }}
                    />
                  </div>
                </div>

              </div>

              {/* Row 2: Tender Specifications Visual Grid */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
                <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building size={18} style={{ color: 'var(--primary)' }} />
                  Tender Specifications & Parameters
                </h3>
                
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
              </div>

              {/* Row 3: Document Repository (Full width card) */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BookOpen size={18} style={{ color: 'var(--primary)' }} />
                  Document Repository
                </h3>
                
                {(() => {
                  let docList = [];
                  if (selectedTender.downloaded_docs) {
                    try {
                      docList = JSON.parse(selectedTender.downloaded_docs);
                    } catch {
                      docList = [];
                    }
                  }
                  
                  if (!Array.isArray(docList) || docList.length === 0) {
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
              
              {/* Stepper Card */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  {currentUser?.role === 'Specification Team' ? 'Technical Specification Review' : 'Workflow Pipeline Progress'}
                </h3>
                
                {currentUser?.role === 'Specification Team' ? (
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
                  /* Horizontal Stepper Progress Bar */
                  <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', margin: '10px 0 20px 0', padding: '0 10px' }}>
                    <div style={{ position: 'absolute', top: '12px', left: '20px', right: '20px', height: '2px', backgroundColor: 'var(--border-color)', zIndex: 0 }}></div>
                    <div style={{ 
                      position: 'absolute', 
                      top: '12px', 
                      left: '20px', 
                      width: (() => {
                        if (selectedTender.status === 'Won' || selectedTender.status === 'Lost' || selectedTender.status === 'Awarded' || selectedTender.status === 'Not Awarded') return '100%';
                        if (selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') return '80%';
                        if (selectedTender.verification_status === 'Approved') return '80%';
                        if (selectedTender.payment_status === 'Approved') return '60%';
                        if (areDocsGenerated) return '40%';
                        if (selectedTender.spec_verification_status === 'Approved') return '20%';
                        return '0%';
                      })(),
                      height: '2px', 
                      backgroundColor: 'var(--primary)', 
                      transition: 'width 0.3s ease',
                      zIndex: 0 
                    }}></div>

                    {[
                      { name: 'Tech Spec Review', label: '1' },
                      { name: 'Docs Prep', label: '2' },
                      { name: 'EMD Payment', label: '3' },
                      { name: 'Verification', label: '4' },
                      { name: 'Submission', label: '5' },
                      { name: 'Outcome', label: '6' }
                    ].map((step, idx) => {
                      const isActive = (() => {
                        if (idx === 0) return true;
                        if (idx === 1) return selectedTender.spec_verification_status === 'Approved';
                        if (idx === 2) return areDocsGenerated;
                        if (idx === 3) return selectedTender.payment_status === 'Approved' || selectedTender.verification_status === 'Approved' || isOutcomeState;
                        if (idx === 4) return selectedTender.verification_status === 'Approved' || isOutcomeState;
                        if (idx === 5) return isOutcomeState;
                        return false;
                      })();
                      return (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 1, position: 'relative' }}>
                          <div style={{
                            width: '26px',
                            height: '26px',
                            borderRadius: '50%',
                            backgroundColor: isActive ? 'var(--primary)' : 'var(--bg-app)',
                            border: `2px solid ${isActive ? 'var(--primary)' : 'var(--border-color)'}`,
                            color: isActive ? '#fff' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '11px',
                            fontWeight: '700'
                          }}>
                            {step.label}
                          </div>
                          <span style={{ fontSize: '10px', color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', marginTop: '6px', fontWeight: isActive ? '700' : '500' }}>
                            {step.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 1. Technical Specification Review Card */}
              <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                  
                  {/* Left Panel: Controls */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>1. Technical Specification Review</h4>
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

                    {/* Display Assigned Specification Team Member */}
                    {((selectedTender.spec_verification_status === 'Pending' || selectedTender.spec_verification_status === 'Approved' || currentUser?.role !== 'MIS Executive') && selectedTender.assigned_mis_member_spec) ? (
                      <div style={{ marginBottom: '16px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                        <strong>Target Specification Representative:</strong> <span style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_spec}</span>
                      </div>
                    ) : null}

                    {/* Executive Controls: 2-Phase Sequence (1. Generate/Upload -> 2. Send to Clearance Team) */}
                    {(currentUser?.role === 'MIS Executive' || currentUser?.role === 'Tender Executive') && selectedTender.spec_verification_status !== 'Approved' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
                        {(!selectedTender.has_tech_spec && selectedTender.spec_verification_status !== 'Pending' && selectedTender.spec_verification_status !== 'Generated') ? (
                          /* PHASE 1: UPLOAD DOCUMENT TO GENERATE TECHNICAL SPECIFICATION */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(99, 102, 241, 0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--primary)', textTransform: 'uppercase' }}>
                              Step 1: Upload Document to Generate Technical Specification
                            </span>
                            <p style={{ fontSize: '11.5px', color: 'var(--text-secondary)', margin: 0 }}>
                              Upload the tender document or specification file to process and generate the technical specification parameters.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Select Specification Document (PDF / DOCX / TXT)</label>
                              <input 
                                type="file" 
                                id="tech-spec-file-input-detail"
                                accept=".pdf,.docx,.doc,.txt"
                                style={{ fontSize: '12px', color: 'var(--text-primary)', padding: '6px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                              />
                            </div>

                            <button 
                              className="btn btn-primary"
                              style={{ width: '100%', justifyContent: 'center', fontSize: '12.5px', marginTop: '4px' }}
                              onClick={async () => {
                                const inputEl = document.getElementById('tech-spec-file-input-detail') as HTMLInputElement;
                                const fileToUpload = inputEl?.files?.[0];
                                if (!fileToUpload) {
                                  showToast('Please select a specification document to upload first.', 'error');
                                  return;
                                }
                                try {
                                  showToast('Uploading document and generating technical specification...', 'success');
                                  const formData = new FormData();
                                  formData.append('file', fileToUpload);
                                  const uploadRes = await fetchWithAuth(`/api/tenders/${selectedTender.id}/upload-tech-spec`, {
                                    method: 'POST',
                                    body: formData
                                  });
                                  const uploadData = await uploadRes.json();
                                  if (uploadData.success) {
                                    await fetchWithAuth(`/api/tenders/${selectedTender.id}/generate-bid-docs`, { method: 'POST' });
                                    showToast('Technical Specification document generated successfully!', 'success');
                                    updateTenderField({
                                      has_tech_spec: true,
                                      tech_spec_file: uploadData.filename || fileToUpload.name,
                                      spec_verification_status: 'Generated'
                                    });
                                  } else {
                                    showToast(uploadData.error || 'Failed to upload document.', 'error');
                                  }
                                } catch (e) {
                                  showToast('Error uploading and generating technical specification.', 'error');
                                }
                              }}
                            >
                              ⚙️ Upload & Generate Technical Specification
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
                                  style={{ width: '100%', justifyContent: 'center' }}
                                  onClick={async () => {
                                    if (!selectedMisMemberSpec) {
                                      showToast('Please select a Target Clearance Representative first.', 'error');
                                      alert('Please select a Target Clearance Representative first.');
                                      return;
                                    }
                                    try {
                                      await fetchWithAuth(`/api/tenders/${selectedTender.id}/clearance-request`, { method: 'POST' });
                                      updateTenderField({ spec_verification_status: 'Pending', assigned_mis_member_spec: selectedMisMemberSpec });
                                      showToast('Submitted to Clearance Team for Approval!', 'success');
                                    } catch (e) {
                                      updateTenderField({ spec_verification_status: 'Pending', assigned_mis_member_spec: selectedMisMemberSpec });
                                    }
                                  }}
                                >
                                  🚀 Send Technical Specification to Clearance Team
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

                    {/* Specification Team Verification Controls */}
                    {(currentUser?.role === 'Specification Team' || (selectedTender.assigned_mis_member_spec && currentUser?.username === selectedTender.assigned_mis_member_spec)) && selectedTender.spec_verification_status === 'Pending' && (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', background: 'rgba(147, 51, 234, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(147, 51, 234, 0.2)' }}>
                        <button 
                          className="btn btn-primary" 
                          style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                          onClick={() => updateTenderField({ spec_verification_status: 'Approved' })}
                        >
                          Approve Technical Specs
                        </button>
                        <button 
                          className="btn btn-secondary" 
                          style={{ flex: 1, color: 'var(--accent-red)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                          onClick={() => updateTenderField({ spec_verification_status: 'Rejected' })}
                        >
                          Reject Technical Specs
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right Panel: Specification Comment Discussion */}
                  <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    {(() => {
                      const phaseComments = comments.filter(c => c.phase === 'Specification' || c.phase === 'Spec');
                      const isReadonlyRole = currentUser?.role === 'Admin' || currentUser?.role === 'MIS Team';
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
                              placeholder={isReadonlyRole ? "Discussion is read-only for Admin / MIS Team" : "Discuss specifications..."} 
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

              {/* 2. Preparation & Bid Documents Card */}
              {currentUser?.role !== 'Specification Team' && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>2. Preparation & Bid Documents</h4>
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
                        <span><strong>Locked:</strong> Technical Specification Approval from the Specification Team is required before bid documents can be generated. Current status: <em>{selectedTender.spec_verification_status || 'Not Started'}</em>.</span>
                      </div>
                    ) : (
                      (currentUser?.role === 'MIS Executive' || (currentUser?.role === 'Specification Team' && currentUser?.username === selectedTender.assigned_mis_member_spec)) && (
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
                      Bid document package successfully compiled.
                    </p>
                    {selectedTender.working_path && (
                      <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                        📁 Working folder: <code>{selectedTender.working_path}</code>
                      </span>
                    )}
                  </div>
                )}
                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                  <label style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Specification Team Representative
                  </label>
                  {currentUser?.role === 'MIS Executive' || currentUser?.role === 'MIS Team' ? (
                    <select 
                      value={selectedMisMemberSpec} 
                      onChange={(e) => {
                        setSelectedMisMemberSpec(e.target.value);
                        updateTenderField({ assigned_mis_member_spec: e.target.value });
                      }}
                      style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                    >
                      <option value="">-- Unassigned --</option>
                      {specTeamMembers.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
                      {selectedMisMemberSpec || 'Not Assigned'}
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* 3. EMD Payment Card */}
              {currentUser?.role !== 'Specification Team' && areDocsGenerated && (selectedTender.status !== 'New') && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                    
                    {/* Left Panel: Fields */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>3. EMD Payment Details</h4>
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

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>EMD PAYMENT MODE</label>
                          <input 
                            id="emd-mode-input"
                            type="text" 
                            value={emdPaymentMode}
                            onChange={(e) => setEmdPaymentMode(e.target.value)}
                            placeholder="e.g. Online / DD / BG"
                            disabled={selectedTender.payment_status === 'Approved' || currentUser?.role !== 'MIS Executive'}
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
                            disabled={selectedTender.payment_status === 'Approved' || currentUser?.role !== 'MIS Executive'}
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
                            disabled={selectedTender.payment_status === 'Approved' || currentUser?.role !== 'MIS Executive'}
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
                            disabled={selectedTender.payment_status === 'Approved' || currentUser?.role !== 'MIS Executive'}
                            style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px' }}
                          />
                        </div>
                      </div>

                      {/* Action buttons */}
                      {selectedTender.payment_status !== 'Approved' && currentUser?.role === 'MIS Executive' && (
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
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                            <button 
                              className="btn btn-secondary" 
                              style={{ flex: 1, padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                              onClick={() => updateTenderField({
                                emd_payment_mode: emdPaymentMode,
                                emd_amount_actual: emdAmountActual === '' ? null : Number(emdAmountActual),
                                emd_payment_ref: emdPaymentRef,
                                emd_payment_date: emdPaymentDate
                              })}
                            >
                              Save Details
                            </button>
                            <button 
                              className="btn btn-primary" 
                              style={{ flex: 1, padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
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
                                  payment_status: 'Pending'
                                });
                              }}
                            >
                              Submit Approval Request
                            </button>
                          </div>
                        </div>
                      )}

                      {/* MIS Verification Controls */}
                      {selectedTender.payment_status === 'Pending' && (selectedTender.assigned_mis_member_emd && currentUser?.username === selectedTender.assigned_mis_member_emd || currentUser?.role === 'MIS Team') && (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                          <button 
                            className="btn btn-primary" 
                            style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                            onClick={() => updateTenderField({ payment_status: 'Approved' })}
                          >
                            Approve Payment
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            style={{ flex: 1, color: 'var(--accent-red)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                            onClick={() => updateTenderField({ payment_status: 'Rejected' })}
                          >
                            Reject Request
                          </button>
                        </div>
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

              {/* 4. Document Verification Card */}
              {currentUser?.role !== 'Specification Team' && selectedTender.payment_status === 'Approved' && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                    
                    {/* Left Panel: Status & Actions */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>4. Document Verification</h4>
                        <span style={{ 
                          fontSize: '11px', 
                          padding: '2px 8px', 
                          borderRadius: '12px', 
                          backgroundColor: selectedTender.verification_status === 'Approved' ? 'rgba(16, 185, 129, 0.1)' : selectedTender.verification_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : selectedTender.verification_status === 'Rejected' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                          color: selectedTender.verification_status === 'Approved' ? '#10b981' : selectedTender.verification_status === 'Pending' ? '#f59e0b' : selectedTender.verification_status === 'Rejected' ? '#ef4444' : 'var(--text-muted)', 
                          fontWeight: '600' 
                        }}>
                          {selectedTender.verification_status || 'Not Started'}
                        </span>
                      </div>

                      <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: '1.5' }}>
                        Review documents in the Document Repository. Confirm that all local content declarations and signatory details comply with guidelines.
                      </p>

                      {/* Working Folder Path (Documents Store) */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
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
                            disabled={currentUser?.role !== 'MIS Executive' || selectedTender.verification_status === 'Approved'}
                            style={{ 
                              flexGrow: 1, 
                              padding: '8px 12px', 
                              borderRadius: '6px', 
                              background: 'var(--bg-app)', 
                              border: '1px solid var(--border-color)', 
                              color: 'var(--text-primary)', 
                              fontSize: '13px',
                              opacity: (currentUser?.role !== 'MIS Executive' || selectedTender.verification_status === 'Approved') ? 0.6 : 1
                            }}
                          />
                          {currentUser?.role === 'MIS Executive' && selectedTender.verification_status !== 'Approved' && (
                            <button 
                              className="btn btn-secondary" 
                              style={{ padding: '8px 12px', fontSize: '12px' }}
                              onClick={() => updateTenderField({ working_path: workingPath })}
                            >
                              Save Path
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Display assigned MIS Team Representative to other roles or in pending/approved states */}
                      {((selectedTender.verification_status === 'Pending' || selectedTender.verification_status === 'Approved' || currentUser?.role !== 'MIS Executive') && selectedTender.assigned_mis_member_docs) ? (
                        <div style={{ marginBottom: '16px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          <strong>Target MIS Representative:</strong> <span style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_docs}</span>
                        </div>
                      ) : null}

                      {currentUser?.role === 'MIS Executive' && selectedTender.verification_status !== 'Approved' && selectedTender.verification_status !== 'Pending' && (
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
                          <button 
                            className="btn btn-primary" 
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={() => {
                              if (!selectedMisMemberDocs) {
                                showToast('Please select a Target MIS Team Representative first.', 'error');
                                alert('Please select a Target MIS Team Representative first.');
                                return;
                              }
                              updateTenderField({ verification_status: 'Pending' });
                            }}
                          >
                            Request Document Verification
                          </button>
                        </div>
                      )}

                      {selectedTender.verification_status === 'Pending' && (selectedTender.assigned_mis_member_docs && currentUser?.username === selectedTender.assigned_mis_member_docs || currentUser?.role === 'MIS Team') && (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                          <button 
                            className="btn btn-primary" 
                            style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                            onClick={() => updateTenderField({ verification_status: 'Approved' })}
                          >
                            Verify & Approve
                          </button>
                          <button 
                            className="btn btn-secondary" 
                            style={{ flex: 1, color: 'var(--accent-red)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                            onClick={() => updateTenderField({ verification_status: 'Rejected' })}
                          >
                            Reject / Request Changes
                          </button>
                        </div>
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

              {/* 5. Submission & Outcome Card */}
              {currentUser?.role !== 'Specification Team' && selectedTender.verification_status === 'Approved' && (
                <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
                    
                    {/* Left Panel: Status & Actions */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>5. Submission Verification</h4>
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

                      {currentUser?.role === 'MIS Executive' && selectedTender.submission_status !== 'Approved' && selectedTender.submission_status !== 'Pending' && (
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
                              updateTenderField({ submission_status: 'Pending' });
                            }}
                          >
                            Request Submission Verification
                          </button>
                        </div>
                      )}

                      {selectedTender.submission_status === 'Pending' && (selectedTender.assigned_mis_member_submission && currentUser?.username === selectedTender.assigned_mis_member_submission || currentUser?.role === 'MIS Team') && (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                          <button 
                            className="btn btn-primary" 
                            style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                            onClick={() => updateTenderField({ submission_status: 'Approved', status: 'Filed' })}
                          >
                            Verify Submission
                          </button>
                        </div>
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
                                placeholder={currentUser?.role === 'Admin' ? "Discussion is read-only" : "Discuss submission..."} 
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
              {currentUser?.role !== 'Specification Team' && selectedTender.submission_status === 'Approved' && (() => {
                const isWon = selectedTender.status === 'Awarded' || selectedTender.status === 'Won';
                const isLost = selectedTender.status === 'Not Awarded' || selectedTender.status === 'Lost';
                return (
                  <div style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' }}>6. Final Bidding Outcome</h4>
                    
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

                    {!isWon && !isLost && (
                      <>
                        {/* Loss Reason Input */}
                        {(currentUser?.role === 'MIS Team' && (!selectedTender.assigned_by || currentUser?.username === selectedTender.assigned_by)) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                            <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '600' }}>IF LOST, PROVIDE REASON TEXT BOX</label>
                            <textarea 
                              id="loss-reason-textarea"
                              value={lossReason}
                              onChange={(e) => setLossReason(e.target.value)}
                              placeholder="State reason for loss (e.g. L1 Price difference, technical qualification failure, etc.)..."
                              style={{ minHeight: '60px', padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                            />
                          </div>
                        )}

                        {/* MIS Team Approval controls */}
                        {(currentUser?.role === 'MIS Team' && (!selectedTender.assigned_by || currentUser?.username === selectedTender.assigned_by)) ? (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button 
                              className="btn btn-primary" 
                              style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '8px 16px', justifyContent: 'center' }}
                              onClick={() => updateTenderField({ status: 'Awarded' })}
                            >
                              Mark as Won
                            </button>
                            <button 
                              className="btn btn-secondary" 
                              style={{ flex: 1, color: 'var(--accent-red)', padding: '8px 16px', justifyContent: 'center' }}
                              onClick={() => updateTenderField({ status: 'Not Awarded', loss_reason: lossReason })}
                            >
                              Mark as Lost
                            </button>
                          </div>
                        ) : (
                          <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                            Outcome declaration request sent. The MIS Team member who assigned this tender ({selectedTender.assigned_by || 'N/A'}) will review and mark the final Won/Lost state.
                          </p>
                        )}
                      </>
                    )}
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
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '24px',
          background: 'rgba(30, 30, 40, 0.85)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--primary)',
          borderRadius: '10px',
          padding: '10px 16px',
          zIndex: 9999,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          pointerEvents: 'none',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: currentUser.role === 'Admin' ? '#3b82f6' : currentUser.role === 'MIS Team' ? '#10b981' : currentUser.role === 'Specification Team' ? '#9333ea' : '#f59e0b',
            boxShadow: `0 0 8px ${currentUser.role === 'Admin' ? '#3b82f6' : currentUser.role === 'MIS Team' ? '#10b981' : currentUser.role === 'Specification Team' ? '#9333ea' : '#f59e0b'}`
          }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: '700', letterSpacing: '0.5px' }}>
              Active Session
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: '600' }}>
              {currentUser.username} ({currentUser.role})
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
