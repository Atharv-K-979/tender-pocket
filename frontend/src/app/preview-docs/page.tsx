'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, RefreshCw, Eye, CheckCircle2, ShieldCheck, Building2, FileText } from 'lucide-react';

export default function DocumentPreviewPage() {
  const [companyKey, setCompanyKey] = useState<'me' | 'healthtech'>('me');
  const [docType, setDocType] = useState<string>('all');
  const [showSignature, setShowSignature] = useState(true);
  const [showStamp, setShowStamp] = useState(true);
  const [loading, setLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  const [testResults, setTestResults] = useState<{ name: string; status: 'pending' | 'success' | 'failed' }[]>([]);
  const [runningTests, setRunningTests] = useState(false);

  const [formData, setFormData] = useState({
    bidNumber: 'GEM/2026/B/8015551',
    bidDate: '09-09-2026',
    date: '26-09-2026',
    authorityName: 'MANAGING DIRECTOR\nUP MEDICAL SUPPLIES CORPORATION LIMITED (UPMSCL)',
    authorityDept: 'Medical Health And Family Welfare Department',
    authorityAddress: 'Lucknow, Uttar Pradesh',
    productDescription: 'Biosafety Cabinet',
    offeredModel: 'MBSC-03',
    offeredMake: 'MarkEn',
    qty: '67',
    udyamNo: 'MH23B0040110/UDYAM-MH-19-0016285',
    localContentPercentage: '100%',
    preferencePolicy: 'PPP MII 2017',
    blacklistYears: '(5) Five',
    bidSecurityPeriod: '180 Days',
    place: 'Nashik, Maharashtra.'
  });

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchPreview = async (comp = companyKey, type = docType, fields = formData, sig = showSignature, st = showStamp) => {
    try {
      setLoading(true);
      const res = await fetch('/api/preview-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyKey: comp,
          docType: type,
          sampleData: {
            ...fields,
            showSignature: sig,
            showStamp: st
          }
        })
      });
      const data = await res.json();
      if (data.success && data.html) {
        setHtmlContent(data.html);
      }
    } catch (err) {
      console.error('Failed to load preview:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Adjust sample data defaults on company change
    if (companyKey === 'healthtech') {
      setFormData(prev => ({
        ...prev,
        bidNumber: 'GEM/2026/B/7247631',
        bidDate: '16-02-2026',
        date: '10-01-2026',
        authorityName: 'Directorate Of Training And Employment',
        authorityDept: 'Vocational Education And Skill Development Department',
        authorityAddress: 'Uttar Pradesh',
        productDescription: 'Walk In Cooler (MWIC-04)',
        offeredModel: 'MWIC-04',
        offeredMake: 'MarkEn',
        qty: '1',
        blacklistYears: 'three',
        bidSecurityPeriod: 'Six (06) months',
        place: 'Nashik'
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        bidNumber: 'GEM/2026/B/8015551',
        bidDate: '09-09-2026',
        date: '26-09-2026',
        authorityName: 'MANAGING DIRECTOR\nUP MEDICAL SUPPLIES CORPORATION LIMITED (UPMSCL)',
        authorityDept: 'Medical Health And Family Welfare Department',
        authorityAddress: 'Lucknow, Uttar Pradesh',
        productDescription: 'Biosafety Cabinet',
        offeredModel: 'MBSC-03',
        offeredMake: 'MarkEn',
        qty: '67',
        blacklistYears: '(5) Five',
        bidSecurityPeriod: '180 Days',
        place: 'Nashik, Maharashtra.'
      }));
    }
  }, [companyKey]);

  useEffect(() => {
    fetchPreview();
  }, [companyKey, docType, showSignature, showStamp]);

  const handlePrint = () => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  };

  const handleRunTests = async () => {
    setRunningTests(true);
    const testCases = [
      { name: 'Theme A (Mark Enterprises) - Full Bid Document Package', company: 'me', type: 'all' },
      { name: 'Theme A (Mark Enterprises) - Tech Spec Compliance Sheet', company: 'me', type: 'spec' },
      { name: 'Theme B (Marken Healthtech) - Full Bid Document Package', company: 'healthtech', type: 'all' },
      { name: 'Theme B (Marken Healthtech) - Tech Spec Compliance Sheet', company: 'healthtech', type: 'spec' },
      { name: 'Theme A (Mark Enterprises) - Unsigned / Unstamped Draft', company: 'me', type: 'all', sig: false, st: false },
      { name: 'Theme B (Marken Healthtech) - Unsigned / Unstamped Draft', company: 'healthtech', type: 'all', sig: false, st: false },
    ];

    setTestResults(testCases.map(t => ({ name: t.name, status: 'pending' })));

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      try {
        const res = await fetch('/api/preview-doc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyKey: tc.company,
            docType: tc.type,
            sampleData: {
              ...formData,
              showSignature: tc.sig !== undefined ? tc.sig : true,
              showStamp: tc.st !== undefined ? tc.st : true
            }
          })
        });
        const data = await res.json();
        setTestResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: data.success ? 'success' : 'failed' } : item));
      } catch {
        setTestResults(prev => prev.map((item, idx) => idx === i ? { ...item, status: 'failed' } : item));
      }
    }
    setRunningTests(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', color: '#f8fafc', overflow: 'hidden' }}>
      {/* Top Navbar */}
      <header style={{
        height: '56px',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        background: '#1e293b'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', textDecoration: 'none', fontSize: '13px', fontWeight: 500 }}>
            <ArrowLeft size={16} /> Back to Dashboard
          </Link>
          <div style={{ width: '1px', height: '18px', background: '#334155' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={18} style={{ color: '#38bdf8' }} />
            <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
              A4 Letterhead Print & PDF Live Preview
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => fetchPreview()}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              background: '#334155',
              border: 'none',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={handlePrint}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 16px',
              background: '#2563eb',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(37,99,235,0.4)'
            }}
          >
            <Printer size={15} /> Print / Export PDF
          </button>
        </div>
      </header>

      {/* Main Split Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar Controls */}
        <div style={{
          width: '380px',
          background: '#1e293b',
          borderRight: '1px solid #334155',
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px'
        }}>
          {/* Company Theme Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '8px', letterSpacing: '0.5px' }}>
              Select Company & Letterhead Theme
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                onClick={() => setCompanyKey('me')}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: `2px solid ${companyKey === 'me' ? '#38bdf8' : '#334155'}`,
                  background: companyKey === 'me' ? 'rgba(56, 189, 248, 0.12)' : '#0f172a',
                  color: companyKey === 'me' ? '#38bdf8' : '#94a3b8',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <div>Theme A</div>
                <div style={{ fontSize: '11px', fontWeight: 500, color: companyKey === 'me' ? '#e2e8f0' : '#64748b', marginTop: '2px' }}>
                  Mark Enterprises
                </div>
              </button>

              <button
                onClick={() => setCompanyKey('healthtech')}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: `2px solid ${companyKey === 'healthtech' ? '#38bdf8' : '#334155'}`,
                  background: companyKey === 'healthtech' ? 'rgba(56, 189, 248, 0.12)' : '#0f172a',
                  color: companyKey === 'healthtech' ? '#38bdf8' : '#94a3b8',
                  fontSize: '12.5px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <div>Theme B</div>
                <div style={{ fontSize: '11px', fontWeight: 500, color: companyKey === 'healthtech' ? '#e2e8f0' : '#64748b', marginTop: '2px' }}>
                  Marken Healthtech
                </div>
              </button>
            </div>
          </div>

          {/* Document Type Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '6px', letterSpacing: '0.5px' }}>
              Document Mode
            </label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                background: '#0f172a',
                border: '1px solid #334155',
                color: '#f8fafc',
                fontSize: '13px'
              }}
            >
              <option value="all">Full Package (All 20 Bid Documents)</option>
              <option value="spec">Technical Specification Compliance Sheet</option>
            </select>
          </div>

          {/* Signature & Stamp Toggles */}
          <div style={{ background: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#e2e8f0', marginBottom: '8px' }}>
              Signing & Stamping
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showSignature}
                  onChange={e => setShowSignature(e.target.checked)}
                />
                Include Authorized Signature Image
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showStamp}
                  onChange={e => setShowStamp(e.target.checked)}
                />
                Include Round Company Stamp (-8° rot)
              </label>
            </div>
          </div>

          {/* Editable Fields */}
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#94a3b8', marginBottom: '8px', letterSpacing: '0.5px' }}>
              Template Placeholders Data
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>Bid / Tender Number</label>
                <input
                  type="text"
                  value={formData.bidNumber}
                  onChange={e => setFormData({ ...formData, bidNumber: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', color: '#f8fafc', fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>Bid Date</label>
                <input
                  type="text"
                  value={formData.bidDate}
                  onChange={e => setFormData({ ...formData, bidDate: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', color: '#f8fafc', fontSize: '12px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>Product Description</label>
                <input
                  type="text"
                  value={formData.productDescription}
                  onChange={e => setFormData({ ...formData, productDescription: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', color: '#f8fafc', fontSize: '12px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>Model</label>
                  <input
                    type="text"
                    value={formData.offeredModel}
                    onChange={e => setFormData({ ...formData, offeredModel: e.target.value })}
                    style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', color: '#f8fafc', fontSize: '12px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>Quantity</label>
                  <input
                    type="text"
                    value={formData.qty}
                    onChange={e => setFormData({ ...formData, qty: e.target.value })}
                    style={{ width: '100%', padding: '6px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: '4px', color: '#f8fafc', fontSize: '12px' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Test Runner */}
          <div style={{ borderTop: '1px solid #334155', paddingTop: '14px' }}>
            <button
              onClick={handleRunTests}
              disabled={runningTests}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: runningTests ? '#475569' : '#047857',
                border: 'none',
                borderRadius: '6px',
                color: '#ffffff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {runningTests ? 'Running Automated Checks...' : 'Run Automated Visual-Regression Checks'}
            </button>

            {testResults.length > 0 && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {testResults.map((t, idx) => (
                  <div key={idx} style={{ fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: t.status === 'success' ? '#34d399' : t.status === 'failed' ? '#f87171' : '#94a3b8' }}>
                    <span>{t.name}</span>
                    <span>{t.status === 'success' ? '✓ Passed' : t.status === 'failed' ? '✗ Failed' : '...'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Preview Frame */}
        <div style={{ flex: 1, height: '100%', overflowY: 'auto', background: '#475569', display: 'flex', justifyContent: 'center', padding: '30px' }}>
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            title="A4 Document Preview"
            style={{
              width: '210mm',
              minHeight: '297mm',
              height: '100%',
              border: 'none',
              borderRadius: '4px',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.4)',
              background: '#ffffff'
            }}
          />
        </div>
      </div>
    </div>
  );
}
