"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Inbox,
  FileText,
  History,
  Search,
  Mail,
  Trash2,
  TrendingUp,
  Clock,
  Settings,
  Layers,
  Globe,
  Building,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  AlertOctagon,
  X,
  XCircle,
  MinusCircle,
  ExternalLink,
  Moon,
  Sun,
  RefreshCw,
  SlidersHorizontal,
  Download,
  ChevronRight,
  Loader2,
  Info,
  Users,
  UserPlus,
  Briefcase,
  Activity,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  DollarSign,
  Calendar,
  MapPin,
  Tag,
  BookOpen
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { Tender } from '@/lib/db';

type TabType = 'dashboard' | 'tenders' | 'analytics' | 'settings' | 'audit' | 'team' | 'work-summary';

interface Toast {
  message: string;
  type: 'success' | 'error';
  show: boolean;
}

export default function Dashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);

  // User Authentication & Session States
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Executive Lists & Activity Log States
  const [executives, setExecutives] = useState<string[]>([]);
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'assignments'>('all');
  const [assignmentGroupBy, setAssignmentGroupBy] = useState<'flat' | 'assigner' | 'executive'>('executive');
  const [drillDown, setDrillDown] = useState<{ username: string; category: 'live' | 'inProgress' | 'submitted' | 'missed' | 'won' | 'lost'; label: string } | null>(null);
  const [drillDownPage, setDrillDownPage] = useState(1);

  // Team Management States
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [execSearchQuery, setExecSearchQuery] = useState('');
  const [execSortField, setExecSortField] = useState<'username' | 'live' | 'inProgress' | 'submitted' | 'missed' | 'won' | 'lost' | 'successRate' | 'totalTenders'>('username');
  const [execSortOrder, setExecSortOrder] = useState<'asc' | 'desc'>('asc');
  const [execPage, setExecPage] = useState(1);
  const [execLimit, setExecLimit] = useState(10);
  const [assignSearchQuery, setAssignSearchQuery] = useState('');
  const [assignSortField, setAssignSortField] = useState<'id' | 'title' | 'mis_executive' | 'assigned_by' | 'assigned_at'>('assigned_at');
  const [assignSortOrder, setAssignSortOrder] = useState<'asc' | 'desc'>('desc');
  const [assignPage, setAssignPage] = useState(1);
  const [assignLimit, setAssignLimit] = useState(10);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logPage, setLogPage] = useState(1);
  const [logLimit, setLogLimit] = useState(10);
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState('MIS Team');
  const [regError, setRegError] = useState('');
  const [regSuccess, setRegSuccess] = useState('');
  const [submittingUser, setSubmittingUser] = useState(false);

  // Custom fetch wrapper injecting authentication headers
  const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers || {});
    headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    headers.set('Pragma', 'no-cache');
    headers.set('Expires', '0');
    if (currentUser) {
      headers.set('x-user-role', currentUser.role);
      headers.set('x-user-username', currentUser.username);
      const token = localStorage.getItem('token');
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }
    return fetch(url, { cache: 'no-store', ...options, headers });
  };
  
  // Data States
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [allAssignedTenders, setAllAssignedTenders] = useState<Tender[]>([]);
  const [filters, setFilters] = useState({ locations: [] as string[], sectors: [] as string[] });
  const [analytics, setAnalytics] = useState<any>(null);
  
  // Loading States
  const [loading, setLoading] = useState(true);
  const [processingEmail, setProcessingEmail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [sectorFilter, setSectorFilter] = useState('');
  const [misExecutiveFilter, setMisExecutiveFilter] = useState('');
  const [sortBy, setSortBy] = useState('scraped_at');
  const [sortOrder, setSortOrder] = useState('desc');

  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const selectedTenderRef = useRef<Tender | null>(selectedTender);
  useEffect(() => {
    selectedTenderRef.current = selectedTender;
  }, [selectedTender]);

  // Keep form inputs in sync with selectedTender when updated externally in real-time
  useEffect(() => {
    if (selectedTender) {
      setTenderNotes(selectedTender.notes || '');
      setWorkingPath(selectedTender.working_path || '');
      setEmdPaymentMode(selectedTender.emd_payment_mode || '');
      setEmdPaymentRef(selectedTender.emd_payment_ref || '');
      setEmdAmountActual(selectedTender.emd_amount_actual ?? '');
      setEmdPaymentDate(selectedTender.emd_payment_date || '');
      setLossReason(selectedTender.loss_reason || '');
      setBidQty(selectedTender.bid_qty ?? '');
      setQuotedQty(selectedTender.quoted_qty ?? '');
      setMisExecutive(selectedTender.mis_executive || '');
      setSelectedMisMember(selectedTender.assigned_mis_member || '');
    }
  }, [
    selectedTender?.id, 
    selectedTender?.status, 
    selectedTender?.payment_status, 
    selectedTender?.verification_status, 
    selectedTender?.submission_status, 
    selectedTender?.working_path, 
    selectedTender?.emd_payment_mode, 
    selectedTender?.emd_payment_ref, 
    selectedTender?.emd_amount_actual, 
    selectedTender?.emd_payment_date, 
    selectedTender?.notes, 
    selectedTender?.loss_reason, 
    selectedTender?.assigned_mis_member, 
    selectedTender?.mis_executive
  ]);

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
  const [tenderNotes, setTenderNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [misExecutive, setMisExecutive] = useState('');
  const [bidQty, setBidQty] = useState<number | ''>('');
  const [quotedQty, setQuotedQty] = useState<number | ''>('');
  const [detailsSummary, setDetailsSummary] = useState('');
  const [statusHistorySummary, setStatusHistorySummary] = useState('');
  const [tenderHistory, setTenderHistory] = useState<any[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  
  // Workflow, Comments and Stats States
  const [execStats, setExecStats] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [emdCommentText, setEmdCommentText] = useState('');
  const [verificationCommentText, setVerificationCommentText] = useState('');
  const [submissionCommentText, setSubmissionCommentText] = useState('');
  const [selectedMisMember, setSelectedMisMember] = useState('');
  const [selectedMisMemberSpec, setSelectedMisMemberSpec] = useState('');
  const [misTeamMembers, setMisTeamMembers] = useState<string[]>([]);
  const [specTeamMembers, setSpecTeamMembers] = useState<string[]>([]);
  const [corrigendumFilter, setCorrigendumFilter] = useState(false);
  const [lossReason, setLossReason] = useState('');
  const [workingPath, setWorkingPath] = useState('');
  const [emdPaymentMode, setEmdPaymentMode] = useState('');
  const [emdPaymentRef, setEmdPaymentRef] = useState('');
  const [emdAmountActual, setEmdAmountActual] = useState<number | ''>('');
  const [emdPaymentDate, setEmdPaymentDate] = useState('');
  
  // Email Import States
  const [emailText, setEmailText] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadedEmlString, setUploadedEmlString] = useState('');

  // Bid Document Form States
  const [isBidDocFormOpen, setIsBidDocFormOpen] = useState(false);
  const [formActiveTab, setFormActiveTab] = useState<'tender' | 'company' | 'signatory' | 'clauses'>('tender');
  const [generatingBidDocs, setGeneratingBidDocs] = useState(false);
  const [bidFormFields, setBidFormFields] = useState({
    date: "",
    authorityName: "",
    authorityDept: "",
    authorityAddress: "",
    bidNumber: "",
    bidDate: "",
    productDescription: "",
    companyName: "Mark Enterprises",
    companyAddress: "Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India",
    companyEmail: "info@markenworld.com",
    companyWebsite: "www.markenworld.com",
    companyContact: "09175559646 / 090111 04332",
    manufacturerName: "M/s. Mark Enterprises",
    manufacturerAddress: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
    signatoryName: "Korra Praveen Naik",
    signatoryDesignation: "Partner",
    signatoryAddress: "1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, District: Hyderabad, State: Andhra Pradesh, PIN Code: 500062",
    witnessDetails: "Mr. Shreedhar Shingare (Cell No.: 09011104332)",
    localContentPercentage: "100%",
    localContentLocation: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
    preferencePolicy: "PPP MII 2017",
    warrantyPeriod: "Five (5) years",
    serviceSupportPeriod: "Five (5) years",
    sparesAvailabilityPeriod: "Ten (10) years",
    place: "Nashik"
  });

  const openBidDocForm = () => {
    if (!selectedTender) return;
    
    const d = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedToday = `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;

    setBidFormFields({
      date: formattedToday,
      authorityName: selectedTender.authority || "",
      authorityDept: selectedTender.authority || "",
      authorityAddress: selectedTender.place ? `${selectedTender.place}, ${selectedTender.state || ''}` : "",
      bidNumber: selectedTender.ref_no || "",
      bidDate: selectedTender.publish_date || selectedTender.start_date || formattedToday,
      productDescription: selectedTender.product_name_as_per_tender || selectedTender.title || "",
      companyName: "Mark Enterprises",
      companyAddress: "Shed No. 1, Plot No. 93/2, Street No. 17, MIDC Satpur, Nashik – 422007, Maharashtra, India",
      companyEmail: "info@markenworld.com",
      companyWebsite: "www.markenworld.com",
      companyContact: "09175559646 / 090111 04332",
      manufacturerName: "M/s. Mark Enterprises",
      manufacturerAddress: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
      signatoryName: "Korra Praveen Naik",
      signatoryDesignation: "Partner",
      signatoryAddress: "1-1-51/46, Kapra, ECIL post, S.T.Colony, VTC: Ranga Reddy, District: Hyderabad, State: Andhra Pradesh, PIN Code: 500062",
      witnessDetails: "Mr. Shreedhar Shingare (Cell No.: 09011104332)",
      localContentPercentage: "100%",
      localContentLocation: "Shed No.1, Plot No.93/2, Street No.17, Satpur MIDC, Nashik-422007, Maharashtra",
      preferencePolicy: "PPP MII 2017",
      warrantyPeriod: "Five (5) years",
      serviceSupportPeriod: "Five (5) years",
      sparesAvailabilityPeriod: "Ten (10) years",
      place: "Nashik"
    });
    setFormActiveTab('tender');
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
        handleRefresh();
        
        const newDocWord = { 
          name: "Generated Bid Documents (Word DOCX)", 
          filename: `Bid_Documents_${selectedTender.id}.docx`, 
          local_path: data.downloadUrl, 
          created_date: new Date().toLocaleDateString('en-IN') 
        };
        const newDocPdf = { 
          name: "Generated Bid Documents (PDF)", 
          filename: `Bid_Documents_${selectedTender.id}.pdf`, 
          local_path: data.pdfDownloadUrl, 
          created_date: new Date().toLocaleDateString('en-IN') 
        };
        
        setTenders(prev => prev.map(t => {
          if (t.id === selectedTender.id) {
            let currentDocs = [];
            try {
              currentDocs = JSON.parse(t.downloaded_docs || '[]');
              if (!Array.isArray(currentDocs)) currentDocs = [];
            } catch {
              currentDocs = [];
            }
            currentDocs = currentDocs.filter((d: any) => d.local_path !== data.downloadUrl && d.local_path !== data.pdfDownloadUrl);
            currentDocs.push(newDocWord);
            currentDocs.push(newDocPdf);
            return { ...t, downloaded_docs: JSON.stringify(currentDocs) };
          }
          return t;
        }));
        
        setSelectedTender(prev => {
          if (!prev) return null;
          let currentDocs = [];
          try {
            currentDocs = JSON.parse(prev.downloaded_docs || '[]');
            if (!Array.isArray(currentDocs)) currentDocs = [];
          } catch {
            currentDocs = [];
          }
          currentDocs = currentDocs.filter((d: any) => d.local_path !== data.downloadUrl && d.local_path !== data.pdfDownloadUrl);
          currentDocs.push(newDocWord);
          currentDocs.push(newDocPdf);
          return { 
            ...prev, 
            downloaded_docs: JSON.stringify(currentDocs) 
          };
        });
      } else {
        showToast(data.error || 'Failed to generate bid documents.', 'error');
      }
    } catch (err) {
      setGeneratingBidDocs(false);
      showToast('Error communicating with server.', 'error');
    }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasCheckedUrlRouteRef = useRef(false);



  // Toast State
  const [toast, setToast] = useState<Toast>({ message: '', type: 'success', show: false });

  // Handle Hydration Safe rendering and Hash Routing
  useEffect(() => {
    setMounted(true);
    
    // Check local storage or prefers-color-scheme
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme || 'dark';
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);

    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      try {
        setCurrentUser(JSON.parse(storedUser));
      } catch (e) {
        console.error('Failed to parse currentUser from localStorage:', e);
      }
    }

    const handleHashChange = () => {
      const hash = window.location.hash.replace('#/', '');
      const validTabs: TabType[] = ['dashboard', 'tenders', 'analytics', 'settings', 'audit', 'team', 'work-summary'];
      if (validTabs.includes(hash as TabType)) {
        setActiveTab(hash as TabType);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    if (window.location.hash) {
      handleHashChange();
    } else {
      window.location.hash = '#/dashboard';
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (mounted && activeTab) {
      window.location.hash = `#/${activeTab}`;
    }
  }, [activeTab, mounted]);

  useEffect(() => {
    if (mounted && currentUser) {
      fetchData();
      if (currentUser.role === 'MIS Team' || currentUser.role === 'Admin') {
        fetchExecutives();
      }
    }
  }, [currentUser]);

  useEffect(() => {
    if (activeTab === 'audit' && currentUser?.role === 'Admin') {
      fetchActivityLogs();
    }
    if (activeTab === 'team' && currentUser?.role === 'Admin') {
      fetchUsers();
    }
    if (activeTab === 'work-summary' && (currentUser?.role === 'Admin' || currentUser?.role === 'MIS Team')) {
      fetchUsers();
      fetchAssignedTenders();
    }
  }, [activeTab, currentUser]);

  // Handle direct /tenders/[id] routing once on initial page load
  useEffect(() => {
    if (!mounted || !tenders.length || hasCheckedUrlRouteRef.current) return;

    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/tenders/')) {
      const idFromUrl = window.location.pathname.replace('/tenders/', '').trim();
      if (idFromUrl) {
        hasCheckedUrlRouteRef.current = true;
        const match = tenders.find(t => String(t.id) === idFromUrl);
        if (match) {
          setSelectedTender(match);
          setIsDrawerOpen(true);
          setTenderNotes(match.notes || '');
          setWorkingPath(match.working_path || '');
          setEmdPaymentMode(match.emd_payment_mode || '');
          setEmdPaymentRef(match.emd_payment_ref || '');
          setEmdAmountActual(match.emd_amount_actual ?? '');
          setEmdPaymentDate(match.emd_payment_date || '');
          setLossReason(match.loss_reason || '');
          setBidQty(match.bid_qty ?? '');
          setQuotedQty(match.quoted_qty ?? '');
          setMisExecutive(match.mis_executive || '');
          setSelectedMisMember(match.assigned_mis_member || '');

          fetchHistoryAndSummaries(match.id);
          fetchComments(match.id);
        }
      }
    }
  }, [mounted, tenders]);

  // Handle browser Back / Forward navigation popstate events
  useEffect(() => {
    if (!mounted) return;

    const handlePopState = () => {
      const pathname = window.location.pathname;
      if (pathname.startsWith('/tenders/')) {
        const idFromUrl = pathname.replace('/tenders/', '').trim();
        if (idFromUrl) {
          const match = tenders.find(t => String(t.id) === idFromUrl);
          if (match) {
            setSelectedTender(match);
            setIsDrawerOpen(true);
            setTenderNotes(match.notes || '');
            setWorkingPath(match.working_path || '');
            setEmdPaymentMode(match.emd_payment_mode || '');
            setEmdPaymentRef(match.emd_payment_ref || '');
            setEmdAmountActual(match.emd_amount_actual ?? '');
            setEmdPaymentDate(match.emd_payment_date || '');
            setLossReason(match.loss_reason || '');
            setBidQty(match.bid_qty ?? '');
            setQuotedQty(match.quoted_qty ?? '');
            setMisExecutive(match.mis_executive || '');
            setSelectedMisMember(match.assigned_mis_member || '');

            fetchHistoryAndSummaries(match.id);
            fetchComments(match.id);
          }
        }
      } else {
        setIsDrawerOpen(false);
        setSelectedTender(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mounted, tenders]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchTenders(), fetchAnalytics(), fetchAssignedTenders(), fetchExecStats(), fetchMisTeam()]);
    } catch (e) {
      showToast('Failed to retrieve dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchTenders = async () => {
    try {
      const params = new URLSearchParams({
        search: searchQuery,
        status: statusFilter,
        location: locationFilter,
        sector: sectorFilter,
        sortBy,
        order: sortOrder,
        mis_executive: misExecutiveFilter
      });
      const response = await fetchWithAuth(`/api/tenders?${params.toString()}`);
      if (!response.ok) throw new Error('API Error');
      const data = await response.json();
      if (data.success) {
        setTenders(data.tenders);
        setFilters(data.filters);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchAssignedTenders = async () => {
    try {
      const response = await fetchWithAuth('/api/tenders');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setAllAssignedTenders(data.tenders.filter((t: any) => t.mis_executive));
        }
      }
    } catch (e) {
      console.error('Failed to fetch assignments list:', e);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const response = await fetchWithAuth('/api/analytics');
      if (!response.ok) throw new Error('API Error');
      const data = await response.json();
      if (data.success) {
        setAnalytics(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchExecStats = async () => {
    try {
      const response = await fetchWithAuth('/api/tenders/stats');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setExecStats(data.stats);
        }
      }
    } catch (e) {
      console.error('Failed to fetch executive stats:', e);
    }
  };

  const fetchMisTeam = async () => {
    try {
      const response = await fetchWithAuth('/api/auth/users');
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.users)) {
          const misMembers = data.users.filter((u: any) => u.role === 'MIS Team').map((u: any) => u.username);
          setMisTeamMembers(misMembers);
          const specMembers = data.users.filter((u: any) => u.role === 'Specification Team' || u.role === 'Clearance Team').map((u: any) => u.username);
          setSpecTeamMembers(specMembers);
        }
      }
    } catch (e) {
      console.error('Failed to fetch team members list:', e);
    }
  };

  const fetchExecutives = async () => {
    try {
      const response = await fetchWithAuth('/api/auth/executives');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setExecutives(data.executives);
        }
      }
    } catch (e) {
      console.error('Failed to fetch executives list:', e);
    }
  };

  const fetchActivityLogs = async () => {
    setLoadingLogs(true);
    try {
      const response = await fetchWithAuth('/api/activity-logs');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setActivityLogs(data.logs);
        }
      }
    } catch (e) {
      console.error('Error fetching activity logs:', e);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchUsers = async () => {
    if (currentUser?.role !== 'Admin' && currentUser?.role !== 'MIS Team') return;
    setLoadingUsers(true);
    try {
      const response = await fetchWithAuth('/api/auth/users');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setUsersList(data.users);
        }
      }
    } catch (e) {
      console.error('Failed to fetch team list:', e);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError('');
    setRegSuccess('');

    if (currentUser?.role !== 'Admin' && currentUser?.role !== 'MIS Team') {
      setRegError('Only Admin or MIS Team can create user accounts.');
      showToast('Action restricted to Admin or MIS Team.', 'error');
      return;
    }

    if (!regUsername.trim() || !regPassword) {
      setRegError('Username and password are required.');
      return;
    }

    if (regPassword.length < 6) {
      setRegError('Password must be at least 6 characters long.');
      return;
    }

    setSubmittingUser(true);
    try {
      const response = await fetchWithAuth('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: regUsername.trim(),
          password: regPassword,
          role: regRole,
          email: regEmail.trim()
        })
      });
      const data = await response.json();
      if (data.success) {
        setRegSuccess(`Account for "${regUsername.trim()}" (${regRole}) created successfully!`);
        setRegUsername('');
        setRegEmail('');
        setRegPassword('');
        setRegRole('MIS Team');
        fetchUsers();
        fetchExecutives(); // Update dropdowns list
        showToast('User created successfully', 'success');
      } else {
        setRegError(data.error || 'Failed to create user account.');
      }
    } catch (e) {
      setRegError('Error connecting to user registration API.');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeleteUser = async (usernameToDelete: string) => {
    if (currentUser?.role !== 'Admin' && currentUser?.role !== 'MIS Team') {
      showToast('Action restricted to Admin or MIS Team.', 'error');
      return;
    }

    if (usernameToDelete.toLowerCase() === 'admin') {
      showToast('Cannot delete the primary Admin account', 'error');
      return;
    }

    if (!confirm(`Are you sure you want to delete the user "${usernameToDelete}"?`)) {
      return;
    }

    try {
      const response = await fetchWithAuth(`/api/auth/users?username=${encodeURIComponent(usernameToDelete)}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        showToast(`User "${usernameToDelete}" deleted successfully`, 'success');
        fetchUsers();
        fetchExecutives(); // Also refresh executive dropdown
      } else {
        showToast(data.error || 'Failed to delete user account', 'error');
      }
    } catch (e) {
      showToast('Error connecting to user delete API', 'error');
    }
  };

  const openTenderDetailsByTenderId = async (tenderId: string) => {
    router.push(`/tenders/${tenderId}`);
  };

  const handleLogout = () => {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    setCurrentUser(null);
    setActiveTab('dashboard');
  };

  // Trigger search and filters fetch
  useEffect(() => {
    if (mounted && currentUser) {
      const timer = setTimeout(() => {
        fetchTenders();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, statusFilter, locationFilter, sectorFilter, sortBy, sortOrder, activeTab, currentUser, misExecutiveFilter]);

  // Background Auto-Sync Poll for Dashboard
  useEffect(() => {
    if (!mounted || !currentUser) return;

    const interval = setInterval(async () => {
      try {
        const fetchUrlParams = new URLSearchParams({
          search: searchQuery,
          status: statusFilter,
          location: locationFilter,
          sector: sectorFilter,
          sortBy,
          order: sortOrder,
          mis_executive: misExecutiveFilter,
          t: Date.now().toString()
        });

        // 1. Silent fetch tenders
        const tResp = await fetchWithAuth(`/api/tenders?${fetchUrlParams.toString()}`);
        if (tResp.ok) {
          const tData = await tResp.json();
          if (tData.success && tData.tenders) {
            setTenders(tData.tenders);
            if (selectedTenderRef.current) {
              const freshSel = tData.tenders.find((t: any) => t.id === selectedTenderRef.current?.id);
              if (freshSel) {
                setSelectedTender(prev => prev ? { ...prev, ...freshSel } : null);
              }
            }
          }
        }

        // 2. Silent fetch analytics
        const aResp = await fetchWithAuth(`/api/analytics?t=${Date.now()}`);
        if (aResp.ok) {
          const aData = await aResp.json();
          if (aData.success) {
            setAnalytics(aData);
          }
        }

        // 3. Silent fetch assigned mapping list (if Admin)
        if (currentUser.role === 'Admin') {
          const mResp = await fetchWithAuth(`/api/tenders?status=Participating&t=${Date.now()}`);
          if (mResp.ok) {
            const mData = await mResp.json();
            if (mData.success && mData.tenders) {
              setAllAssignedTenders(mData.tenders.filter((t: any) => t.mis_executive));
            }
          }
        }

        // 4. Silent fetch exec stats (if Admin or MIS Team)
        if (currentUser.role === 'Admin' || currentUser.role === 'MIS Team') {
          const sResp = await fetchWithAuth(`/api/tenders/stats?t=${Date.now()}`);
          if (sResp.ok) {
            const sData = await sResp.json();
            if (sData.success && sData.stats) {
              setExecStats(sData.stats);
            }
          }
        }

        // 5. Silent fetch full tender object & comments for currently open tender drawer
        if (selectedTenderRef.current) {
          const activeId = selectedTenderRef.current.id;
          const tDetailResp = await fetchWithAuth(`/api/tenders/${activeId}?t=${Date.now()}`);
          if (tDetailResp.ok) {
            const tDetailData = await tDetailResp.json();
            if (tDetailData.success && tDetailData.tender) {
              setSelectedTender(tDetailData.tender);
            }
          }

          const cResp = await fetchWithAuth(`/api/tenders/${activeId}/comments?t=${Date.now()}`);
          if (cResp.ok) {
            const cData = await cResp.json();
            if (cData.success && cData.comments) {
              setComments(cData.comments);
            }
          }
        }
      } catch (err) {
        console.error('Dashboard silent background poll failed:', err);
      }
    }, 1500); // Poll every 1.5 seconds for instant real-time sync across sessions

    return () => clearInterval(interval);
  }, [mounted, currentUser, searchQuery, statusFilter, locationFilter, sectorFilter, sortBy, sortOrder, activeTab, misExecutiveFilter]);


  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type, show: true });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      showToast('Initiating background synchronization...', 'success');
      
      // 1. Sync emails from Tender247
      const emailRes = await fetchWithAuth('/api/tenders/sync-emails', { method: 'POST' });
      const emailData = await emailRes.json();
      
      // 2. Sync GeM portal bids
      const gemRes = await fetchWithAuth('/api/tenders/sync-gem', { method: 'POST' });
      const gemData = await gemRes.json();

      // 3. Fetch latest database details
      await fetchData();

      if (emailData.success && gemData.success) {
        showToast(`Sync complete! GeM bids: +${gemData.importedCount || 0}, Emails: +${emailData.importedCount || 0}`, 'success');
      } else {
        showToast('Sync completed with warnings', 'success');
      }
    } catch (e) {
      console.error('System sync trigger failed:', e);
      showToast('System sync request failed', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // EML Drag-and-Drop and Upload
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processUploadedFile(e.target.files[0]);
    }
  };

  const processUploadedFile = (file: File) => {
    if (!file.name.endsWith('.eml')) {
      showToast('Please upload a valid .eml email file.', 'error');
      return;
    }
    
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setUploadedEmlString(text);
    };
    reader.readAsText(file);
  };

  // Submit parsed email
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailText && !uploadedEmlString) {
      showToast('Please paste email text or upload an EML file.', 'error');
      return;
    }

    setProcessingEmail(true);
    try {
      const payload = uploadedEmlString 
        ? { emlString: uploadedEmlString }
        : { emailBody: emailText };

      const response = await fetchWithAuth('/api/process-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data.success) {
        showToast(data.message, 'success');
        // Clear imports
        setEmailText('');
        setUploadedEmlString('');
        setUploadedFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        
        // Refresh data
        await fetchData();
        // Redirect to tenders view
        setActiveTab('tenders');
      } else {
        showToast(data.error || 'Failed to process email contents', 'error');
      }
    } catch (err) {
      showToast('Error sending import request', 'error');
    } finally {
      setProcessingEmail(false);
    }
  };



  // Helper to fetch summaries and history log
  const fetchHistoryAndSummaries = async (tenderId: string, status?: string) => {
    setLoadingDetails(true);
    try {
      const response = await fetchWithAuth(`/api/tenders/${tenderId}`);
      const data = await response.json();
      if (data.success) {
        setDetailsSummary(data.summaries.detailsSummary);
        setStatusHistorySummary(data.summaries.statusHistorySummary);
        setTenderHistory(data.history);
        
        // Update selected tender state if status matches/changed
        if (status && selectedTender && selectedTender.id === tenderId) {
          setSelectedTender(prev => prev ? { ...prev, ...data.tender } : null);
        }
      }
    } catch (e) {
      console.error('Error fetching summaries:', e);
    } finally {
      setLoadingDetails(false);
    }
  };

  const fetchComments = async (tenderId: string) => {
    try {
      const response = await fetchWithAuth(`/api/tenders/${tenderId}/comments`);
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

  const postComment = async (phase: string, text: string) => {
    if (!text.trim() || !selectedTender) return;
    try {
      const response = await fetchWithAuth(`/api/tenders/${selectedTender.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: text, phase })
      });
      const data = await response.json();
      if (data.success) {
        showToast('Comment posted successfully!', 'success');
        if (phase === 'Payment') setEmdCommentText('');
        else if (phase === 'Verification') setVerificationCommentText('');
        else if (phase === 'Submission') setSubmissionCommentText('');
        fetchComments(selectedTender.id);
      } else {
        showToast(data.error || 'Failed to post comment.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const updateTenderField = async (fields: Partial<Tender>) => {
    if (!selectedTender) return;
    try {
      const response = await fetchWithAuth(`/api/tenders/${selectedTender.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
      const data = await response.json();
      if (data.success) {
        showToast('Workflow updated successfully!', 'success');
        // Refresh details
        fetchHistoryAndSummaries(selectedTender.id);
        fetchComments(selectedTender.id);
        fetchTenders();
      } else {
        showToast(data.error || 'Failed to update workflow.', 'error');
      }
    } catch (e) {
      showToast('Error communicating with server.', 'error');
    }
  };

  const handleTechSpecUpload = async (fileToUpload: File) => {
    if (!selectedTender || !fileToUpload) return;
    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);

      const response = await fetchWithAuth(`/api/tenders/${selectedTender.id}/upload-tech-spec`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.success) {
        showToast('Technical Specification document uploaded successfully!', 'success');
        updateTenderField({
          has_tech_spec: true,
          tech_spec_file: data.filename || fileToUpload.name,
          spec_verification_status: 'Pending'
        });
      } else {
        showToast(data.error || 'Failed to upload technical specification.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error uploading technical specification.', 'error');
    }
  };

  const closeTenderDetails = () => {
    setIsDrawerOpen(false);
    setSelectedTender(null);
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/tenders/')) {
      window.history.pushState({}, '', `/#/${activeTab}`);
    }
  };

  // Open Dedicated Full-Page Tender Detail View via Full HTTP Navigation Redirection
  const openTenderDetails = (tender: Tender) => {
    if (typeof window !== 'undefined') {
      window.location.href = `/tenders/${tender.id}`;
    }
  };

  // Handle Dashboard Metric Card Click
  const handleMetricCardClick = (status: string) => {
    setSearchQuery('');
    setLocationFilter('');
    setSectorFilter('');
    setStatusFilter(status);
    setActiveTab('tenders');
  };

  const dbStatusToPlainEnglish = (status: string): string => {
    if (!status) return 'New';
    switch (status) {
      case 'Issued': return 'New';
      case 'Lapsed (Unreviewed)': return 'Lapsed';
      case 'Participating': return 'Participating';
      case 'Not Participating': return 'Not Participating';
      case 'Filed': return 'Submitted';
      case 'Awarded': return 'Won';
      case 'Not Awarded': return 'Lost';
      case 'Business Loss due to Non-Submission': return 'Missed Deadline';
      case 'Business Loss due to Non-Participation': return 'Missed Opportunity';
      default: return status;
    }
  };

  // Update Tender Status
  const handleStatusChange = async (tenderId: string, newStatus: 'Issued' | 'Participating' | 'Not Participating' | 'Filed' | 'Awarded' | 'Not Awarded') => {
    try {
      const response = await fetchWithAuth(`/api/tenders/${tenderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await response.json();
      if (data.success) {
        const plainStatus = dbStatusToPlainEnglish(newStatus);
        setTenders(prev => prev.map(t => t.id === tenderId ? { ...t, status: plainStatus as any } : t));
        if (selectedTender && selectedTender.id === tenderId) {
          setSelectedTender(prev => prev ? { ...prev, status: plainStatus as any } : null);
          // Refresh details & history since status changed
          fetchHistoryAndSummaries(tenderId, newStatus);
        }
        showToast(`Status updated to ${plainStatus}`, 'success');
        fetchAnalytics(); // Refresh analytics metrics
        fetchAssignedTenders();
      }
    } catch (e) {
      showToast('Failed to update status', 'error');
    }
  };

  // Save Tender Notes and Management metadata
  const saveNotes = async () => {
    if (!selectedTender) return;
    setNotesSaving(true);
    const updatedFields = {
      notes: tenderNotes,
      mis_executive: misExecutive,
      bid_qty: bidQty === '' ? null : Number(bidQty),
      quoted_qty: quotedQty === '' ? null : Number(quotedQty)
    };
    try {
      const response = await fetchWithAuth(`/api/tenders/${selectedTender.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedFields)
      });
      const data = await response.json();
      if (data.success) {
        const extraFields: any = {};
        if (misExecutive !== selectedTender.mis_executive) {
          extraFields.assigned_by = misExecutive ? currentUser?.username : null;
          extraFields.assigned_at = misExecutive ? new Date().toISOString() : null;
          if (misExecutive && (!selectedTender.status || selectedTender.status === 'New' || selectedTender.status === 'Issued' || selectedTender.status === 'Lapsed' || selectedTender.status === 'Lapsed (Unreviewed)')) {
            extraFields.status = 'Participating';
          }
        }
        const finalFields = { ...updatedFields, ...extraFields };
        setTenders(prev => prev.map(t => t.id === selectedTender.id ? { ...t, ...finalFields } : t));
        setSelectedTender(prev => prev ? { ...prev, ...finalFields } : null);
        showToast('Changes saved successfully', 'success');
        fetchAssignedTenders();
      }
    } catch (e) {
      showToast('Failed to save changes', 'error');
    } finally {
      setNotesSaving(false);
    }
  };

  // Export filtered tenders list to CSV
  const exportToCSV = () => {
    if (tenders.length === 0) {
      showToast('No tenders available to export', 'error');
      return;
    }

    const headers = [
      'Entry date',
      'Source',
      'Source id',
      'Vertical Name',
      'Organisation Name',
      'Place',
      'State',
      '"Tender Type\n(GeM  / Non GeM)\n"',
      'TENDER ID',
      'LINK',
      'PUBLISH DATE',
      '   Start Date',
      'End Date',
      'Time',
      'Pre Bid Date',
      'Corrigendum Remark',
      'Product Name As per Tender',
      'Product Name As per MarkEn',
      'Bid Qty',
      'Quoted Qty'
    ];

    const escapeCsvValue = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      return `"${str.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    };

    let csvContent = headers.join(',') + '\n';

    tenders.forEach((t) => {
      const row = [
        t.entry_date || '',
        t.source || 'Tender247',
        t.id, // Source id is basically the tender id in tender 247
        t.vertical_name || 'Others',
        t.authority || 'N/A',
        t.place || 'N/A',
        t.state || 'N/A',
        t.tender_type || 'Non GeM',
        t.ref_no || '', // TENDER ID is the ref_no (procurement reference number)
        t.original_url,
        t.publish_date || 'N/A',
        t.start_date || 'N/A',
        t.due_date || 'N/A',
        t.time || 'N/A',
        t.pre_bid_date || 'No',
        t.corrigendum_remark || 'No',
        t.product_name_as_per_tender || t.title,
        t.product_name_as_per_marken || t.vertical_name || 'Others',
        t.bid_qty !== undefined && t.bid_qty !== null ? t.bid_qty : 1,
        t.quoted_qty !== undefined && t.quoted_qty !== null ? t.quoted_qty : 1
      ];

      csvContent += row.map(escapeCsvValue).join(',') + '\n';
    });

    try {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `tender_pocket_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast(`Exported ${tenders.length} tenders to CSV successfully`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export CSV file', 'error');
    }
  };

  // Delete Tender
  const handleDeleteTender = async (tenderId: string) => {
    if (!confirm('Are you sure you want to delete this tender? This action cannot be undone.')) return;
    try {
      const response = await fetchWithAuth(`/api/tenders/${tenderId}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        setTenders(prev => prev.filter(t => t.id !== tenderId));
        setIsDrawerOpen(false);
        setSelectedTender(null);
        showToast('Tender deleted successfully', 'success');
        fetchAnalytics();
      }
    } catch (e) {
      showToast('Failed to delete tender', 'error');
    }
  };

  // Formatting helpers
  const formatCost = (val: number | null, raw: string | null) => {
    if (val === null) return raw || 'Refer Document';
    if (val >= 10000000) {
      return `₹${(val / 10000000).toFixed(2)} Cr`;
    }
    if (val >= 100000) {
      return `₹${(val / 100000).toFixed(2)} Lakh`;
    }
    return `₹${val.toLocaleString('en-IN')}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      const normalizedStr = dateStr.includes(' ') && !dateStr.includes('T') ? dateStr.replace(' ', 'T') : dateStr;
      const date = new Date(normalizedStr);
      if (isNaN(date.getTime())) return dateStr;
      
      const hasTime = dateStr.includes(':') || dateStr.includes('T');
      if (hasTime) {
        return date.toLocaleString('en-IN', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric', 
          hour: 'numeric', 
          minute: '2-digit', 
          hour12: true 
        });
      }
      return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  };

  const isClosingSoon = (dueDateStr: string | null) => {
    if (!dueDateStr) return false;
    try {
      const due = new Date(dueDateStr).getTime();
      const now = new Date().getTime();
      const diffDays = (due - now) / (1000 * 3600 * 24);
      return diffDays >= 0 && diffDays <= 5;
    } catch (e) {
      return false;
    }
  };

  const getDeadlineStatus = (dueDateStr: string | null) => {
    if (!dueDateStr) return { label: 'Active', className: 'active' };
    try {
      const dueParsed = new Date(dueDateStr);
      if (isNaN(dueParsed.getTime())) return { label: 'Active', className: 'active' };
      
      const dueTime = dueParsed.getTime();
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const todayTime = now.getTime();
      
      const diffTime = dueTime - todayTime;
      const diffDays = Math.ceil(diffTime / (1000 * 3600 * 24));
      
      if (diffDays < 0) {
        return { label: 'Due Date Over', className: 'overdue' };
      } else if (diffDays <= 3) {
        return { label: 'Due', className: 'due' };
      }
      return { label: 'Active', className: 'active' };
    } catch (e) {
      return { label: 'Active', className: 'active' };
    }
  };

  // Chart Color Gradients
  const PIE_COLORS = ['#38bdf8', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#64748b'];

  if (!mounted) return null;

  // Handle Login submission form
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await response.json();
      if (data.success) {
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        if (data.token) {
          localStorage.setItem('token', data.token);
        }
        setCurrentUser(data.user);
        setUsernameInput('');
        setPasswordInput('');
      } else {
        setLoginError(data.error || 'Invalid credentials');
      }
    } catch (err) {
      setLoginError('Network error. Failed to authenticate.');
    } finally {
      setLoginLoading(false);
    }
  };

  if (!currentUser) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-app)',
        padding: '20px',
        fontFamily: 'var(--font-body)'
      }}>
        <div className="card" style={{
          maxWidth: '440px',
          width: '100%',
          padding: '40px 32px',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-lg)',
          background: 'var(--glass-bg)',
          backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: 'var(--primary-glow)',
              color: 'var(--primary)',
              marginBottom: '16px'
            }}>
              <Inbox size={28} />
            </div>
            <h1 style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '8px', fontFamily: 'var(--font-heading)' }}>
              Welcome to TenderPocket
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Sign in to manage your tender workspace
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {loginError && (
              <div style={{
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: 'var(--accent-red)',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <AlertCircle size={16} />
                <span>{loginError}</span>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Username</label>
              <input
                type="text"
                required
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
                placeholder="Enter username"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Password</label>
              <input
                type="password"
                required
                value={passwordInput}
                onChange={e => setPasswordInput(e.target.value)}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-app)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none'
                }}
                placeholder="Enter password"
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '12px',
                justifyContent: 'center',
                fontWeight: '600',
                marginTop: '10px'
              }}
            >
              {loginLoading ? <Loader2 className="animate-spin" size={16} /> : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Compute stats for overview cards
  const totalTenders = analytics?.metrics?.totalTenders || 0;
  const issuedTenders = analytics?.metrics?.issuedCount || 0;
  const participatingTenders = analytics?.metrics?.participatingCount || 0;
  const notParticipatingTenders = analytics?.metrics?.notParticipatingCount || 0;
  const lapsedTenders = analytics?.metrics?.lapsedCount || 0;
  
  const t2_3DaysCount = analytics?.metrics?.t2_3DaysCount || 0;
  const t2TodayCount = analytics?.metrics?.t2TodayCount || 0;
  
  const filedTenders = analytics?.metrics?.filedCount || 0;
  const awardedTenders = analytics?.metrics?.awardedCount || 0;
  const notAwardedTenders = analytics?.metrics?.notAwardedCount || 0;
  
  const nonSubmissionLossTenders = analytics?.metrics?.nonSubmissionLossCount || 0;
  const nonParticipationLossTenders = analytics?.metrics?.nonParticipationLossCount || 0;

  const specTotalCount = analytics?.metrics?.specTotalCount ?? tenders.length;
  const specPendingCount = analytics?.metrics?.specPendingCount ?? tenders.filter((t: any) => t.spec_verification_status === 'Pending').length;
  const specApprovedCount = analytics?.metrics?.specApprovedCount ?? tenders.filter((t: any) => t.spec_verification_status === 'Approved').length;
  const specRejectedCount = analytics?.metrics?.specRejectedCount ?? tenders.filter((t: any) => t.spec_verification_status === 'Rejected').length;

  const processedEmails = analytics?.metrics?.totalEmails || 0;

  const assignedTenders = allAssignedTenders;

  // Grouping helper by executive
  const assignmentsByExecutive: Record<string, typeof tenders> = {};
  // Grouping helper by assigner
  const assignmentsByAssigner: Record<string, typeof tenders> = {};
  
  let staleCount = 0;
  const assignerCounts: Record<string, number> = {};

  assignedTenders.forEach(t => {
    // Executive grouping
    const exec = t.mis_executive || 'Unassigned';
    if (!assignmentsByExecutive[exec]) {
      assignmentsByExecutive[exec] = [];
    }
    assignmentsByExecutive[exec].push(t);

    // Assigner grouping
    const assigner = t.assigned_by || 'System/Default';
    if (!assignmentsByAssigner[assigner]) {
      assignmentsByAssigner[assigner] = [];
    }
    assignmentsByAssigner[assigner].push(t);

    // Count assigner totals
    assignerCounts[assigner] = (assignerCounts[assigner] || 0) + 1;

    // Check staleness (Assigned more than 3 days ago and status is 'New')
    if (t.status === 'New' && t.assigned_at) {
      const assignedDate = new Date(t.assigned_at);
      const diffTime = Math.abs(new Date().getTime() - assignedDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays > 3) {
        staleCount++;
      }
    }
  });

  // Find top assigner
  let topAssigner = 'None';
  let maxAssignments = 0;
  Object.entries(assignerCounts).forEach(([assigner, count]) => {
    if (count > maxAssignments) {
      maxAssignments = count;
      topAssigner = assigner;
    }
  });

  const isAssignmentStale = (tender: any) => {
    if (tender.status !== 'New' || !tender.assigned_at) return false;
    const assignedDate = new Date(tender.assigned_at);
    const diffTime = Math.abs(new Date().getTime() - assignedDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 3;
  };

  const resolveClientTenderStatus = (t: any) => {
    // Get IST date variables for dynamic status resolution (same as backend)
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-IN', options as any);
    const parts = formatter.formatToParts(new Date());
    const day = parts.find(p => p.type === 'day')?.value || '01';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const year = parts.find(p => p.type === 'year')?.value || '2026';
    const todayIST = `${year}-${month}-${day}`;

    const isLapsed = (publishDateStr: string | null | undefined, todayISTStr: string): boolean => {
      if (!publishDateStr || publishDateStr === 'N/A') return false;
      const date = new Date(publishDateStr);
      if (isNaN(date.getTime())) return false;
      
      const today = new Date(todayISTStr + 'T00:00:00+05:30');
      const publishDate = new Date(date);
      publishDate.setHours(0,0,0,0);
      
      const diffTime = today.getTime() - publishDate.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      return diffDays > 3;
    };

    const hasPassedDueDate = t.due_date && t.due_date < todayIST;

    if (t.status === 'Awarded') return 'won';
    if (t.status === 'Not Awarded') return 'lost';
    if (t.status === 'Filed') return 'submitted';

    if (hasPassedDueDate) {
      if (t.status === 'Not Participating') {
        return 'missed';
      }
      if (t.status === 'Issued' || t.status === 'Participating' || !t.status) {
        return 'missed';
      }
    }

    if (t.status === 'Not Participating') return 'rejected';
    if (t.status === 'Participating') return 'inProgress';

    if (isLapsed(t.publish_date, todayIST)) {
      return 'missed';
    }
    return 'live';
  };

  return (
    <div className="dashboard-container">
      {/* SVG Definitions for custom gradients */}
      <svg width="0" height="0">
        <defs>
          <linearGradient id="primary-grad-id" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme === 'dark' ? '#818cf8' : '#6366f1'} />
            <stop offset="100%" stopColor={theme === 'dark' ? '#6366f1' : '#4f46e5'} />
          </linearGradient>
        </defs>
      </svg>

      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Inbox size={24} />
          <span>TenderPocket</span>
        </div>

        <nav className="sidebar-menu">
          <button 
            className={`menu-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Layers size={18} />
            <span>Dashboard</span>
          </button>
          <button 
            className={`menu-item ${activeTab === 'tenders' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter('');
              setSearchQuery('');
              setLocationFilter('');
              setSectorFilter('');
              setMisExecutiveFilter('');
              setActiveTab('tenders');
            }}
          >
            <FileText size={18} />
            <span>All Tenders</span>
          </button>
          {currentUser.role === 'Admin' && (
            <button 
              className={`menu-item ${activeTab === 'team' ? 'active' : ''}`}
              onClick={() => setActiveTab('team')}
            >
              <Users size={18} />
              <span>Team Profiles</span>
            </button>
          )}

          {(currentUser.role === 'Admin' || currentUser.role === 'MIS Team') && (
            <button 
              className={`menu-item ${activeTab === 'work-summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('work-summary')}
            >
              <Briefcase size={18} />
              <span>Work Summary</span>
            </button>
          )}

          <button 
            className={`menu-item ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <TrendingUp size={18} />
            <span>Visual Analytics</span>
          </button>

          {currentUser.role === 'Admin' && (
            <button 
              className={`menu-item ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              <History size={18} />
              <span>Activity Logs</span>
            </button>
          )}

          <button 
            className={`menu-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'bold' }}>LOGGED IN AS</div>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)', textTransform: 'capitalize' }}>{currentUser.username}</div>
            <div style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: '600' }}>{currentUser.role}</div>
          </div>
          <button className="theme-toggle-btn" onClick={toggleTheme}>
            {theme === 'dark' ? (
              <>
                <Sun size={16} />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon size={16} />
                <span>Dark Mode</span>
              </>
            )}
          </button>
          <button className="btn" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)', border: '1px solid rgba(239, 68, 68, 0.2)', width: '100%', justifyContent: 'center', gap: '8px', padding: '10px' }} onClick={handleLogout}>
            <XCircle size={16} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="main-content">
        <header className="content-header">
          <div className="header-title-area">
            <h1>
              {activeTab === 'dashboard' && 'Control Desk'}
              {activeTab === 'tenders' && 'Tender Repositories'}
              {activeTab === 'analytics' && 'Tender Analytics'}
              {activeTab === 'settings' && 'Platform Settings'}
              {activeTab === 'audit' && 'System Activity Log'}
              {activeTab === 'team' && 'Team Management'}
              {activeTab === 'work-summary' && 'Work Summary'}
            </h1>
            <p className="page-subtitle">
              {activeTab === 'dashboard' && 'Real-time overview of active bids, alerts, and deadline schedules.'}
              {activeTab === 'tenders' && 'Search, filter, and modify status for all parsed tenders.'}
              {activeTab === 'analytics' && 'Distribution of bids by value brackets, regions, and authorities.'}
              {activeTab === 'settings' && 'Manage connections, SQLite configurations, and database options.'}
              {activeTab === 'audit' && 'Chronological audit trail of all actions performed by MIS Team and MIS Executives.'}
              {activeTab === 'team' && 'Create and manage account profiles for MIS Team and MIS Executives.'}
              {activeTab === 'work-summary' && 'Executive workload statistics and active assignment mappings.'}
            </p>
          </div>

          <div className="header-actions">
            <button 
              className="btn btn-secondary btn-icon-only" 
              onClick={handleRefresh} 
              disabled={refreshing}
              title="Refresh sync"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
            {(activeTab === 'tenders' || activeTab === 'dashboard') && (
              <button className="btn btn-secondary" onClick={exportToCSV} style={{ gap: '6px' }}>
                <Download size={16} />
                <span>Export CSV</span>
              </button>
            )}
          </div>
        </header>

        {/* Global Loader */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px', flexDirection: 'column', gap: '12px' }}>
            <Loader2 className="animate-spin" size={40} style={{ color: 'var(--primary)' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Loading workspace data...</p>
          </div>
        ) : (
          <>
            {/* TAB: DASHBOARD */}
            {activeTab === 'dashboard' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Grouped Metric Sections */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {currentUser?.role === 'Specification Team' ? (
                    <div>
                      <h2 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                        Specification Verification Statuses
                      </h2>
                      <section className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                        {/* All Tenders */}
                        <div className="card metric-card" onClick={() => handleMetricCardClick('')}>
                          <div className="metric-icon-box total">
                            <FileText size={24} />
                          </div>
                          <div className="metric-info">
                            <h3>All Tenders</h3>
                            <div className="metric-number">{specTotalCount}</div>
                            <div className="metric-trend">Total assigned for specification review</div>
                          </div>
                        </div>

                        {/* Pending */}
                        <div className="card metric-card" onClick={() => handleMetricCardClick('Pending')} style={{ borderLeft: '3px solid var(--accent-yellow)' }}>
                          <div className="metric-icon-box" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--accent-yellow)' }}>
                            <Clock size={24} />
                          </div>
                          <div className="metric-info">
                            <h3>Pending</h3>
                            <div className="metric-number">{specPendingCount}</div>
                            <div className="metric-trend">Awaiting technical verification</div>
                          </div>
                        </div>

                        {/* Approved */}
                        <div className="card metric-card" onClick={() => handleMetricCardClick('Approved')} style={{ borderLeft: '3px solid var(--accent-green)' }}>
                          <div className="metric-icon-box" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-green)' }}>
                            <CheckCircle2 size={24} />
                          </div>
                          <div className="metric-info">
                            <h3>Approved</h3>
                            <div className="metric-number">{specApprovedCount}</div>
                            <div className="metric-trend">Verified & approved specifications</div>
                          </div>
                        </div>

                        {/* Rejected */}
                        <div className="card metric-card" onClick={() => handleMetricCardClick('Rejected')} style={{ borderLeft: '3px solid var(--accent-red)' }}>
                          <div className="metric-icon-box" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)' }}>
                            <XCircle size={24} />
                          </div>
                          <div className="metric-info">
                            <h3>Rejected</h3>
                            <div className="metric-number">{specRejectedCount}</div>
                            <div className="metric-trend">Rejected specification review</div>
                          </div>
                        </div>
                      </section>
                    </div>
                  ) : (
                    <>
                      {/* Section 1: Screening & Pipeline */}
                      <div>
                        <h2 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                          Screening & Pipeline
                        </h2>
                        <section className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                          {/* Total Tenders */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('')}>
                            <div className="metric-icon-box total">
                              <FileText size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Total Tenders</h3>
                              <div className="metric-number">{totalTenders}</div>
                              <div className="metric-trend">From {processedEmails} parsed emails</div>
                            </div>
                          </div>

                          {/* Issued */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('New')}>
                            <div className="metric-icon-box new">
                              <Inbox size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>New</h3>
                              <div className="metric-number">{issuedTenders}</div>
                              <div className="metric-trend">Daily alerts to screen</div>
                            </div>
                          </div>

                          {/* Lapsed (Unreviewed) */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Lapsed')} style={{ borderLeft: '3px solid var(--accent-red)' }}>
                            <div className="metric-icon-box" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)' }}>
                              <Clock size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Lapsed</h3>
                              <div className="metric-number">{lapsedTenders}</div>
                              <div className="metric-trend">Unreviewed for 3+ days</div>
                            </div>
                          </div>

                          {/* Participating */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Participating')}>
                            <div className="metric-icon-box review" style={{ backgroundColor: 'rgba(99, 102, 241, 0.1)', color: 'var(--primary)' }}>
                              <CheckCircle2 size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Participating</h3>
                              <div className="metric-number">{participatingTenders}</div>
                              <div className="metric-trend">Accepted bids in prep</div>
                            </div>
                          </div>

                          {/* Not Participating */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Not Participating')}>
                            <div className="metric-icon-box rejected">
                              <Trash2 size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Not Participating</h3>
                              <div className="metric-number">{notParticipatingTenders}</div>
                              <div className="metric-trend">Rejected & archived bids</div>
                            </div>
                          </div>
                        </section>
                      </div>

                      {/* Section 2: Deadlines & Urgency */}
                      <div>
                        <h2 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                          Deadlines & Urgency
                        </h2>
                        <section className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                          {/* Due Today (T2) */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('T2')} style={{ borderLeft: '3px solid var(--accent-red)' }}>
                            <div className="metric-icon-box" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)' }}>
                              <AlertOctagon size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Due Today (T2)</h3>
                              <div className="metric-number">{t2TodayCount}</div>
                              <div className="metric-trend">Closing today (active only)</div>
                            </div>
                          </div>

                          {/* Due in 3 Days (T2-3) */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('T2-3 days')} style={{ borderLeft: '3px solid var(--accent-yellow)' }}>
                            <div className="metric-icon-box" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--accent-yellow)' }}>
                              <AlertTriangle size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Due in 3 Days (T2-3)</h3>
                              <div className="metric-number">{t2_3DaysCount}</div>
                              <div className="metric-trend">Closing soon (active only)</div>
                            </div>
                          </div>
                        </section>
                      </div>

                      {/* Section 3: Outcomes & Submissions */}
                      <div>
                        <h2 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                          Outcomes & Submissions
                        </h2>
                        <section className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                          {/* Filed */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Submitted')}>
                            <div className="metric-icon-box review" style={{ backgroundColor: 'rgba(52, 211, 153, 0.1)', color: 'var(--accent-green)' }}>
                              <CheckCircle2 size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Submitted</h3>
                              <div className="metric-number">{filedTenders}</div>
                              <div className="metric-trend">Submitted bids</div>
                            </div>
                          </div>

                          {/* Awarded */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Won')} style={{ borderLeft: '3px solid var(--accent-green)' }}>
                            <div className="metric-icon-box" style={{ backgroundColor: 'rgba(52, 211, 153, 0.15)', color: 'var(--accent-green)' }}>
                              <TrendingUp size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Won</h3>
                              <div className="metric-number">{awardedTenders}</div>
                              <div className="metric-trend">Manually marked won</div>
                            </div>
                          </div>

                          {/* Not Awarded */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Lost')}>
                            <div className="metric-icon-box" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)' }}>
                              <X size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Lost</h3>
                              <div className="metric-number">{notAwardedTenders}</div>
                              <div className="metric-trend">Manually marked lost</div>
                            </div>
                          </div>
                        </section>
                      </div>

                      {/* Section 4: Business Loss (Due Date Over) */}
                      <div>
                        <h2 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>
                          Business Loss (Due Date Over)
                        </h2>
                        <section className="metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
                          {/* Non-Submission Loss */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Missed Deadline')} style={{ borderLeft: '3px solid var(--accent-red)' }}>
                            <div className="metric-icon-box" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-red)' }}>
                              <XCircle size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Missed Deadline</h3>
                              <div className="metric-number">{nonSubmissionLossTenders}</div>
                              <div className="metric-trend">Issued/Participating past due date</div>
                            </div>
                          </div>

                          {/* Non-Participation Loss */}
                          <div className="card metric-card" onClick={() => handleMetricCardClick('Missed Opportunity')} style={{ borderLeft: '3px solid var(--text-muted)' }}>
                            <div className="metric-icon-box" style={{ backgroundColor: 'rgba(148, 163, 184, 0.1)', color: 'var(--text-muted)' }}>
                              <MinusCircle size={24} />
                            </div>
                            <div className="metric-info">
                              <h3>Missed Opportunity</h3>
                              <div className="metric-number">{nonParticipationLossTenders}</div>
                              <div className="metric-trend">Not Participating past due date</div>
                            </div>
                          </div>
                        </section>
                      </div>
                    </>
                  )}
                </div>

                <div className="dashboard-grid">
                  {/* Recent Tenders Panel */}
                  <section className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: '450px' }}>
                    <div className="section-title-area">
                      <h2 className="section-title">
                        Latest Tender Alerts
                        <span>{tenders.slice(0, 5).length} shown</span>
                      </h2>
                      <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => setActiveTab('tenders')}>
                        View All
                      </button>
                    </div>

                    {tenders.length === 0 ? (
                      <div className="empty-state" style={{ flexGrow: 1 }}>
                        <Mail size={48} />
                        <h3>No Tenders Found</h3>
                        <p>Paste or upload your first email digest from Tender247 to begin tracking.</p>
                      </div>
                    ) : (
                      <div className="tender-list-container" style={{ maxHeight: '420px' }}>
                        {tenders.slice(0, 5).map(tender => (
                          <div key={tender.id} onClick={() => openTenderDetails(tender)} className="tender-item" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', cursor: 'pointer' }}>
                            <div className="tender-item-left">
                              <div className="tender-meta-row">
                                <span className="tender-id-badge">{tender.id}</span>
                                <span className={`tender-status-badge ${tender.status.toLowerCase().replace(/\s+/g, '-')}`}>{tender.status}</span>
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: '600',
                                  padding: '2px 6px',
                                  borderRadius: '6px',
                                  backgroundColor: tender.source === 'GeM' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                  color: tender.source === 'GeM' ? '#10b981' : '#3b82f6',
                                  border: '1px solid ' + (tender.source === 'GeM' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)')
                                }}>
                                  {tender.source === 'GeM' ? 'GeM Portal' : 'Tender247 Portal'}
                                </span>
                                {tender.location && <span className="tender-authority">📍 {tender.location}</span>}
                              </div>
                              <h4 className="tender-title" title={tender.title}>{tender.product_name_as_per_tender || tender.title}</h4>
                              <div className="tender-details-row">
                                {tender.authority && (
                                  <div className="tender-detail-item">
                                    <Building size={14} />
                                    <span>{tender.authority}</span>
                                  </div>
                                )}
                                {tender.sector && (
                                  <div className="tender-detail-item">
                                    <Layers size={14} />
                                    <span>{tender.sector}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="tender-item-right">
                              <div className="tender-cost">{formatCost(tender.estimated_cost, tender.estimated_cost_raw)}</div>
                              <div className={`tender-deadline ${getDeadlineStatus(tender.due_date).className}`}>
                                {getDeadlineStatus(tender.due_date).label}: {formatDate(tender.due_date)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Quick Stats / Deadline calendar */}
                  <section style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="card" style={{ flexGrow: 1 }}>
                      <h2 className="section-title" style={{ marginBottom: '16px' }}>Upcoming Deadlines</h2>
                      {analytics?.deadlines?.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                          No deadlines scheduled in the next 30 days.
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {analytics?.deadlines?.slice(0, 4).map((d: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', borderRadius: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)', alignItems: 'center' }}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '13px', fontWeight: '600' }}>{formatDate(d.due_date)}</span>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{d.count} tender{d.count > 1 ? 's' : ''} closing</span>
                              </div>
                              <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                backgroundColor: isClosingSoon(d.due_date) ? 'var(--accent-red)' : 'var(--accent-yellow)'
                              }} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="card">
                      <h2 className="section-title" style={{ marginBottom: '16px' }}>System Sync</h2>
                      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                        Synchronize the platform with the latest Tender247 emails and GeM portal bids immediately.
                      </p>
                      <button 
                        className="btn btn-primary" 
                        style={{ width: '100%', justifyContent: 'center', gap: '8px' }} 
                        onClick={handleRefresh} 
                        disabled={refreshing}
                      >
                        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                        <span>{refreshing ? 'Syncing...' : 'Sync Tenders Now'}</span>
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* TAB: ALL TENDERS */}
            {activeTab === 'tenders' && (
              <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: '600px' }}>
                {/* Advanced Search & Filtering Controls */}
                <div className="controls-bar">
                  <div className="search-input-wrapper">
                    <Search size={18} />
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Search by Title, ID, Authority, Ref No..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>

                  <select 
                    className="filter-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    {currentUser?.role === 'Specification Team' ? (
                      <>
                        <option value="">All Tenders</option>
                        <option value="Pending">Pending</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                      </>
                    ) : (
                      <>
                        <option value="">All Statuses</option>
                        <option value="New">New</option>
                        <option value="Participating">Participating</option>
                        <option value="Not Participating">Not Participating</option>
                        <option value="Lapsed">Lapsed</option>
                        <option value="T2">Due Today (T2)</option>
                        <option value="T2-3 days">Due in 3 Days (T2-3)</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Won">Won</option>
                        <option value="Lost">Lost</option>
                        <option value="Missed Deadline">Missed Deadline</option>
                        <option value="Missed Opportunity">Missed Opportunity</option>
                        <option value="Missed">All Missed</option>
                      </>
                    )}
                  </select>

                  {(currentUser.role === 'Admin' || currentUser.role === 'MIS Team') && (
                    <select
                      className="filter-select"
                      value={misExecutiveFilter}
                      onChange={(e) => setMisExecutiveFilter(e.target.value)}
                    >
                      <option value="">All Executives</option>
                      {executives.map((exec) => (
                        <option key={exec} value={exec}>{exec}</option>
                      ))}
                    </select>
                  )}

                  <select
                    className="filter-select"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  >
                    <option value="">All Locations</option>
                    {filters.locations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>

                  <select
                    className="filter-select"
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value)}
                  >
                    <option value="">All Sectors</option>
                    {filters.sectors.map((sec) => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>

                  <select
                    className="filter-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="scraped_at">Scraped Date</option>
                    <option value="due_date">Due Date</option>
                    <option value="estimated_cost">Tender Value</option>
                  </select>

                  <button 
                    className="btn btn-secondary" 
                    style={{ padding: '10px' }}
                    onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  >
                    {sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                  </button>

                  <button 
                    className={`btn ${corrigendumFilter ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '10px 14px', background: corrigendumFilter ? 'var(--accent-red)' : 'transparent', color: corrigendumFilter ? '#fff' : 'var(--text-primary)', border: corrigendumFilter ? '1px solid var(--accent-red)' : '1px solid var(--border-color)' }}
                    onClick={() => setCorrigendumFilter(prev => !prev)}
                  >
                    <span>Corrigendum Alerts Only</span>
                  </button>

                  <button 
                    className="btn btn-primary"
                    style={{ padding: '10px 14px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', color: '#fff' }}
                    onClick={exportToCSV}
                  >
                    <Download size={16} />
                    <span>Export to CSV</span>
                  </button>
                </div>

                {(() => {
                  const displayedTenders = corrigendumFilter 
                    ? tenders.filter(t => t.corrigendum_remark === 'Yes' || (t.notes && t.notes.toLowerCase().includes('corrigendum')))
                    : tenders;

                  if (displayedTenders.length === 0) {
                    return (
                      <div className="empty-state" style={{ flexGrow: 1 }}>
                        <SlidersHorizontal size={48} />
                        <h3>No Matching Tenders</h3>
                        <p>Try adjusting your search criteria or filters to locate tenders.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="tender-list-container" style={{ maxHeight: '600px' }}>
                      {displayedTenders.map(tender => (
                        <div key={tender.id} onClick={() => openTenderDetails(tender)} className="tender-item" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', cursor: 'pointer' }}>
                        <div className="tender-item-left">
                          <div className="tender-meta-row">
                            <span className="tender-id-badge">{tender.id}</span>
                            {currentUser?.role === 'Specification Team' ? (
                              <span style={{
                                fontSize: '11px',
                                fontWeight: '700',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                backgroundColor: tender.spec_verification_status === 'Approved' ? 'rgba(16, 185, 129, 0.15)' : tender.spec_verification_status === 'Pending' ? 'rgba(245, 158, 11, 0.15)' : tender.spec_verification_status === 'Rejected' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                color: tender.spec_verification_status === 'Approved' ? '#10b981' : tender.spec_verification_status === 'Pending' ? '#f59e0b' : tender.spec_verification_status === 'Rejected' ? '#ef4444' : 'var(--text-muted)',
                                border: '1px solid ' + (tender.spec_verification_status === 'Approved' ? 'rgba(16, 185, 129, 0.3)' : tender.spec_verification_status === 'Pending' ? 'rgba(245, 158, 11, 0.3)' : tender.spec_verification_status === 'Rejected' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.1)')
                              }}>
                                {tender.spec_verification_status === 'Pending' ? 'Pending' : (tender.spec_verification_status || 'Not Started')}
                              </span>
                            ) : (
                              <span className={`tender-status-badge ${tender.status.toLowerCase().replace(/\s+/g, '-')}`}>{tender.status}</span>
                            )}
                            <span style={{
                              fontSize: '10px',
                              fontWeight: '600',
                              padding: '2px 6px',
                              borderRadius: '6px',
                              backgroundColor: tender.source === 'GeM' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                              color: tender.source === 'GeM' ? '#10b981' : '#3b82f6',
                              border: '1px solid ' + (tender.source === 'GeM' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)')
                            }}>
                              {tender.source === 'GeM' ? 'GeM Portal' : 'Tender247 Portal'}
                            </span>
                            {tender.location && <span className="tender-authority">📍 {tender.location}</span>}
                            {tender.ref_no && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ref: {tender.ref_no}</span>}
                          </div>
                          <h4 className="tender-title" title={tender.title}>{tender.product_name_as_per_tender || tender.title}</h4>
                          <div className="tender-details-row">
                            {tender.authority && (
                              <div className="tender-detail-item">
                                <Building size={14} />
                                <span>{tender.authority}</span>
                              </div>
                            )}
                            {tender.sector && (
                              <div className="tender-detail-item">
                                <Layers size={14} />
                                <span>{tender.sector}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="tender-item-right">
                          <div className="tender-cost">{formatCost(tender.estimated_cost, tender.estimated_cost_raw)}</div>
                          <div className={`tender-deadline ${getDeadlineStatus(tender.due_date).className}`}>
                            {getDeadlineStatus(tender.due_date).label}: {formatDate(tender.due_date)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

            {/* TAB: VISUAL ANALYTICS */}
            {activeTab === 'analytics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* Analytics KPI Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                  {/* Card 1: Total Opportunities */}
                  <div className="card" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.02)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(99, 102, 241, 0.1)', color: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <FileText size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Opportunities</div>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '2px' }}>
                        {analytics?.metrics?.totalTenders || 0}
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Estimated Pipeline Value */}
                  <div className="card" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.02)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TrendingUp size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Pipeline Value</div>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '2px', fontFamily: 'var(--font-heading)' }}>
                        {formatCost(analytics?.metrics?.status?.reduce((acc: number, curr: any) => acc + (curr.total_val || 0), 0) || 0, '')}
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Success Conversion Rate */}
                  <div className="card" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.02)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Activity size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Win Conversion Rate</div>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '2px' }}>
                        {(() => {
                          const won = analytics?.metrics?.awardedCount || 0;
                          const lost = analytics?.metrics?.notAwardedCount || 0;
                          const total = won + lost;
                          return total > 0 ? `${((won / total) * 100).toFixed(1)}%` : '0.0%';
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Card 4: Source E-mails Parsed */}
                  <div className="card" style={{ padding: '20px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.02)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Mail size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Processed Emails</div>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '2px' }}>
                        {analytics?.metrics?.totalEmails || 0}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Charts Grid Row 1 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
                  {/* Cost Bracket distribution */}
                  <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '16px' }}>Tenders by Estimated Cost Bracket</h3>
                    <div style={{ width: '100%', height: '240px' }}>
                      {analytics?.valueBrackets ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.valueBrackets}>
                            <defs>
                              <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.8}/>
                                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.2}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="bracket" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                            <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                              labelStyle={{ color: 'var(--text-primary)', fontWeight: 'bold' }}
                            />
                            <Bar dataKey="count" fill="url(#barGrad)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <p style={{ color: 'var(--text-muted)' }}>Loading chart data...</p>
                      )}
                    </div>
                  </div>

                  {/* Process status distribution */}
                  <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '16px' }}>Tender Distribution by Process State</h3>
                    <div style={{ width: '100%', height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {analytics?.metrics?.status && analytics.metrics.status.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={analytics.metrics.status.filter((e: any) => e.count > 0)}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={4}
                              dataKey="count"
                              nameKey="status"
                            >
                              {analytics.metrics.status.filter((e: any) => e.count > 0).map((entry: any, index: number) => {
                                const stateColors: Record<string, string> = {
                                  'New': 'var(--primary)',
                                  'Participating': '#6366f1',
                                  'Not Participating': '#6b7280',
                                  'Lapsed': '#f59e0b',
                                  'Submitted': '#3b82f6',
                                  'Won': 'var(--accent-green)',
                                  'Lost': 'var(--text-secondary)',
                                  'Missed Deadline': 'var(--accent-red)',
                                  'Missed Opportunity': '#ef4444'
                                };
                                return <Cell key={`cell-${index}`} fill={stateColors[entry.status] || PIE_COLORS[index % PIE_COLORS.length]} />;
                              })}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                              itemStyle={{ color: 'var(--text-primary)' }}
                            />
                            <Legend 
                              layout="horizontal" 
                              verticalAlign="bottom" 
                              align="center"
                              iconSize={10}
                              wrapperStyle={{ fontSize: '10px', marginTop: '10px' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <p style={{ color: 'var(--text-muted)' }}>No status data available.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Charts Grid Row 2 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
                  {/* Line Chart: 30-Day Upcoming Deadlines */}
                  <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '16px' }}>Upcoming Tender Deadlines (Next 30 Days)</h3>
                    <div style={{ width: '100%', height: '240px' }}>
                      {analytics?.deadlines && analytics.deadlines.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={analytics.deadlines}>
                            <defs>
                              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis 
                              dataKey="due_date" 
                              tickFormatter={(str) => {
                                if (!str) return '';
                                const d = new Date(str);
                                return isNaN(d.getTime()) ? str : `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
                              }} 
                              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                            />
                            <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} allowDecimals={false} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', borderRadius: '8px' }}
                              labelStyle={{ color: 'var(--text-primary)', fontWeight: 'bold' }}
                            />
                            <Area type="monotone" dataKey="count" name="Tenders Due" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#areaGrad)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '13px' }}>
                          No upcoming deadlines in the next 30 days.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Top Authorities by Value */}
                  <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '16px' }}>Top Tender Authorities by Pipeline Value</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', height: '240px', overflowY: 'auto', paddingRight: '4px' }}>
                      {analytics?.authorities && analytics.authorities.length > 0 ? (
                        analytics.authorities.slice(0, 6).map((auth: any, idx: number) => (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', alignItems: 'center' }}>
                              <span style={{ fontWeight: '600', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }} title={auth.authority}>
                                {auth.authority}
                              </span>
                              <span style={{ color: 'var(--primary)', fontWeight: '700', fontFamily: 'var(--font-heading)' }}>
                                {formatCost(auth.total_val, '')}
                              </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                              <span>{auth.count} active tenders</span>
                              <span>Average: {formatCost(auth.total_val / auth.count, '')}</span>
                            </div>
                            <div style={{ width: '100%', height: '4px', borderRadius: '2px', backgroundColor: 'rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%',
                                backgroundColor: 'var(--primary)',
                                borderRadius: '2px',
                                width: `${Math.min(100, (auth.total_val / (analytics.authorities[0]?.total_val || 1)) * 100)}%`
                              }}></div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p style={{ color: 'var(--text-muted)', textAlign: 'center', margin: 'auto' }}>No authority stats available.</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Third Row: Top Sectors */}
                <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '16px' }}>Procurement Sectors Breakdown</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                    {analytics?.sectors && analytics.sectors.length > 0 ? (
                      analytics.sectors.slice(0, 6).map((sec: any, idx: number) => (
                        <div key={idx} style={{ padding: '16px', borderRadius: '8px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: '700', fontSize: '13px', color: 'var(--text-primary)' }}>{sec.sector}</span>
                            <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 6px', borderRadius: '10px', backgroundColor: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                              {sec.count} bids
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', alignItems: 'baseline' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Pipeline Value</span>
                            <span style={{ fontWeight: '800', color: 'var(--text-primary)', fontFamily: 'var(--font-heading)', fontSize: '14px' }}>
                              {formatCost(sec.total_val, '')}
                            </span>
                          </div>
                          <div style={{ width: '100%', height: '4px', borderRadius: '2px', backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              backgroundColor: '#6366f1',
                              borderRadius: '2px',
                              width: `${Math.min(100, (sec.total_val / (analytics.sectors[0]?.total_val || 1)) * 100)}%`
                            }}></div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p style={{ color: 'var(--text-muted)', textAlign: 'center', gridColumn: 'span 2' }}>No sector breakdown available.</p>
                    )}
                  </div>
                </div>

                {/* Executive Performance Statistics Row */}
                <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', marginTop: '24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)' }}>Tender Executive Performance & Activity</h3>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Filled tenders, wins, and losses over time.</p>
                    </div>
                    {/* Time Range Selector & Filter */}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {currentUser?.role !== 'MIS Executive' && (
                        <>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Executive:</span>
                          <select 
                            className="form-select" 
                            value={misExecutiveFilter}
                            onChange={(e) => setMisExecutiveFilter(e.target.value)}
                            style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '8px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                          >
                            <option value="">All Executives</option>
                            {executives.map(exec => (
                              <option key={exec} value={exec}>{exec}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>

                  {currentUser?.role === 'MIS Executive' ?
                    // Self-Performance Dashboard
                    (() => {
                      const selfStat = execStats.find(s => s.executive === currentUser.username) || {
                        executive: currentUser.username,
                        last7Days: 0,
                        last30Days: 0,
                        last365Days: 0,
                        totalWon: 0,
                        totalLost: 0
                      };

                      const selfChartData = [
                        { name: 'Last 7 Days', Filled: selfStat.last7Days },
                        { name: 'Last 30 Days', Filled: selfStat.last30Days },
                        { name: 'Last Year', Filled: selfStat.last365Days }
                      ];

                      const outcomeData = [
                        { name: 'Bids Won', value: selfStat.totalWon, color: 'var(--accent-green)' },
                        { name: 'Bids Lost', value: selfStat.totalLost, color: 'var(--text-secondary)' }
                      ];

                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>
                          <div>
                            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Submissions (Filled Tenders)</h4>
                            <div style={{ width: '100%', height: '200px' }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={selfChartData}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                  <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                                  <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} allowDecimals={false} />
                                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', borderRadius: '8px' }} />
                                  <Bar dataKey="Filled" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                          <div>
                            <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Won / Lost Outcomes</h4>
                            <div style={{ width: '100%', height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {selfStat.totalWon + selfStat.totalLost > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                    <Pie
                                      data={outcomeData.filter(d => d.value > 0)}
                                      cx="50%"
                                      cy="50%"
                                      innerRadius={50}
                                      outerRadius={70}
                                      paddingAngle={4}
                                      dataKey="value"
                                      nameKey="name"
                                    >
                                      {outcomeData.filter(d => d.value > 0).map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                      ))}
                                    </Pie>
                                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', borderRadius: '8px' }} />
                                    <Legend layout="horizontal" verticalAlign="bottom" align="center" iconSize={10} wrapperStyle={{ fontSize: '10px' }} />
                                  </PieChart>
                                </ResponsiveContainer>
                              ) : (
                                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No outcome statistics recorded yet.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  :
                    // Admin & MIS Team Executive Comparison
                    (() => {
                      const filteredStats = misExecutiveFilter
                        ? execStats.filter(s => s.executive === misExecutiveFilter)
                        : execStats;

                      const comparisonData = filteredStats.map(s => ({
                        name: s.executive,
                        '7 Days': s.last7Days,
                        '30 Days': s.last30Days,
                        '365 Days': s.last365Days
                      }));

                      return (
                        <div style={{ width: '100%', height: '280px' }}>
                          {comparisonData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={comparisonData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} allowDecimals={false} />
                                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', borderRadius: '8px' }} />
                                <Legend wrapperStyle={{ fontSize: '12px', marginTop: '10px' }} />
                                <Bar dataKey="7 Days" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="30 Days" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="365 Days" fill="var(--accent-green)" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '13px' }}>
                              No executive activity stats compiled yet.
                            </div>
                          )}
                        </div>
                      );
                    })()
                  }
                </div>

                {/* Spreadsheet Style Tender Submitted Report Card */}
                {currentUser?.role !== 'MIS Executive' && (
                  <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', marginTop: '24px', overflowX: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '800', color: 'var(--text-primary)' }}>Tender Submitted Report Sheet</h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>Excel-style summary of filed tenders and values by executive.</p>
                      </div>
                    </div>
                    <div style={{ minWidth: '600px', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                          {/* Title Banner */}
                          <tr>
                            <th colSpan={4} style={{
                              padding: '12px',
                              borderBottom: '1px solid var(--border-color)',
                              backgroundColor: theme === 'dark' ? '#b87c4c' : '#ffd3b6',
                              color: theme === 'dark' ? '#ffffff' : '#000000',
                              fontWeight: 'bold',
                              textAlign: 'center',
                              fontSize: '15px'
                            }}>
                              Tender Submitted Report Date: {(() => {
                                const d = new Date();
                                return d.toLocaleDateString('en-IN', {
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric',
                                  timeZone: 'Asia/Kolkata'
                                });
                              })()}
                            </th>
                          </tr>
                          {/* Column Headers */}
                          <tr style={{
                            backgroundColor: theme === 'dark' ? '#3d3028' : '#ffe5d9',
                            color: theme === 'dark' ? '#ffd3b6' : '#5c3d2e',
                            fontWeight: 'bold',
                            textAlign: 'center'
                          }}>
                            <th style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', width: '80px', textAlign: 'center' }}>Sr No.</th>
                            <th style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'left' }}>Executive Names</th>
                            <th style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', width: '220px', textAlign: 'center' }}>Submitted Tenders Till Date</th>
                            <th style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', width: '240px', textAlign: 'right' }}>Total Values of Submitted Tenders</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Data Rows */}
                          {(() => {
                            const rows: React.ReactNode[] = [];
                            let srNo = 1;

                            // 1. Group Roshan/Aayush
                            const roshanStat = execStats.find(s => s.executive.toLowerCase() === 'roshan');
                            const aayushStat = execStats.find(s => s.executive.toLowerCase() === 'aayush');
                            
                            if (roshanStat || aayushStat) {
                              const combinedVal = (roshanStat?.submittedValue || 0) + (aayushStat?.submittedValue || 0);
                              rows.push(
                                <tr key="group-roshan-aayush" style={{
                                  backgroundColor: theme === 'dark' ? 'rgba(59, 130, 246, 0.15)' : '#bbd0ff',
                                  color: theme === 'dark' ? '#93c5fd' : '#000000',
                                  fontWeight: 'bold'
                                }}>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'center' }}>{srNo++}</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)' }}>Roshan/Aayush</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'center' }}>Target Completed as Per Value</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: 'bold' }}>
                                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(combinedVal)}
                                  </td>
                                </tr>
                              );
                            }

                            // 2. Other Executives
                            const otherExecs = execStats.filter(s => {
                              const name = s.executive.toLowerCase();
                              return name !== 'roshan' && name !== 'aayush' && name !== 'admin' && name !== 'misteam';
                            });

                            // Sort other execs by count descending
                            const sortedOther = [...otherExecs].sort((a, b) => (b.submittedCount || 0) - (a.submittedCount || 0));

                            sortedOther.forEach(exec => {
                              const count = exec.submittedCount || 0;
                              const value = exec.submittedValue || 0;
                              const isCompleted = count >= 36;
                              
                              // Colors: Green if count >= 36, Yellow otherwise
                              const bgColor = isCompleted
                                ? (theme === 'dark' ? 'rgba(16, 185, 129, 0.12)' : '#e2f0d9')
                                : (theme === 'dark' ? 'rgba(245, 158, 11, 0.12)' : '#fff2cc');
                              
                              const textColor = isCompleted
                                ? (theme === 'dark' ? '#34d399' : '#000000')
                                : (theme === 'dark' ? '#fbbf24' : '#000000');

                              rows.push(
                                <tr key={`exec-${exec.executive}`} style={{ backgroundColor: bgColor, color: textColor }}>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'center' }}>{srNo++}</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', fontWeight: '500' }}>{exec.executive}</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'center', fontWeight: '600' }}>{count}</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', textAlign: 'right', fontFamily: 'Courier New, monospace' }}>
                                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}
                                  </td>
                                </tr>
                              );
                            });

                            // 3. Sub-rows (breakdown of Aayush / Roshan)
                            if (aayushStat) {
                              rows.push(
                                <tr key="sub-aayush" style={{
                                  backgroundColor: theme === 'dark' ? 'rgba(59, 130, 246, 0.06)' : '#e8f1f2',
                                  color: theme === 'dark' ? 'var(--text-secondary)' : '#000000',
                                  fontSize: '12px'
                                }}>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)' }}></td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', paddingLeft: '24px', fontStyle: 'italic' }}>Aayush</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'center' }}>{aayushStat.submittedCount || 0}</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', textAlign: 'right', fontFamily: 'Courier New, monospace' }}>
                                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(aayushStat.submittedValue || 0)}
                                  </td>
                                </tr>
                              );
                            }

                            if (roshanStat) {
                              rows.push(
                                <tr key="sub-roshan" style={{
                                  backgroundColor: theme === 'dark' ? 'rgba(59, 130, 246, 0.06)' : '#e8f1f2',
                                  color: theme === 'dark' ? 'var(--text-secondary)' : '#000000',
                                  fontSize: '12px'
                                }}>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)' }}></td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', paddingLeft: '24px', fontStyle: 'italic' }}>Roshan</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', textAlign: 'center' }}>{roshanStat.submittedCount || 0}</td>
                                  <td style={{ padding: '10px', borderBottom: '1px solid var(--border-color)', textAlign: 'right', fontFamily: 'Courier New, monospace' }}>
                                    {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(roshanStat.submittedValue || 0)}
                                  </td>
                                </tr>
                              );
                            }

                            // 4. Total Submitted Row
                            const totalCount = execStats.reduce((acc, curr) => acc + (curr.submittedCount || 0), 0);
                            const totalValue = execStats.reduce((acc, curr) => acc + (curr.submittedValue || 0), 0);

                            rows.push(
                              <tr key="total-submitted" style={{
                                backgroundColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : '#e9ecef',
                                color: theme === 'dark' ? 'var(--text-primary)' : '#000000',
                                fontWeight: 'bold'
                              }}>
                                <td style={{ padding: '10px', borderRight: '1px solid var(--border-color)' }}></td>
                                <td style={{ padding: '10px', borderRight: '1px solid var(--border-color)' }}>Total Submitted</td>
                                <td style={{ padding: '10px', borderRight: '1px solid var(--border-color)', textAlign: 'center' }}>{totalCount}</td>
                                <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'Courier New, monospace', fontWeight: 'bold' }}>
                                  {new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalValue)}
                                </td>
                              </tr>
                            );

                            return rows;
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            )}



            {/* TAB: SETTINGS */}
            {activeTab === 'settings' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', margin: '0 auto' }}>
                <section className="card">
                  <h2 className="section-title" style={{ marginBottom: '16px' }}>Local Infrastructure</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>SQLite Database Path</span>
                      <span style={{ fontWeight: '600' }}>./tenders.db</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Scraper Engine</span>
                      <span style={{ fontWeight: '600' }}>Axios + Cheerio HTML Parser</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Email File Reader</span>
                      <span style={{ fontWeight: '600' }}>Mailparser (RFC 822 parsing)</span>
                    </div>
                  </div>
                </section>

                <section className="card">
                  <h2 className="section-title" style={{ marginBottom: '16px' }}>
                    <Info size={18} style={{ color: 'var(--accent-blue)' }} />
                    How to Automate Email Fetching
                  </h2>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '16px' }}>
                    To fetch emails automatically in the background, you can set up a local Node.js script using `imapflow` or `mailparser` running on a cron scheduler (e.g., `crontab` on macOS).
                  </p>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '16px' }}>
                    The cron script will run thrice a day, connect to your Gmail via an App Password, find emails from `sales@tender247.com` or `support@tender247.com`, parse the raw EML content, and push it directly to your dashboard endpoint at `http://localhost:3000/api/process-email`!
                  </p>
                  <div style={{ padding: '16px', borderRadius: '10px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border-color)' }}>
                    <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '8px', color: 'var(--primary)' }}>Sample Crontab Config:</div>
                    <code style={{ fontSize: '12px', display: 'block', wordBreak: 'break-all', fontFamily: 'Courier New, monospace' }}>
                      0 9,14,19 * * * /usr/local/bin/node /Users/anuthibhansali/.gemini/antigravity/scratch/tender-pocket/scripts/sync-emails.js
                    </code>
                  </div>
                </section>
              </div>
            )}

            {/* TAB: AUDIT LOGS */}
            {activeTab === 'audit' && currentUser?.role === 'Admin' && (() => {
              // 1. Filter logs by category and search keyword
              const filteredLogs = activityLogs.filter(log => {
                // Category Filter
                if (logFilter === 'assignments') {
                  const isAssign = log.action === 'Assigned Tender' || log.details?.toLowerCase().includes('assigned to executive');
                  if (!isAssign) return false;
                }
                
                // Search Query
                const q = logSearchQuery.toLowerCase();
                if (q) {
                  const userMatch = (log.username || '').toLowerCase().includes(q);
                  const roleMatch = (log.role || '').toLowerCase().includes(q);
                  const actionMatch = (log.action || '').toLowerCase().includes(q);
                  const detailsMatch = (log.details || '').toLowerCase().includes(q);
                  const tenderIdMatch = (log.tender_id || '').toLowerCase().includes(q);
                  const tenderTitleMatch = (log.tender_title || '').toLowerCase().includes(q);
                  return userMatch || roleMatch || actionMatch || detailsMatch || tenderIdMatch || tenderTitleMatch;
                }
                return true;
              });

              // 2. Paginate logs
              const totalLogs = filteredLogs.length;
              const totalLogPages = Math.ceil(totalLogs / logLimit) || 1;
              const startLogIndex = (logPage - 1) * logLimit;
              const paginatedLogs = filteredLogs.slice(startLogIndex, startLogIndex + logLimit);

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                  <div className="card" style={{ padding: '24px', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                      <h2 className="section-title" style={{ margin: 0 }}>System Activity Logs</h2>
                      <button className="btn btn-secondary" onClick={fetchActivityLogs} disabled={loadingLogs} style={{ gap: '6px', padding: '8px 12px', fontSize: '13px' }}>
                        <RefreshCw size={14} className={loadingLogs ? 'animate-spin' : ''} />
                        <span>Refresh Logs</span>
                      </button>
                    </div>

                    {/* Filter and Search Controls Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {/* Search Bar */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 12px', width: '280px' }}>
                          <Search size={16} style={{ color: 'var(--text-muted)' }} />
                          <input
                            type="text"
                            placeholder="Search logs (User, Action, Details)..."
                            value={logSearchQuery}
                            onChange={(e) => {
                              setLogSearchQuery(e.target.value);
                              setLogPage(1); // Reset page on search
                            }}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontSize: '13px', width: '100%' }}
                          />
                        </div>

                        {/* Log Category Filter */}
                        <select
                          value={logFilter}
                          onChange={(e) => {
                            setLogFilter(e.target.value as any);
                            setLogPage(1);
                          }}
                          style={{
                            padding: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-app)',
                            color: 'var(--text-primary)',
                            fontSize: '13px',
                            outline: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="all">All Activities</option>
                          <option value="assignments">Tender Assignments Only</option>
                        </select>
                      </div>

                      {/* Limit Selector */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <span>Show</span>
                        <select
                          value={logLimit}
                          onChange={(e) => {
                            setLogLimit(Number(e.target.value));
                            setLogPage(1);
                          }}
                          style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text-primary)', cursor: 'pointer', outline: 'none' }}
                        >
                          <option value={10}>10</option>
                          <option value={20}>20</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                        <span>entries</span>
                      </div>
                    </div>

                    {loadingLogs ? (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
                      </div>
                    ) : totalLogs === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>No activity records found matching filters.</p>
                    ) : (
                      <div>
                        {/* Chronological List of Logs */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {paginatedLogs.map((log) => {
                            const getLogIconInfo = (action: string) => {
                              const lower = (action || '').toLowerCase();
                              if (lower.includes('delete')) {
                                return {
                                  icon: <Trash2 size={16} />,
                                  bg: 'rgba(239, 68, 68, 0.1)',
                                  color: 'var(--accent-red)'
                                };
                              }
                              if (lower.includes('status')) {
                                return {
                                  icon: <CheckCircle2 size={16} />,
                                  bg: 'rgba(16, 185, 129, 0.1)',
                                  color: 'var(--accent-green)'
                                };
                              }
                              if (lower.includes('document') || lower.includes('template')) {
                                return {
                                  icon: <FileText size={16} />,
                                  bg: 'rgba(14, 165, 233, 0.1)',
                                  color: 'var(--accent-blue)'
                                };
                              }
                              if (lower.includes('assign')) {
                                return {
                                  icon: <Layers size={16} />,
                                  bg: 'rgba(139, 92, 246, 0.1)',
                                  color: 'var(--accent-purple)'
                                };
                              }
                              if (lower.includes('create') && lower.includes('user')) {
                                return {
                                  icon: <UserPlus size={16} />,
                                  bg: 'rgba(14, 165, 233, 0.1)',
                                  color: 'var(--accent-blue)'
                                };
                              }
                              if (lower.includes('update') && lower.includes('tender')) {
                                return {
                                  icon: <History size={16} />,
                                  bg: 'rgba(99, 102, 241, 0.1)',
                                  color: 'var(--primary)'
                                };
                              }
                              return {
                                icon: <Info size={16} />,
                                bg: 'rgba(99, 102, 241, 0.1)',
                                color: 'var(--primary)'
                              };
                            };

                            const iconInfo = getLogIconInfo(log.action);

                            return (
                              <div key={log.id} style={{
                                display: 'flex',
                                gap: '16px',
                                padding: '16px',
                                borderRadius: '10px',
                                background: 'rgba(255, 255, 255, 0.02)',
                                border: '1px solid var(--border-color)',
                                alignItems: 'flex-start',
                                transition: 'all var(--transition-fast)'
                              }}>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '8px',
                                  background: iconInfo.bg,
                                  color: iconInfo.color,
                                  flexShrink: 0
                                }}>
                                  {iconInfo.icon}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexGrow: 1 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ fontWeight: 'bold', fontSize: '14px', color: 'var(--text-primary)' }}>{log.username}</span>
                                      <span style={{
                                        fontSize: '10px',
                                        fontWeight: 'bold',
                                        padding: '2px 6px',
                                        borderRadius: '12px',
                                        background: log.role === 'Admin' ? 'rgba(239, 68, 68, 0.15)' : log.role === 'MIS Team' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                        color: log.role === 'Admin' ? 'var(--accent-red)' : log.role === 'MIS Team' ? 'var(--primary)' : 'var(--accent-green)',
                                        textTransform: 'uppercase'
                                      }}>{log.role}</span>
                                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: '600' }}>• {log.action}</span>
                                    </div>
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{log.timestamp}</span>
                                  </div>

                                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>{log.details}</p>

                                  {log.tender_id && (
                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tender:</span>
                                      <Link
                                        href={`/tenders/${log.tender_id}`}
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          padding: 0,
                                          color: 'var(--primary)',
                                          fontSize: '12px',
                                          fontWeight: '600',
                                          textAlign: 'left',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          textDecoration: 'underline'
                                        }}
                                      >
                                        <span>{log.tender_title || log.tender_id}</span>
                                        <ExternalLink size={10} />
                                      </Link>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Pagination Footer */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', flexWrap: 'wrap', gap: '12px' }}>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            Showing {startLogIndex + 1} to {Math.min(startLogIndex + logLimit, totalLogs)} of {totalLogs} entries
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              disabled={logPage === 1}
                              onClick={() => setLogPage(p => Math.max(p - 1, 1))}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: logPage === 1 ? 'transparent' : 'var(--bg-card)',
                                color: logPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: logPage === 1 ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <ChevronLeft size={16} />
                              <span>Prev</span>
                            </button>
                            <button
                              disabled={logPage === totalLogPages}
                              onClick={() => setLogPage(p => Math.min(p + 1, totalLogPages))}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: logPage === totalLogPages ? 'transparent' : 'var(--bg-card)',
                                color: logPage === totalLogPages ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: logPage === totalLogPages ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <span>Next</span>
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* TAB: TEAM MANAGEMENT */}
            {activeTab === 'team' && currentUser?.role === 'Admin' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
                {/* Account List */}
                <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column', height: 'fit-content' }}>
                  <h2 className="section-title" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Users size={20} style={{ color: 'var(--primary)' }} />
                    <span>Registered Accounts</span>
                  </h2>
                  
                  {loadingUsers ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                      <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
                    </div>
                  ) : usersList.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>No users found.</p>
                  ) : (
                    <div className="table-container" style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <th style={{ padding: '12px 8px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Username</th>
                            <th style={{ padding: '12px 8px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Email Address</th>
                            <th style={{ padding: '12px 8px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Role</th>
                            <th style={{ padding: '12px 8px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'center' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usersList.map((user: any) => {
                            const isPrimaryAdmin = user.username.toLowerCase() === 'admin';
                            const isSelf = user.username === currentUser?.username;
                            
                            return (
                              <tr key={user.username} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <td style={{ padding: '14px 8px', fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                                  {user.username}
                                </td>
                                <td style={{ padding: '14px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                  {user.email || 'N/A'}
                                </td>
                                <td style={{ padding: '14px 8px' }}>
                                  <span style={{
                                    fontSize: '11px',
                                    fontWeight: '700',
                                    padding: '3px 8px',
                                    borderRadius: '12px',
                                    textTransform: 'uppercase',
                                    backgroundColor: 
                                      user.role === 'Admin' ? 'rgba(245, 158, 11, 0.1)' :
                                      user.role === 'MIS Executive' ? 'rgba(99, 102, 241, 0.1)' :
                                      'rgba(59, 130, 246, 0.1)',
                                    color: 
                                      user.role === 'Admin' ? '#f59e0b' :
                                      user.role === 'MIS Executive' ? '#818cf8' :
                                      '#3b82f6',
                                    border: '1px solid ' + (
                                      user.role === 'Admin' ? 'rgba(245, 158, 11, 0.2)' :
                                      user.role === 'MIS Executive' ? 'rgba(99, 102, 241, 0.2)' :
                                      'rgba(59, 130, 246, 0.2)'
                                    )
                                  }}>
                                    {user.role}
                                  </span>
                                </td>
                                <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                  {isPrimaryAdmin ? (
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>System Protected</span>
                                  ) : isSelf ? (
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Logged In</span>
                                  ) : (
                                    <button 
                                      className="btn-icon-only"
                                      onClick={() => handleDeleteUser(user.username)}
                                      style={{
                                        border: 'none',
                                        background: 'none',
                                        color: 'var(--accent-red)',
                                        cursor: 'pointer',
                                        opacity: '0.8',
                                        transition: 'opacity 0.2s',
                                        padding: '4px'
                                      }}
                                      onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                                      onMouseOut={(e) => e.currentTarget.style.opacity = '0.8'}
                                      title={`Delete user account ${user.username}`}
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Create Account Form */}
                <div className="card" style={{ padding: '24px', borderRadius: '12px', height: 'fit-content' }}>
                  <h2 className="section-title" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <UserPlus size={20} style={{ color: 'var(--primary)' }} />
                    <span>Create Team Profile</span>
                  </h2>

                  <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {regError && (
                      <div style={{
                        padding: '12px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--accent-red)',
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        border: '1px solid rgba(239, 68, 68, 0.2)'
                      }}>
                        <AlertCircle size={16} />
                        <span>{regError}</span>
                      </div>
                    )}

                    {regSuccess && (
                      <div style={{
                        padding: '12px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        color: 'var(--accent-green)',
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        border: '1px solid rgba(16, 185, 129, 0.2)'
                      }}>
                        <CheckCircle2 size={16} />
                        <span>{regSuccess}</span>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Username</label>
                      <input
                        type="text"
                        required
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="e.g. executive_kora"
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '14px',
                          outline: 'none'
                        }}
                      />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Alphanumeric, hyphens, and underscores allowed.</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Executive / Team Email</label>
                      <input
                        type="email"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="e.g. executive@company.com"
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '14px',
                          outline: 'none'
                        }}
                      />
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Email address for assignment notifications & alerts.</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Password</label>
                      <input
                        type="password"
                        required
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '14px',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Account Role</label>
                      <select
                        value={regRole}
                        onChange={(e) => setRegRole(e.target.value)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '14px',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="MIS Team">MIS Team</option>
                        <option value="Tender Executive">Tender Executive</option>
                        <option value="Clearance Team">Clearance Team</option>
                        <option value="TPC Team">TPC Team</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={submittingUser}
                      className="btn btn-primary"
                      style={{
                        padding: '12px',
                        justifyContent: 'center',
                        fontWeight: '600',
                        marginTop: '10px',
                        width: '100%',
                        cursor: 'pointer'
                      }}
                    >
                      {submittingUser ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          <span>Creating Profile...</span>
                        </>
                      ) : (
                        <span>Create Account</span>
                      )}
                    </button>
                  </form>
                </div>

              </div>
            )}

            {/* TAB: WORK SUMMARY */}
            {activeTab === 'work-summary' && (currentUser?.role === 'Admin' || currentUser?.role === 'MIS Team') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
                
                {/* KPI Cards Row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '12px' }}>
                  
                  {/* Card 1: Total Assignments */}
                  <div className="card" style={{ padding: '16px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px', background: 'rgba(255, 255, 255, 0.02)' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Layers size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Assigned</div>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '2px' }}>{assignedTenders.length}</div>
                    </div>
                  </div>

                  {/* Card 2: Top Assigner */}
                  <div className="card" style={{ padding: '16px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px', background: 'rgba(255, 255, 255, 0.02)' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Users size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top Assigner</div>
                      <div style={{ fontSize: '18px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '4px', textTransform: 'capitalize' }}>
                        {topAssigner !== 'None' ? `${topAssigner} (${maxAssignments})` : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Stale Assignments */}
                  <div className="card" style={{ padding: '16px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px', background: staleCount > 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255, 255, 255, 0.02)', border: staleCount > 0 ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid var(--border-color)' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: staleCount > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)', color: staleCount > 0 ? 'var(--accent-red)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <AlertTriangle size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Stale Alerts</div>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: staleCount > 0 ? 'var(--accent-red)' : 'var(--text-primary)', marginTop: '2px' }}>{staleCount}</div>
                    </div>
                  </div>

                  {/* Card 4: Load Balance */}
                  <div className="card" style={{ padding: '16px 20px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '16px', background: 'rgba(255, 255, 255, 0.02)' }}>
                    <div style={{ padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Activity size={24} />
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Executives Active</div>
                      <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--text-primary)', marginTop: '2px' }}>
                        {Object.keys(assignmentsByExecutive).filter(k => k !== 'Unassigned').length}
                      </div>
                    </div>
                  </div>

                </div>

                {/* Executive Workload Summary Card */}
                <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                  <h2 className="section-title" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Briefcase size={20} style={{ color: 'var(--primary)' }} />
                    <span>Tender Executive Workload Summary</span>
                  </h2>
                  
                  {loadingUsers ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
                      <Loader2 className="animate-spin" size={32} style={{ color: 'var(--primary)' }} />
                    </div>
                  ) : (() => {
                    const filteredExecutives = usersList
                      .filter(u => u.role === 'MIS Executive')
                      .filter(u => u.username.toLowerCase().includes(execSearchQuery.toLowerCase()))
                      .map(exec => {
                        const stats = exec.stats || { live: 0, inProgress: 0, missed: 0, submitted: 0, won: 0, lost: 0 };
                        const totalFinished = stats.won + stats.lost + stats.missed;
                        const successRateVal = totalFinished > 0 ? (stats.won / totalFinished) * 100 : 0;
                        const totalTenders = stats.live + stats.inProgress + stats.submitted + stats.missed + stats.won + stats.lost;
                        return {
                          ...exec,
                          stats,
                          totalFinished,
                          successRate: successRateVal,
                          totalTenders
                        };
                      });

                    // Sort
                    const sortedExecutives = [...filteredExecutives].sort((a, b) => {
                      let valA: any = a.username;
                      let valB: any = b.username;
                      
                      if (execSortField === 'username') {
                        valA = a.username.toLowerCase();
                        valB = b.username.toLowerCase();
                      } else if (execSortField === 'successRate') {
                        valA = a.successRate;
                        valB = b.successRate;
                      } else if (execSortField === 'totalTenders') {
                        valA = a.totalTenders;
                        valB = b.totalTenders;
                      } else {
                        valA = a.stats[execSortField] || 0;
                        valB = b.stats[execSortField] || 0;
                      }
                      
                      if (valA < valB) return execSortOrder === 'asc' ? -1 : 1;
                      if (valA > valB) return execSortOrder === 'asc' ? 1 : -1;
                      return 0;
                    });

                    // Paginate
                    const totalExecs = sortedExecutives.length;
                    const totalPages = Math.ceil(totalExecs / execLimit) || 1;
                    const startIndex = (execPage - 1) * execLimit;
                    const paginatedExecutives = sortedExecutives.slice(startIndex, startIndex + execLimit);

                    const renderSortHeader = (label: string, field: typeof execSortField, textAlign: 'left' | 'center' = 'center') => {
                      const isCurrent = execSortField === field;
                      return (
                        <th 
                          onClick={() => {
                            if (isCurrent) {
                              setExecSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setExecSortField(field);
                              setExecSortOrder('desc');
                            }
                          }}
                          style={{ 
                            padding: '12px 8px', 
                            fontSize: '12px', 
                            fontWeight: 'bold', 
                            color: isCurrent ? 'var(--primary)' : 'var(--text-muted)', 
                            textTransform: 'uppercase', 
                            textAlign, 
                            cursor: 'pointer',
                            userSelect: 'none',
                            transition: 'color 0.2s'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: textAlign === 'center' ? 'center' : 'flex-start', gap: '4px' }}>
                            <span>{label}</span>
                            {isCurrent ? (
                              execSortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                            )}
                          </div>
                        </th>
                      );
                    };

                    if (totalExecs === 0) {
                      return (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 12px', width: '300px' }}>
                              <Search size={16} style={{ color: 'var(--text-muted)' }} />
                              <input
                                type="text"
                                placeholder="Search executive username..."
                                value={execSearchQuery}
                                onChange={(e) => {
                                  setExecSearchQuery(e.target.value);
                                  setExecPage(1);
                                }}
                                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontSize: '14px', width: '100%' }}
                              />
                            </div>
                          </div>
                          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>No tender executives found matching search filter.</p>
                        </div>
                      );
                    }

                    return (
                      <div>
                        {/* Search & Actions Control Bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 12px', width: '300px' }}>
                            <Search size={16} style={{ color: 'var(--text-muted)' }} />
                            <input
                              type="text"
                              placeholder="Search executive username..."
                              value={execSearchQuery}
                              onChange={(e) => {
                                setExecSearchQuery(e.target.value);
                                setExecPage(1);
                              }}
                              style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontSize: '14px', width: '100%' }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                            <span>Show</span>
                            <select
                              value={execLimit}
                              onChange={(e) => {
                                setExecLimit(Number(e.target.value));
                                setExecPage(1);
                              }}
                              style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text-primary)', cursor: 'pointer', outline: 'none' }}
                            >
                              <option value={5}>5</option>
                              <option value={10}>10</option>
                              <option value={20}>20</option>
                              <option value={50}>50</option>
                            </select>
                            <span>entries</span>
                          </div>
                        </div>

                        {/* Interactive Data Table */}
                        <div className="table-container" style={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                {renderSortHeader('Executive', 'username', 'left')}
                                <th style={{ padding: '12px 8px', fontSize: '12px', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'left', width: '140px' }}>Workload Stack</th>
                                {renderSortHeader('All', 'totalTenders')}
                                {renderSortHeader('Live', 'live')}
                                {renderSortHeader('In Progress', 'inProgress')}
                                {renderSortHeader('Submitted', 'submitted')}
                                {renderSortHeader('Missed', 'missed')}
                                {renderSortHeader('Won', 'won')}
                                {renderSortHeader('Lost', 'lost')}
                                {renderSortHeader('Success Rate', 'successRate')}
                              </tr>
                            </thead>
                            <tbody>
                              {paginatedExecutives.map((exec) => {
                                const stats = exec.stats;
                                const totalFinished = exec.totalFinished;
                                const successRate = exec.successRate.toFixed(1);
                                const totalTenders = exec.totalTenders;
                                
                                return (
                                  <tr key={exec.username} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background-color 0.2s' }} className="table-row-hover">
                                    {/* Executive Profile Avatar + Name */}
                                    <td style={{ padding: '14px 8px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <div style={{
                                          width: '32px',
                                          height: '32px',
                                          borderRadius: '50%',
                                          background: 'linear-gradient(135deg, var(--primary), #6366f1)',
                                          color: '#fff',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontSize: '11px',
                                          fontWeight: 'bold',
                                          textTransform: 'uppercase',
                                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                        }}>
                                          {exec.username.slice(0, 2)}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                          <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>{exec.username}</span>
                                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{totalTenders} total tenders</span>
                                        </div>
                                      </div>
                                    </td>

                                    {/* Mini Stacked Progress Bar */}
                                    <td style={{ padding: '14px 8px', verticalAlign: 'middle' }}>
                                      {totalTenders > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '130px' }}>
                                          <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)' }}>
                                            {stats.live > 0 && <div style={{ width: `${(stats.live / totalTenders) * 100}%`, backgroundColor: 'var(--primary)' }} title={`Live: ${stats.live}`} />}
                                            {stats.inProgress > 0 && <div style={{ width: `${(stats.inProgress / totalTenders) * 100}%`, backgroundColor: '#6366f1' }} title={`In Progress: ${stats.inProgress}`} />}
                                            {stats.submitted > 0 && <div style={{ width: `${(stats.submitted / totalTenders) * 100}%`, backgroundColor: '#3b82f6' }} title={`Submitted: ${stats.submitted}`} />}
                                            {stats.missed > 0 && <div style={{ width: `${(stats.missed / totalTenders) * 100}%`, backgroundColor: 'var(--accent-red)' }} title={`Missed: ${stats.missed}`} />}
                                            {stats.won > 0 && <div style={{ width: `${(stats.won / totalTenders) * 100}%`, backgroundColor: 'var(--accent-green)' }} title={`Won: ${stats.won}`} />}
                                            {stats.lost > 0 && <div style={{ width: `${(stats.lost / totalTenders) * 100}%`, backgroundColor: 'var(--text-muted)' }} title={`Lost: ${stats.lost}`} />}
                                          </div>
                                          <div style={{ display: 'flex', gap: '6px', fontSize: '9px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                            {stats.live > 0 && <span>L:{stats.live}</span>}
                                            {stats.inProgress > 0 && <span>P:{stats.inProgress}</span>}
                                            {stats.submitted > 0 && <span>S:{stats.submitted}</span>}
                                            {stats.missed > 0 && <span>M:{stats.missed}</span>}
                                            {stats.won > 0 && <span>W:{stats.won}</span>}
                                          </div>
                                        </div>
                                      ) : (
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>No assignments</span>
                                      )}
                                    </td>

                                    {/* Metric Counters (Interactive filters) */}
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      {totalTenders > 0 ? (
                                        <button
                                          onClick={() => {
                                            setMisExecutiveFilter(exec.username);
                                            setStatusFilter('');
                                            setActiveTab('tenders');
                                          }}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: 0,
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                            textDecoration: 'underline'
                                          }}
                                        >
                                          {totalTenders}
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>0</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      {stats.live > 0 ? (
                                        <button
                                          onClick={() => {
                                            setMisExecutiveFilter(exec.username);
                                            setStatusFilter('New');
                                            setActiveTab('tenders');
                                          }}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: 0,
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: 'var(--primary)',
                                            cursor: 'pointer',
                                            textDecoration: 'underline'
                                          }}
                                        >
                                          {stats.live}
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>0</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      {stats.inProgress > 0 ? (
                                        <button
                                          onClick={() => {
                                            setMisExecutiveFilter(exec.username);
                                            setStatusFilter('Participating');
                                            setActiveTab('tenders');
                                          }}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: 0,
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: '#6366f1',
                                            cursor: 'pointer',
                                            textDecoration: 'underline'
                                          }}
                                        >
                                          {stats.inProgress}
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>0</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      {stats.submitted > 0 ? (
                                        <button
                                          onClick={() => {
                                            setMisExecutiveFilter(exec.username);
                                            setStatusFilter('Submitted');
                                            setActiveTab('tenders');
                                          }}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: 0,
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: '#3b82f6',
                                            cursor: 'pointer',
                                            textDecoration: 'underline'
                                          }}
                                        >
                                          {stats.submitted}
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>0</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      {stats.missed > 0 ? (
                                        <button
                                          onClick={() => {
                                            setMisExecutiveFilter(exec.username);
                                            setStatusFilter('Missed');
                                            setActiveTab('tenders');
                                          }}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: 0,
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: 'var(--accent-red)',
                                            cursor: 'pointer',
                                            textDecoration: 'underline'
                                          }}
                                        >
                                          {stats.missed}
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>0</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      {stats.won > 0 ? (
                                        <button
                                          onClick={() => {
                                            setMisExecutiveFilter(exec.username);
                                            setStatusFilter('Won');
                                            setActiveTab('tenders');
                                          }}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: 0,
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: 'var(--accent-green)',
                                            cursor: 'pointer',
                                            textDecoration: 'underline'
                                          }}
                                        >
                                          {stats.won}
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>0</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      {stats.lost > 0 ? (
                                        <button
                                          onClick={() => {
                                            setMisExecutiveFilter(exec.username);
                                            setStatusFilter('Lost');
                                            setActiveTab('tenders');
                                          }}
                                          style={{
                                            background: 'transparent',
                                            border: 'none',
                                            padding: 0,
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            textDecoration: 'underline'
                                          }}
                                        >
                                          {stats.lost}
                                        </button>
                                      ) : (
                                        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>0</span>
                                      )}
                                    </td>

                                    {/* Success Rate Badge */}
                                    <td style={{ padding: '14px 8px', textAlign: 'center' }}>
                                      <span style={{
                                        fontSize: '12px',
                                        fontWeight: '700',
                                        padding: '3px 8px',
                                        borderRadius: '12px',
                                        backgroundColor: totalFinished === 0 ? 'rgba(255,255,255,0.05)' : parseFloat(successRate) >= 50 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                        color: totalFinished === 0 ? 'var(--text-muted)' : parseFloat(successRate) >= 50 ? 'var(--accent-green)' : 'var(--accent-red)',
                                        border: '1px solid ' + (totalFinished === 0 ? 'rgba(255,255,255,0.1)' : parseFloat(successRate) >= 50 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)')
                                      }}>
                                        {totalFinished === 0 ? 'N/A' : `${successRate}%`}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Pagination Footer */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', flexWrap: 'wrap', gap: '12px' }}>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            Showing {startIndex + 1} to {Math.min(startIndex + execLimit, totalExecs)} of {totalExecs} entries
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              disabled={execPage === 1}
                              onClick={() => setExecPage(p => Math.max(p - 1, 1))}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: execPage === 1 ? 'transparent' : 'var(--bg-card)',
                                color: execPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: execPage === 1 ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <ChevronLeft size={16} />
                              <span>Prev</span>
                            </button>
                            <button
                              disabled={execPage === totalPages}
                              onClick={() => setExecPage(p => Math.min(p + 1, totalPages))}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-color)',
                                background: execPage === totalPages ? 'transparent' : 'var(--bg-card)',
                                color: execPage === totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                                cursor: execPage === totalPages ? 'not-allowed' : 'pointer',
                                fontSize: '13px',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <span>Next</span>
                              <ChevronRight size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Active Tender Assignments Mapping Card */}
                {currentUser?.role === 'Admin' && (
                  <div className="card" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                      <h2 className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Layers size={20} style={{ color: 'var(--primary)' }} />
                        <span>Active Tender Assignments Mapping</span>
                      </h2>

                      {/* Grouping Selector */}
                      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <button
                          onClick={() => setAssignmentGroupBy('executive')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: assignmentGroupBy === 'executive' ? 'var(--primary)' : 'transparent',
                            color: assignmentGroupBy === 'executive' ? '#fff' : 'var(--text-secondary)',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Group by Executive
                        </button>
                        <button
                          onClick={() => setAssignmentGroupBy('assigner')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: assignmentGroupBy === 'assigner' ? 'var(--primary)' : 'transparent',
                            color: assignmentGroupBy === 'assigner' ? '#fff' : 'var(--text-secondary)',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Group by Assigner
                        </button>
                        <button
                          onClick={() => setAssignmentGroupBy('flat')}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: assignmentGroupBy === 'flat' ? 'var(--primary)' : 'transparent',
                            color: assignmentGroupBy === 'flat' ? '#fff' : 'var(--text-secondary)',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          Flat Table
                        </button>
                      </div>
                    </div>

                    {assignedTenders.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>No active assignments mapped.</p>
                    ) : (() => {
                      const filteredTenders = assignedTenders.filter(t => {
                        const q = assignSearchQuery.toLowerCase();
                        const idStr = String(t.id).toLowerCase();
                        const titleStr = (t.title || '').toLowerCase();
                        const prodStr = (t.product_name_as_per_tender || '').toLowerCase();
                        const execStr = (t.mis_executive || '').toLowerCase();
                        const assignerStr = (t.assigned_by || 'system').toLowerCase();
                        return idStr.includes(q) || titleStr.includes(q) || prodStr.includes(q) || execStr.includes(q) || assignerStr.includes(q);
                      });

                      // Sorting for Flat Table
                      const sortedTenders = [...filteredTenders].sort((a, b) => {
                        let valA: any = a[assignSortField];
                        let valB: any = b[assignSortField];

                        if (assignSortField === 'title') {
                          valA = (a.product_name_as_per_tender || a.title || '').toLowerCase();
                          valB = (b.product_name_as_per_tender || b.title || '').toLowerCase();
                        } else if (assignSortField === 'mis_executive') {
                          valA = (a.mis_executive || '').toLowerCase();
                          valB = (b.mis_executive || '').toLowerCase();
                        } else if (assignSortField === 'assigned_by') {
                          valA = (a.assigned_by || 'system').toLowerCase();
                          valB = (b.assigned_by || 'system').toLowerCase();
                        } else if (assignSortField === 'id') {
                          valA = a.id;
                          valB = b.id;
                        } else {
                          valA = a.assigned_at ? new Date(a.assigned_at).getTime() : 0;
                          valB = b.assigned_at ? new Date(b.assigned_at).getTime() : 0;
                        }

                        if (valA < valB) return assignSortOrder === 'asc' ? -1 : 1;
                        if (valA > valB) return assignSortOrder === 'asc' ? 1 : -1;
                        return 0;
                      });

                      // Paginate for Flat Table
                      const totalAssigns = sortedTenders.length;
                      const totalAssignPages = Math.ceil(totalAssigns / assignLimit) || 1;
                      const startAssignIndex = (assignPage - 1) * assignLimit;
                      const paginatedTenders = sortedTenders.slice(startAssignIndex, startAssignIndex + assignLimit);

                      // Re-group filtered items for Card Views
                      const filteredExecGroup: Record<string, typeof assignedTenders> = {};
                      const filteredAssignerGroup: Record<string, typeof assignedTenders> = {};

                      filteredTenders.forEach(t => {
                        const exec = t.mis_executive || 'Unassigned';
                        filteredExecGroup[exec] = filteredExecGroup[exec] || [];
                        filteredExecGroup[exec].push(t);

                        const assigner = t.assigned_by || 'system';
                        filteredAssignerGroup[assigner] = filteredAssignerGroup[assigner] || [];
                        filteredAssignerGroup[assigner].push(t);
                      });

                      const renderAssignSortHeader = (label: string, field: typeof assignSortField, textAlign: 'left' | 'center' = 'left') => {
                        const isCurrent = assignSortField === field;
                        return (
                          <th 
                            onClick={() => {
                              if (isCurrent) {
                                setAssignSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                              } else {
                                setAssignSortField(field);
                                setAssignSortOrder('desc');
                              }
                            }}
                            style={{ 
                              padding: '12px 8px', 
                              fontSize: '12px', 
                              fontWeight: 'bold', 
                              color: isCurrent ? 'var(--primary)' : 'var(--text-muted)', 
                              textTransform: 'uppercase', 
                              textAlign, 
                              cursor: 'pointer',
                              userSelect: 'none',
                              transition: 'color 0.2s'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: textAlign === 'center' ? 'center' : 'flex-start', gap: '4px' }}>
                              <span>{label}</span>
                              {isCurrent ? (
                                assignSortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                              ) : (
                                <ArrowUpDown size={10} style={{ opacity: 0.3 }} />
                              )}
                            </div>
                          </th>
                        );
                      };

                      return (
                        <div>
                          {/* Search / Limit Controls */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '16px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '6px 12px', width: '320px' }}>
                              <Search size={16} style={{ color: 'var(--text-muted)' }} />
                              <input
                                type="text"
                                placeholder="Search mapping (ID, Title, Executive)..."
                                value={assignSearchQuery}
                                onChange={(e) => {
                                  setAssignSearchQuery(e.target.value);
                                  setAssignPage(1);
                                }}
                                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', fontSize: '14px', width: '100%' }}
                              />
                            </div>

                            {assignmentGroupBy === 'flat' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                <span>Show</span>
                                <select
                                  value={assignLimit}
                                  onChange={(e) => {
                                    setAssignLimit(Number(e.target.value));
                                    setAssignPage(1);
                                  }}
                                  style={{ background: 'var(--bg-app)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', color: 'var(--text-primary)', cursor: 'pointer', outline: 'none' }}
                                >
                                  <option value={5}>5</option>
                                  <option value={10}>10</option>
                                  <option value={20}>20</option>
                                  <option value={50}>50</option>
                                </select>
                                <span>entries</span>
                              </div>
                            )}
                          </div>

                          {filteredTenders.length === 0 ? (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', textAlign: 'center', padding: '40px 0' }}>No active assignments matching search filter.</p>
                          ) : assignmentGroupBy === 'flat' ? (
                            /* FLAT TABLE VIEW */
                            <div>
                              <div className="table-container" style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                      {renderAssignSortHeader('Tender ID', 'id')}
                                      {renderAssignSortHeader('Tender Title', 'title')}
                                      {renderAssignSortHeader('Assigned Executive', 'mis_executive')}
                                      {renderAssignSortHeader('Assigned By', 'assigned_by')}
                                      {renderAssignSortHeader('Assigned At', 'assigned_at')}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {paginatedTenders.map((tender) => (
                                      <tr key={tender.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                        <td style={{ padding: '14px 8px', fontSize: '13px' }}>
                                          <button
                                            type="button"
                                            onClick={() => openTenderDetails(tender)}
                                            style={{
                                              background: 'transparent',
                                              border: 'none',
                                              padding: 0,
                                              color: 'var(--primary)',
                                              fontWeight: '700',
                                              cursor: 'pointer',
                                              textDecoration: 'underline'
                                            }}
                                          >
                                            {tender.id}
                                          </button>
                                          {isAssignmentStale(tender) && (
                                            <span style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '4px',
                                              fontSize: '10px',
                                              fontWeight: 'bold',
                                              padding: '2px 6px',
                                              borderRadius: '10px',
                                              backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                              color: '#fbbf24',
                                              border: '1px solid rgba(245, 158, 11, 0.25)',
                                              marginLeft: '8px'
                                            }}>
                                              <AlertTriangle size={10} />
                                              <span>Stale</span>
                                            </span>
                                          )}
                                        </td>
                                        <td style={{ padding: '14px 8px', fontSize: '13px', color: 'var(--text-primary)', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={tender.title}>
                                          {tender.product_name_as_per_tender || tender.title}
                                        </td>
                                        <td style={{ padding: '14px 8px', fontSize: '13px', fontWeight: '600', color: '#818cf8' }}>
                                          {tender.mis_executive}
                                        </td>
                                        <td style={{ padding: '14px 8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                          <span style={{
                                            fontSize: '11px',
                                            fontWeight: '700',
                                            padding: '3px 8px',
                                            borderRadius: '12px',
                                            textTransform: 'uppercase',
                                            backgroundColor: 'rgba(99, 102, 241, 0.1)',
                                            color: '#818cf8',
                                            border: '1px solid rgba(99, 102, 241, 0.2)'
                                          }}>
                                            {tender.assigned_by || 'system'}
                                          </span>
                                        </td>
                                        <td style={{ padding: '14px 8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                                          {tender.assigned_at ? formatDate(tender.assigned_at) : 'N/A'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {/* Pagination Footer */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', flexWrap: 'wrap', gap: '12px' }}>
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                                  Showing {startAssignIndex + 1} to {Math.min(startAssignIndex + assignLimit, totalAssigns)} of {totalAssigns} entries
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    disabled={assignPage === 1}
                                    onClick={() => setAssignPage(p => Math.max(p - 1, 1))}
                                    style={{
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-color)',
                                      background: assignPage === 1 ? 'transparent' : 'var(--bg-card)',
                                      color: assignPage === 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                                      cursor: assignPage === 1 ? 'not-allowed' : 'pointer',
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    <ChevronLeft size={16} />
                                    <span>Prev</span>
                                  </button>
                                  <button
                                    disabled={assignPage === totalAssignPages}
                                    onClick={() => setAssignPage(p => Math.min(p + 1, totalAssignPages))}
                                    style={{
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-color)',
                                      background: assignPage === totalAssignPages ? 'transparent' : 'var(--bg-card)',
                                      color: assignPage === totalAssignPages ? 'var(--text-muted)' : 'var(--text-primary)',
                                      cursor: assignPage === totalAssignPages ? 'not-allowed' : 'pointer',
                                      fontSize: '13px',
                                      fontWeight: '600',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    <span>Next</span>
                                    <ChevronRight size={16} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : assignmentGroupBy === 'executive' ? (
                            /* GROUP BY EXECUTIVE VIEW */
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                              {Object.entries(filteredExecGroup).map(([exec, items]) => (
                                <div key={exec} className="card" style={{ padding: '18px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255, 255, 255, 0.04)', display: 'flex', flexDirection: 'column' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px', marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#818cf8' }}></span>
                                      <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--text-primary)' }}>{exec}</span>
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', backgroundColor: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
                                      {items.length} Tenders
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
                                    {items.map((item) => (
                                      <div key={item.id} style={{ padding: '10px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <Link
                                            href={`/tenders/${item.id}`}
                                            style={{
                                              background: 'transparent',
                                              border: 'none',
                                              padding: 0,
                                              color: 'var(--primary)',
                                              fontWeight: '700',
                                              fontSize: '12px',
                                              cursor: 'pointer',
                                              textDecoration: 'underline'
                                            }}
                                          >
                                            ID: {item.id}
                                          </Link>
                                          {isAssignmentStale(item) && (
                                            <span style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '3px',
                                              fontSize: '9px',
                                              fontWeight: 'bold',
                                              padding: '1px 5px',
                                              borderRadius: '8px',
                                              backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                              color: '#fbbf24',
                                              border: '1px solid rgba(245, 158, 11, 0.25)'
                                            }}>
                                              <AlertTriangle size={8} />
                                              <span>Stale</span>
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={item.title}>
                                          {item.product_name_as_per_tender || item.title}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                          <span>By: <strong style={{ color: 'var(--text-secondary)' }}>{item.assigned_by || 'system'}</strong></span>
                                          <span>{item.assigned_at ? new Date(item.assigned_at).toLocaleDateString('en-IN') : 'N/A'}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            /* GROUP BY ASSIGNER VIEW */
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                              {Object.entries(filteredAssignerGroup).map(([assigner, items]) => (
                                <div key={assigner} className="card" style={{ padding: '18px', borderRadius: '10px', background: 'rgba(255, 255, 255, 0.01)', border: '1px solid rgba(255, 255, 255, 0.04)', display: 'flex', flexDirection: 'column' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '10px', marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--accent-green)' }}></span>
                                      <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--text-primary)', textTransform: 'capitalize' }}>{assigner}</span>
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-green)' }}>
                                      {items.length} Assigned
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
                                    {items.map((item) => (
                                      <div key={item.id} style={{ padding: '10px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                          <Link
                                            href={`/tenders/${item.id}`}
                                            style={{
                                              background: 'transparent',
                                              border: 'none',
                                              padding: 0,
                                              color: 'var(--primary)',
                                              fontWeight: '700',
                                              fontSize: '12px',
                                              cursor: 'pointer',
                                              textDecoration: 'underline'
                                            }}
                                          >
                                            ID: {item.id}
                                          </Link>
                                          {isAssignmentStale(item) && (
                                            <span style={{
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '3px',
                                              fontSize: '9px',
                                              fontWeight: 'bold',
                                              padding: '1px 5px',
                                              borderRadius: '8px',
                                              backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                              color: '#fbbf24',
                                              border: '1px solid rgba(245, 158, 11, 0.25)'
                                            }}>
                                              <AlertTriangle size={8} />
                                              <span>Stale</span>
                                            </span>
                                          )}
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={item.title}>
                                          {item.product_name_as_per_tender || item.title}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                          <span>To: <strong style={{ color: '#818cf8' }}>{item.mis_executive}</strong></span>
                                          <span>{item.assigned_at ? new Date(item.assigned_at).toLocaleDateString('en-IN') : 'N/A'}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Dedicated Full-Page View for Tender Details */}
      <div className={`drawer-backdrop ${isDrawerOpen ? 'open' : ''}`} onClick={closeTenderDetails}>
        <div className="drawer" style={{ width: '100vw', maxWidth: '100vw', height: '100vh', borderRadius: 0, top: 0, right: 0, zIndex: 99999, background: 'var(--bg-app)', padding: '24px 32px', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
          {selectedTender && (
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
              <header className="drawer-header" style={{ padding: '0 0 20px 0', marginBottom: '24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <button 
                    onClick={closeTenderDetails}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      padding: '10px 18px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      fontWeight: '700',
                      fontSize: '13px',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    <ChevronLeft size={18} /> Back to Dashboard
                  </button>
                  <div>
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', color: 'var(--text-primary)' }}>
                      {selectedTender.product_name_as_per_tender || selectedTender.title}
                    </h1>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Tender ID: <strong>{selectedTender.id}</strong> | Reference: <strong>{selectedTender.ref_no || 'N/A'}</strong> | Source: <strong>{selectedTender.source || 'Tender247'}</strong>
                    </span>
                  </div>
                </div>
                <span className={`status-badge ${selectedTender.status}`} style={{ fontSize: '13px', padding: '8px 18px', borderRadius: '20px', fontWeight: 'bold' }}>
                  {selectedTender.status}
                </span>
              </header>

              {/* Tender & Status Summaries */}
              <div className="summaries-container" style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Details Summary */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: 'var(--shadow-sm)',
                  backdropFilter: 'blur(10px)'
                }}>
                  <h3 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--primary)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <FileText size={14} /> Tender Details Summary
                  </h3>
                  {loadingDetails ? (
                    <div style={{ height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Loader2 className="animate-spin" size={20} style={{ color: 'var(--text-muted)' }} />
                    </div>
                  ) : (
                    <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)', margin: 0 }}>
                      {detailsSummary || 'No summary available for this tender.'}
                    </p>
                  )}
                </div>

                {/* Status History Summary */}
                <div style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '16px',
                  boxShadow: 'var(--shadow-sm)',
                  backdropFilter: 'blur(10px)'
                }}>
                  <h3 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--accent-green)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <History size={14} /> Status History Summary
                  </h3>
                  {loadingDetails ? (
                    <div style={{ height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Loader2 className="animate-spin" size={20} style={{ color: 'var(--text-muted)' }} />
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary)', marginBottom: '14px', margin: 0 }}>
                        {statusHistorySummary || 'No history summary available.'}
                      </p>
                      
                      {/* Timeline Log */}
                      {tenderHistory && tenderHistory.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingLeft: '12px', borderLeft: '2px solid var(--border-color)', marginLeft: '6px', marginTop: '14px' }}>
                          {tenderHistory.map((log: any, idx: number) => {
                            const logDate = new Date(log.changed_at.includes(' ') && !log.changed_at.includes('T') ? log.changed_at.replace(' ', 'T') + 'Z' : log.changed_at);
                            const formattedDate = isNaN(logDate.getTime()) ? log.changed_at : logDate.toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true
                            });
                            const isAlert = log.notes?.toLowerCase().includes('alert') || log.notes?.toLowerCase().includes('corrigendum');
                            
                            return (
                              <div key={idx} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {/* Timeline point */}
                                <div style={{
                                  position: 'absolute',
                                  left: '-18px',
                                  top: '4px',
                                  width: '10px',
                                  height: '10px',
                                  borderRadius: '50%',
                                  background: isAlert ? 'var(--accent-red)' : log.to_status === 'Submitted' ? 'var(--accent-green)' : 'var(--primary)',
                                  border: '2px solid var(--bg-sidebar)'
                                }}></div>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                  <span style={{
                                    fontSize: '11px',
                                    fontWeight: '700',
                                    textTransform: 'uppercase',
                                    color: isAlert ? 'var(--accent-red)' : 'var(--text-primary)',
                                    background: isAlert ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                    padding: '2px 6px',
                                    borderRadius: '4px'
                                  }}>
                                    {isAlert ? 'System Alert' : log.to_status}
                                  </span>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{formattedDate}</span>
                                </div>
                                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{log.notes || 'Status updated'}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Tender Specifications & Parameters Card */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', marginBottom: '20px', boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(10px)' }}>
                <h3 style={{ margin: '0 0 20px 0', fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Building size={18} style={{ color: 'var(--primary)' }} />
                  Tender Specifications & Parameters
                </h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  {[
                    { label: 'Procuring Authority', value: selectedTender.authority, icon: Building },
                    { label: 'Official Reference No', value: selectedTender.ref_no, icon: FileText },
                    { label: 'Estimated Value', value: selectedTender.estimated_cost_raw || (selectedTender.estimated_cost ? `₹ ${selectedTender.estimated_cost.toLocaleString('en-IN')}` : 'N/A'), icon: DollarSign, highlight: true },
                    { label: 'Earnest Money Deposit (EMD)', value: selectedTender.emd_raw || 'N/A', icon: DollarSign },
                    { label: 'Tender Document Fee', value: selectedTender.document_fee_raw || 'N/A', icon: Tag },
                    { label: 'Tender Type (GeM / Non GeM)', value: selectedTender.tender_type || 'GeM', icon: FileText, color: selectedTender.tender_type === 'GeM' ? '#10b981' : '#3b82f6' },
                    { label: 'Source Portal', value: selectedTender.source === 'GeM' ? 'GeM Portal' : 'Tender247 Portal', icon: Globe, color: selectedTender.source === 'GeM' ? '#10b981' : '#3b82f6' },
                    { label: 'Source ID', value: selectedTender.source_id || 'N/A', icon: Tag },
                    { label: 'Location / Region', value: selectedTender.location || 'N/A', icon: MapPin },
                    { label: 'Place', value: selectedTender.place || 'N/A', icon: MapPin },
                    { label: 'State', value: selectedTender.state || 'N/A', icon: MapPin },
                    { label: 'Sector / Category', value: selectedTender.sector || 'N/A', icon: Tag },
                    { label: 'Vertical Name', value: selectedTender.vertical_name || 'N/A', icon: Tag },
                    { label: 'Publish Date', value: selectedTender.publish_date || 'N/A', icon: Calendar },
                    { label: 'Start Date', value: selectedTender.start_date || 'N/A', icon: Calendar },
                    { label: 'Closing Due Date', value: selectedTender.due_date || 'N/A', icon: Calendar, highlight: isClosingSoon(selectedTender.due_date), color: isClosingSoon(selectedTender.due_date) ? '#ef4444' : undefined },
                    { label: 'Tender Opening Date', value: selectedTender.opening_date || 'N/A', icon: Calendar },
                    { label: 'Pre-Bid Meeting Date', value: selectedTender.pre_bid_date || 'N/A', icon: Calendar },
                    { label: 'Bid Submission Time', value: selectedTender.time || 'N/A', icon: Calendar },
                    { label: 'Entry Date', value: selectedTender.entry_date || 'N/A', icon: Calendar },
                    { label: 'Scraped At', value: selectedTender.scraped_at || 'N/A', icon: Calendar },
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
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Source Portal Link</span>
                    <div style={{ marginTop: '6px' }}>
                      <a href={selectedTender.original_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '8px 16px', textDecoration: 'none' }}>
                        View Official Portal Page <ExternalLink size={14} />
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Document Repository Card */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '24px', marginBottom: '20px', boxShadow: 'var(--shadow-sm)', backdropFilter: 'blur(10px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BookOpen size={18} style={{ color: 'var(--primary)' }} />
                    Document Repository & Bid Generator
                  </h3>
                  {(currentUser?.role === 'MIS Executive' || currentUser?.role === 'Tender Executive') && (
                    <button 
                      className="btn btn-primary" 
                      style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={openBidDocForm}
                    >
                      <FileText size={14} /> Generate Word (.docx) Bid Docs
                    </button>
                  )}
                </div>
                
                {(() => {
                  let docList: any[] = [];
                  if (selectedTender.downloaded_docs) {
                    try {
                      docList = JSON.parse(selectedTender.downloaded_docs);
                    } catch {
                      docList = [];
                    }
                  }
                  
                  if (!Array.isArray(docList) || docList.length === 0) {
                    if (selectedTender.document_url) {
                      docList = [{ name: 'Original Tender Document PDF', filename: 'Tender_Document.pdf', local_path: selectedTender.document_url, created_date: 'Official Download' }];
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
                        const isPdf = doc.filename?.toLowerCase().endsWith('.pdf') || doc.name?.toLowerCase().endsWith('.pdf');
                        const isDocx = doc.filename?.toLowerCase().endsWith('.docx') || doc.name?.toLowerCase().endsWith('.docx');
                        
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
                            {(doc.local_path || doc.url) && (
                              <a 
                                href={doc.local_path || doc.url} 
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

              {/* Executive & Quantity Management */}
              <div className="management-box" style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '14px',
                padding: '16px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                marginTop: '16px',
                marginBottom: '16px'
              }}>
                <h3 style={{ fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                  Executive & Quantity Management
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: 'span 2' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                        MIS Executive
                      </label>
                      {selectedTender.mis_executive && selectedTender.assigned_by && (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          Assigned by {selectedTender.assigned_by} {selectedTender.assigned_at ? `on ${formatDate(selectedTender.assigned_at)}` : ''}
                        </span>
                      )}
                    </div>
                    {currentUser.role === 'MIS Team' || currentUser.role === 'Admin' ? (
                      <select
                        value={misExecutive}
                        onChange={(e) => setMisExecutive(e.target.value)}
                        disabled={currentUser.role === 'Admin'}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-app)',
                          color: 'var(--text-primary)',
                          fontSize: '13px',
                          outline: 'none',
                          cursor: currentUser.role === 'Admin' ? 'not-allowed' : 'default',
                          opacity: currentUser.role === 'Admin' ? 0.7 : 1
                        }}
                      >
                        <option value="">-- Unassigned --</option>
                        {executives.map(exec => (
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                      Bid Quantity
                    </label>
                    <input
                      type="number"
                      placeholder="Bid Qty"
                      value={bidQty}
                      onChange={(e) => setBidQty(e.target.value === '' ? '' : Number(e.target.value))}
                      disabled={currentUser?.role === 'Admin'}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-app)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        cursor: currentUser?.role === 'Admin' ? 'not-allowed' : 'default',
                        opacity: currentUser?.role === 'Admin' ? 0.7 : 1
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
                      onChange={(e) => setQuotedQty(e.target.value === '' ? '' : Number(e.target.value))}
                      disabled={currentUser?.role === 'Admin'}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-app)',
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        cursor: currentUser?.role === 'Admin' ? 'not-allowed' : 'default',
                        opacity: currentUser?.role === 'Admin' ? 0.7 : 1
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Working Notes */}
              <div className="notes-area" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="detail-label">Internal Bidding Notes</label>
                  {currentUser?.role !== 'Admin' && (
                    <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '11px' }} onClick={saveNotes} disabled={notesSaving}>
                      {notesSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                  )}
                </div>
                <textarea
                  className="notes-textarea"
                  placeholder={currentUser?.role === 'Admin' ? 'No notes recorded for this tender.' : 'Record credentials, contact details, pricing estimates, task checklists, or notes for this bid...'}
                  value={tenderNotes}
                  onChange={(e) => setTenderNotes(e.target.value)}
                  readOnly={currentUser?.role === 'Admin'}
                  style={currentUser?.role === 'Admin' ? { opacity: 0.7, cursor: 'not-allowed' } : {}}
                />
              </div>

              {/* Custom Workflow Verification Pipeline */}
              <div style={{
                background: 'rgba(30, 41, 59, 0.25)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '20px',
                marginTop: '20px',
                marginBottom: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="detail-label" style={{ margin: 0, fontWeight: 'bold', fontSize: '14px' }}>
                    Current Status: <span style={{ textTransform: 'uppercase', color: 'var(--primary)', fontWeight: '700' }}>{selectedTender.status}</span>
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Workflow Pipeline</span>
                </div>

                {/* Horizontal Stepper Progress Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', margin: '10px 0 20px 0', padding: '0 10px' }}>
                  <div style={{ position: 'absolute', top: '12px', left: '20px', right: '20px', height: '2px', backgroundColor: 'var(--border-color)', zIndex: 0 }}></div>
                  <div style={{ 
                    position: 'absolute', 
                    top: '12px', 
                    left: '20px', 
                    width: (() => {
                      if (selectedTender.status === 'Won' || selectedTender.status === 'Lost' || selectedTender.status === 'Awarded' || selectedTender.status === 'Not Awarded') return '100%';
                      if (selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') return '75%';
                      if (selectedTender.verification_status === 'Approved') return '75%';
                      if (selectedTender.payment_status === 'Approved') return '50%';
                      if (selectedTender.status === 'Participating') return areDocsGenerated ? '25%' : '0%';
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

                {/* Workflow Cards */}
                
                {/* 0. Technical Specification Review Card */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>0. Technical Specification Review</h4>
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
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.4' }}>
                    Review technical parameters and product specifications. Clearance Team verification is required before bid generation.
                  </p>
                  {selectedTender.assigned_mis_member_spec && (
                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Target Clearance Representative: <strong style={{ color: 'var(--text-primary)' }}>{selectedTender.assigned_mis_member_spec}</strong>
                    </div>
                  )}

                  {/* Executive Controls: 2-Phase Sequence (1. Generate/Upload -> 2. Send to Clearance Team) */}
                  {(currentUser?.role === 'MIS Executive' || currentUser?.role === 'Tender Executive') && selectedTender.spec_verification_status !== 'Approved' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
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
                              id="tech-spec-file-input-main"
                              accept=".pdf,.docx,.doc,.txt"
                              style={{ fontSize: '12px', color: 'var(--text-primary)', padding: '6px', background: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                            />
                          </div>

                          <button 
                            className="btn btn-primary"
                            style={{ width: '100%', justifyContent: 'center', fontSize: '12.5px', marginTop: '4px' }}
                            onClick={async () => {
                              const inputEl = document.getElementById('tech-spec-file-input-main') as HTMLInputElement;
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
                                <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase' }}>Assign Clearance Team Representative</label>
                                <select 
                                  value={selectedMisMemberSpec} 
                                  onChange={(e) => {
                                    setSelectedMisMemberSpec(e.target.value);
                                    updateTenderField({ assigned_mis_member_spec: e.target.value });
                                  }}
                                  style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12.5px', outline: 'none' }}
                                >
                                  <option value="">-- Select Clearance Representative --</option>
                                  {specTeamMembers.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                  ))}
                                </select>
                              </div>

                              <button 
                                className="btn btn-primary" 
                                style={{ width: '100%', justifyContent: 'center', marginTop: '4px' }}
                                onClick={async () => {
                                  if (!selectedMisMemberSpec) {
                                    showToast('Please select a Target Clearance Representative first.', 'error');
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

                  {/* Clearance Team Action Controls */}
                  {(currentUser?.role === 'Clearance Team' || currentUser?.role === 'Specification Team' || (selectedTender.assigned_mis_member_spec && currentUser?.username === selectedTender.assigned_mis_member_spec)) && selectedTender.spec_verification_status === 'Pending' && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', background: 'rgba(147, 51, 234, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(147, 51, 234, 0.2)' }}>
                      <button 
                        className="btn btn-primary" 
                        style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '11px', justifyContent: 'center' }}
                        onClick={() => updateTenderField({ spec_verification_status: 'Approved' })}
                      >
                        Approve Tech Spec
                      </button>
                      <button 
                        className="btn btn-secondary" 
                        style={{ flex: 1, color: 'var(--accent-red)', padding: '6px 12px', fontSize: '11px', justifyContent: 'center' }}
                        onClick={() => updateTenderField({ spec_verification_status: 'Rejected' })}
                      >
                        Reject Tech Spec
                      </button>
                    </div>
                  )}
                </div>
                
                {/* 1. Preparation Card - UNLOCKED ONLY AFTER TECH SPEC IS APPROVED */}
                {selectedTender.spec_verification_status === 'Approved' ? (
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>1. Preparation & Bid Documents</h4>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', backgroundColor: areDocsGenerated ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)', color: areDocsGenerated ? '#10b981' : '#f59e0b', fontWeight: '600' }}>
                        {areDocsGenerated ? 'Completed' : 'Pending'}
                      </span>
                    </div>
                    {!areDocsGenerated ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                          No bid documents have been generated yet. Use the document builder to start.
                        </p>
                        {(currentUser?.role === 'MIS Executive' || currentUser?.role === 'Tender Executive') && (
                          <button 
                            className="btn btn-primary" 
                            style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}
                            onClick={openBidDocForm}
                          >
                            Generate Bid Documents
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                          Bid document package successfully compiled.
                        </p>
                        {selectedTender.working_path && (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            📁 Working folder: <code>{selectedTender.working_path}</code>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '14px 16px', borderRadius: '8px', border: '1px dashed var(--border-color)', marginBottom: '16px', opacity: 0.7 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)' }}>1. Preparation & Bid Documents</span>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '12px', backgroundColor: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)' }}>
                        Locked (Pending Tech Spec Clearance)
                      </span>
                    </div>
                  </div>
                )}

                {/* 2. EMD Payment Card */}
                {areDocsGenerated && (selectedTender.status !== 'New') && (
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>2. EMD Payment Details</h4>
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

                    {/* EMD input form */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Payment Mode</label>
                        <select 
                          value={emdPaymentMode}
                          onChange={(e) => setEmdPaymentMode(e.target.value)}
                          disabled={currentUser?.role === 'Admin' || selectedTender.payment_status === 'Approved'}
                          style={{ padding: '6px 8px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                        >
                          <option value="">-- Choose Mode --</option>
                          <option value="Online / NEFT">Online / NEFT</option>
                          <option value="Demand Draft (DD)">Demand Draft (DD)</option>
                          <option value="Bank Guarantee (BG)">Bank Guarantee (BG)</option>
                          <option value="Exempted">Exempted</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Actual Amount (₹)</label>
                        <input 
                          type="number"
                          placeholder="e.g. 5000"
                          value={emdAmountActual}
                          onChange={(e) => setEmdAmountActual(e.target.value === '' ? '' : Number(e.target.value))}
                          disabled={currentUser?.role === 'Admin' || selectedTender.payment_status === 'Approved'}
                          style={{ padding: '6px 8px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Reference / Txn ID</label>
                        <input 
                          type="text"
                          placeholder="Ref / Txn No"
                          value={emdPaymentRef}
                          onChange={(e) => setEmdPaymentRef(e.target.value)}
                          disabled={currentUser?.role === 'Admin' || selectedTender.payment_status === 'Approved'}
                          style={{ padding: '6px 8px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Payment Date</label>
                        <input 
                          type="date"
                          value={emdPaymentDate}
                          onChange={(e) => setEmdPaymentDate(e.target.value)}
                          disabled={currentUser?.role === 'Admin' || selectedTender.payment_status === 'Approved'}
                          style={{ padding: '6px 8px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '12px' }}
                        />
                      </div>
                    </div>

                    {/* Target MIS Team Representative Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                        Target MIS Team Representative
                      </label>
                      <select 
                        value={selectedMisMember}
                        onChange={(e) => {
                          setSelectedMisMember(e.target.value);
                          updateTenderField({ assigned_mis_member: e.target.value });
                        }}
                        disabled={currentUser?.role === 'Admin'}
                        style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                      >
                        <option value="">-- Select Target MIS Representative --</option>
                        {misTeamMembers.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    {/* Action buttons */}
                    {currentUser?.role !== 'Admin' && selectedTender.payment_status !== 'Approved' && (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                        <button 
                          className="btn btn-secondary" 
                          style={{ flex: 1, padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                          onClick={() => updateTenderField({
                            emd_payment_mode: emdPaymentMode,
                            emd_amount_actual: emdAmountActual === '' ? null : Number(emdAmountActual),
                            emd_payment_ref: emdPaymentRef,
                            emd_payment_date: emdPaymentDate,
                            assigned_mis_member: selectedMisMember
                          })}
                        >
                          Save Details
                        </button>
                        {(currentUser?.role === 'MIS Executive' || currentUser?.role === 'Tender Executive') && (
                          <button 
                            className="btn btn-primary" 
                            style={{ flex: 1, padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                            onClick={() => updateTenderField({
                              emd_payment_mode: emdPaymentMode,
                              emd_amount_actual: emdAmountActual === '' ? null : Number(emdAmountActual),
                              emd_payment_ref: emdPaymentRef,
                              emd_payment_date: emdPaymentDate,
                              assigned_mis_member: selectedMisMember,
                              payment_status: 'Pending'
                            })}
                          >
                            Submit Approval Request
                          </button>
                        )}
                      </div>
                    )}

                    {/* MIS Verification Controls */}
                    {selectedTender.payment_status === 'Pending' && (currentUser?.username === selectedTender.assigned_mis_member || currentUser?.role === 'MIS Team') && (
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
                          Reject Payment
                        </button>
                      </div>
                    )}

                    {/* Comments section for EMD */}
                    {(() => {
                      const phaseComments = comments.filter(c => c.phase === 'Payment');
                      return (
                        <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '6px' }}>
                            EMD Discussion ({phaseComments.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '100px', overflowY: 'auto', marginBottom: '6px' }}>
                            {phaseComments.map((c, i) => (
                              <div key={i} style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '6px', borderRadius: '4px', fontSize: '11px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                                  <span style={{ fontWeight: '700' }}>{c.username}</span>
                                  <span>{new Date(c.created_at).toLocaleDateString()}</span>
                                </div>
                                <div style={{ color: 'var(--text-primary)' }}>{c.comment}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <input 
                              type="text" 
                              placeholder="Discuss payment..." 
                              value={emdCommentText} 
                              onChange={(e) => setEmdCommentText(e.target.value)} 
                              style={{ flexGrow: 1, padding: '4px 8px', fontSize: '11px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                            />
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              onClick={async () => {
                                if (!emdCommentText.trim()) return;
                                await postComment('Payment', emdCommentText);
                              }}
                            >
                              Post
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 3. Document Verification Card */}
                {selectedTender.payment_status === 'Approved' && (
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>3. Document Verification</h4>
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

                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>
                      Upload final files to folder and request thorough verification review of bid templates, checklists, and signatures.
                    </p>

                    {/* Working Folder Path (Documents Store) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '10px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Working Folder Path (Documents Store)</span>
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input 
                          type="text" 
                          value={workingPath}
                          onChange={(e) => setWorkingPath(e.target.value)}
                          placeholder="e.g. /Shared/Tenders/2026/GEM-7324078"
                          disabled={currentUser?.role === 'Admin'}
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
                        {currentUser?.role !== 'Admin' && (
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

                    {/* Target MIS Team Representative Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                        Target MIS Team Representative
                      </label>
                      <select 
                        value={selectedMisMember}
                        onChange={(e) => {
                          setSelectedMisMember(e.target.value);
                          updateTenderField({ assigned_mis_member: e.target.value });
                        }}
                        disabled={currentUser?.role === 'Admin'}
                        style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                      >
                        <option value="">-- Select Target MIS Representative --</option>
                        {misTeamMembers.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    {(currentUser?.role === 'MIS Executive' || currentUser?.role === 'Tender Executive') && selectedTender.verification_status !== 'Approved' && (
                      <button 
                        className="btn btn-primary" 
                        style={{ width: '100%', padding: '6px 12px', fontSize: '12px', justifyContent: 'center', marginBottom: '12px' }}
                        onClick={() => updateTenderField({ 
                          working_path: workingPath, 
                          assigned_mis_member: selectedMisMember, 
                          verification_status: 'Pending' 
                        })}
                      >
                        Request Document Review
                      </button>
                    )}

                    {selectedTender.verification_status === 'Pending' && (currentUser?.username === selectedTender.assigned_mis_member || currentUser?.role === 'MIS Team') && (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                        <button 
                          className="btn btn-primary" 
                          style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                          onClick={() => updateTenderField({ verification_status: 'Approved' })}
                        >
                          Approve Docs
                        </button>
                        <button 
                          className="btn btn-secondary" 
                          style={{ flex: 1, color: 'var(--accent-red)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                          onClick={() => updateTenderField({ verification_status: 'Rejected' })}
                        >
                          Request Changes
                        </button>
                      </div>
                    )}

                    {/* Comments section for Verification */}
                    {(() => {
                      const phaseComments = comments.filter(c => c.phase === 'Verification');
                      return (
                        <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '6px' }}>
                            Verification Discussion ({phaseComments.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '100px', overflowY: 'auto', marginBottom: '6px' }}>
                            {phaseComments.map((c, i) => (
                              <div key={i} style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '6px', borderRadius: '4px', fontSize: '11px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                                  <span style={{ fontWeight: '700' }}>{c.username}</span>
                                  <span>{new Date(c.created_at).toLocaleDateString()}</span>
                                </div>
                                <div style={{ color: 'var(--text-primary)' }}>{c.comment}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <input 
                              type="text" 
                              placeholder="Add review feedback..." 
                              value={verificationCommentText} 
                              onChange={(e) => setVerificationCommentText(e.target.value)} 
                              style={{ flexGrow: 1, padding: '4px 8px', fontSize: '11px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                            />
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              onClick={async () => {
                                if (!verificationCommentText.trim()) return;
                                await postComment('Verification', verificationCommentText);
                              }}
                            >
                              Post
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 4. Submission Card */}
                {selectedTender.verification_status === 'Approved' && (
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>4. Submission Verification</h4>
                      <span style={{ 
                        fontSize: '11px', 
                        padding: '2px 8px', 
                        borderRadius: '12px', 
                        backgroundColor: (selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') ? 'rgba(16, 185, 129, 0.1)' : selectedTender.submission_status === 'Pending' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                        color: (selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') ? '#10b981' : selectedTender.submission_status === 'Pending' ? '#f59e0b' : 'var(--text-muted)', 
                        fontWeight: '600' 
                      }}>
                        {(selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') ? 'Submitted' : selectedTender.submission_status || 'Not Filed'}
                      </span>
                    </div>

                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>
                      After physically/electronically filing the bid on the portal, request submission audit. Only the selected MIS Team member can verify and mark as Submitted.
                    </p>

                    {/* Target MIS Team Representative Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase' }}>
                        Target MIS Team Representative
                      </label>
                      <select 
                        value={selectedMisMember}
                        onChange={(e) => {
                          setSelectedMisMember(e.target.value);
                          updateTenderField({ assigned_mis_member: e.target.value });
                        }}
                        disabled={currentUser?.role === 'Admin'}
                        style={{ padding: '8px 12px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '13px', outline: 'none' }}
                      >
                        <option value="">-- Select Target MIS Representative --</option>
                        {misTeamMembers.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>

                    {(currentUser?.role === 'MIS Executive' || currentUser?.role === 'Tender Executive') && selectedTender.status !== 'Submitted' && selectedTender.status !== 'Filed' && selectedTender.submission_status !== 'Pending' && (
                      <button 
                        className="btn btn-primary" 
                        style={{ width: '100%', padding: '6px 12px', fontSize: '12px', justifyContent: 'center', marginBottom: '12px' }}
                        onClick={() => updateTenderField({ assigned_mis_member: selectedMisMember, submission_status: 'Pending' })}
                      >
                        Request Submission Verification
                      </button>
                    )}

                    {selectedTender.submission_status === 'Pending' && (currentUser?.username === selectedTender.assigned_mis_member || currentUser?.role === 'MIS Team') && (
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', background: 'rgba(245, 158, 11, 0.05)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                        <button 
                          className="btn btn-primary" 
                          style={{ flex: 1, background: 'var(--accent-green)', borderColor: 'var(--accent-green)', padding: '6px 12px', fontSize: '12px', justifyContent: 'center' }}
                          onClick={() => updateTenderField({ submission_status: 'Approved', status: 'Filed' })}
                        >
                          Confirm & Mark Submitted
                        </button>
                      </div>
                    )}

                    {/* Comments section for Submission */}
                    {(() => {
                      const phaseComments = comments.filter(c => c.phase === 'Submission');
                      return (
                        <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '6px' }}>
                            Submission Discussion ({phaseComments.length})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '100px', overflowY: 'auto', marginBottom: '6px' }}>
                            {phaseComments.map((c, i) => (
                              <div key={i} style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '6px', borderRadius: '4px', fontSize: '11px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '9px', marginBottom: '2px' }}>
                                  <span style={{ fontWeight: '700' }}>{c.username}</span>
                                  <span>{new Date(c.created_at).toLocaleDateString()}</span>
                                </div>
                                <div style={{ color: 'var(--text-primary)' }}>{c.comment}</div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <input 
                              type="text" 
                              placeholder="Discuss filing..." 
                              value={submissionCommentText} 
                              onChange={(e) => setSubmissionCommentText(e.target.value)} 
                              style={{ flexGrow: 1, padding: '4px 8px', fontSize: '11px', borderRadius: '4px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                            />
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '4px 8px', fontSize: '11px' }}
                              onClick={async () => {
                                if (!submissionCommentText.trim()) return;
                                await postComment('Submission', submissionCommentText);
                              }}
                            >
                              Post
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 5. Final Outcome Card */}
                {(selectedTender.status === 'Submitted' || selectedTender.status === 'Filed' || selectedTender.status === 'Won' || selectedTender.status === 'Lost' || selectedTender.status === 'Awarded' || selectedTender.status === 'Not Awarded') && (
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <h4 style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>5. Final Outcome Verification</h4>
                      <span style={{ 
                        fontSize: '11px', 
                        padding: '2px 8px', 
                        borderRadius: '12px', 
                        backgroundColor: (selectedTender.status === 'Won' || selectedTender.status === 'Awarded') ? 'rgba(16, 185, 129, 0.1)' : (selectedTender.status === 'Lost' || selectedTender.status === 'Not Awarded') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)', 
                        color: (selectedTender.status === 'Won' || selectedTender.status === 'Awarded') ? '#10b981' : (selectedTender.status === 'Lost' || selectedTender.status === 'Not Awarded') ? '#ef4444' : 'var(--text-muted)', 
                        fontWeight: '600' 
                      }}>
                        {selectedTender.status === 'Awarded' || selectedTender.status === 'Won' ? 'Won' : selectedTender.status === 'Not Awarded' || selectedTender.status === 'Lost' ? 'Lost' : 'Awaiting Bids Result'}
                      </span>
                    </div>

                    {/* Loss Reason Input Box */}
                    {((selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') || selectedTender.status === 'Lost' || selectedTender.status === 'Not Awarded') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>
                          Loss Reason / Bid Summary (Filled if Lost)
                        </label>
                        <textarea 
                          value={lossReason}
                          onChange={(e) => setLossReason(e.target.value)}
                          placeholder="Enter details of outcome, or reason for loss (e.g. L1 pricing, technical disqualification...)"
                          disabled={selectedTender.status === 'Lost' || selectedTender.status === 'Not Awarded'}
                          style={{ padding: '8px 10px', fontSize: '12px', height: '60px', borderRadius: '6px', background: 'var(--bg-app)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', outline: 'none' }}
                        />
                        {!(selectedTender.status === 'Lost' || selectedTender.status === 'Not Awarded') && (
                          <button 
                            className="btn btn-secondary" 
                            style={{ padding: '6px 12px', fontSize: '11px', alignSelf: 'flex-end', marginTop: '4px' }}
                            onClick={() => updateTenderField({ loss_reason: lossReason })}
                          >
                            Save Reason
                          </button>
                        )}
                      </div>
                    )}

                    {/* Finalize Buttons - Reserved for MIS Representative */}
                    {(selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') && (currentUser?.username === selectedTender.assigned_mis_member || currentUser?.role === 'MIS Team') && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
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
                    )}

                    {/* If executive is logged in and needs to declare outcome feedback */}
                    {(selectedTender.status === 'Submitted' || selectedTender.status === 'Filed') && currentUser?.role === 'MIS Executive' && (
                      <p style={{ fontSize: '11.5px', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                        Outcome declaration request sent. Selected MIS Team member ({selectedTender.assigned_mis_member || 'N/A'}) will review and mark final Won/Lost state.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
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
              <div className="modal-body">
                <div className="form-tabs">
                  <button
                    type="button"
                    className={`form-tab-btn ${formActiveTab === 'tender' ? 'active' : ''}`}
                    onClick={() => setFormActiveTab('tender')}
                  >
                    Tender Info
                  </button>
                  <button
                    type="button"
                    className={`form-tab-btn ${formActiveTab === 'company' ? 'active' : ''}`}
                    onClick={() => setFormActiveTab('company')}
                  >
                    Bidder & Mfg Details
                  </button>
                  <button
                    type="button"
                    className={`form-tab-btn ${formActiveTab === 'signatory' ? 'active' : ''}`}
                    onClick={() => setFormActiveTab('signatory')}
                  >
                    Authorized Representative
                  </button>
                  <button
                    type="button"
                    className={`form-tab-btn ${formActiveTab === 'clauses' ? 'active' : ''}`}
                    onClick={() => setFormActiveTab('clauses')}
                  >
                    Bid Clauses
                  </button>
                </div>

                {formActiveTab === 'tender' && (
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Bid / Tender Number</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.bidNumber}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, bidNumber: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Bid Issue / Publish Date</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.bidDate}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, bidDate: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Procuring Authority Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.authorityName}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, authorityName: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Procuring Department/Ministry</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.authorityDept}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, authorityDept: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Authority Address / Postal Code</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.authorityAddress}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, authorityAddress: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Product Name / Description (As per Bid)</label>
                      <textarea
                        className="form-input form-textarea"
                        value={bidFormFields.productDescription}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, productDescription: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                )}

                {formActiveTab === 'company' && (
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Bidder Company Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.companyName}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, companyName: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Company Contact Number</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.companyContact}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, companyContact: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Company Office Address</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.companyAddress}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, companyAddress: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Company Email</label>
                      <input
                        type="email"
                        className="form-input"
                        value={bidFormFields.companyEmail}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, companyEmail: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Company Website URL</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.companyWebsite}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, companyWebsite: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Manufacturer Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.manufacturerName}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, manufacturerName: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Manufacturer Address</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.manufacturerAddress}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, manufacturerAddress: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                )}

                {formActiveTab === 'signatory' && (
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Authorized Signatory Name</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.signatoryName}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, signatoryName: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Signatory Designation</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.signatoryDesignation}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, signatoryDesignation: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Signatory Personal Address</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.signatoryAddress}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, signatoryAddress: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Witness Name & Contact Details</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.witnessDetails}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, witnessDetails: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                )}

                {formActiveTab === 'clauses' && (
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Local Content Percentage</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.localContentPercentage}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, localContentPercentage: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Purchase Preference Policy Claimed</label>
                      <select
                        className="form-select"
                        value={bidFormFields.preferencePolicy}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, preferencePolicy: e.target.value }))}
                      >
                        <option value="PPP MII 2017">PPP MII 2017 (Make in India Preference)</option>
                        <option value="PPP MSME Order 2012">PPP MSME Order 2012 (MSE Preference)</option>
                      </select>
                    </div>
                    <div className="form-group span-2">
                      <label className="form-label">Local Content Value Addition Location</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.localContentLocation}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, localContentLocation: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tender Warranty Duration</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.warrantyPeriod}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, warrantyPeriod: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">On-Site Service Support Period</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.serviceSupportPeriod}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, serviceSupportPeriod: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Spare Parts Availability Period</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.sparesAvailabilityPeriod}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, sparesAvailabilityPeriod: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Place of Declaration Signing</label>
                      <input
                        type="text"
                        className="form-input"
                        value={bidFormFields.place}
                        onChange={(e) => setBidFormFields(prev => ({ ...prev, place: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                )}
              </div>

              <footer className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsBidDocFormOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={generatingBidDocs}
                  style={{ minWidth: '150px', justifyContent: 'center' }}
                >
                  {generatingBidDocs ? (
                    <>
                      <Loader2 className="animate-spin" size={16} />
                      <span>Compiling Word...</span>
                    </>
                  ) : (
                    <span>Generate Word Doc</span>
                  )}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      <div className={`toast ${toast.show ? 'show' : ''} ${toast.type}`}>
        {toast.type === 'success' ? (
          <CheckCircle2 size={18} className="toast-icon success" />
        ) : (
          <AlertCircle size={18} className="toast-icon error" />
        )}
        <span>{toast.message}</span>
      </div>

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
