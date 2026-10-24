"use client";

import React, { useState, useEffect } from 'react';
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Edit3,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Search,
  Check,
  X,
  ChevronRight,
  Sparkles
} from 'lucide-react';

interface SpecificationItem {
  id?: number;
  parameter_name: string;
  parameter_value: string;
  source_page?: string;
  raw_evidence?: string;
  is_verified?: boolean;
  display_order?: number;
}

interface ProductModel {
  id: number;
  model_number: string;
  make: string;
  product_category: string;
  description?: string;
  datasheet_path?: string;
  datasheet_original_filename?: string;
  status: string; // DRAFT, EXTRACTED, VERIFIED
  created_at?: string;
  updated_at?: string;
  verified_by?: string;
  verified_at?: string;
  total_specs?: number;
  verified_specs?: number;
  specifications?: SpecificationItem[];
}

interface ProductCatalogueProps {
  currentUser?: { username: string; role: string } | null;
  onSelectModel?: (model: ProductModel) => void;
  selectionMode?: boolean;
}

export default function ProductCatalogue({
  currentUser,
  onSelectModel,
  selectionMode = false
}: ProductCatalogueProps) {
  const [models, setModels] = useState<ProductModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [modelNumber, setModelNumber] = useState('');
  const [make, setMake] = useState('MarkEn');
  const [productCategory, setProductCategory] = useState('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // Detail / Review drawer state
  const [selectedModel, setSelectedModel] = useState<ProductModel | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [specItems, setSpecItems] = useState<SpecificationItem[]>([]);
  const [savingSpecs, setSavingSpecs] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchModels = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (categoryFilter) params.append('category', categoryFilter);
      if (statusFilter) params.append('status', statusFilter);

      const res = await fetch(`/api/products/models?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.models)) {
          setModels(data.models);
        }
      }
    } catch (e) {
      console.error('Failed to load models:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, [categoryFilter, statusFilter]);

  const handleOpenDetail = async (model: ProductModel) => {
    try {
      setLoadingDetails(true);
      setSelectedModel(model);
      const res = await fetch(`/api/products/models/${model.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.model) {
          setSelectedModel(data.model);
          setSpecItems(data.model.specifications || []);
        }
      }
    } catch (e) {
      console.error('Error fetching model details:', e);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setUploadError('Please select a manufacturer datasheet PDF.');
      return;
    }
    if (!uploadFile.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('File must be a PDF document.');
      return;
    }
    if (uploadFile.size > 50 * 1024 * 1024) {
      setUploadError('File exceeds 50MB limit.');
      return;
    }
    if (!modelNumber.trim()) {
      setUploadError('Model number is required.');
      return;
    }
    if (!productCategory.trim()) {
      setUploadError('Product category is required.');
      return;
    }

    setUploadError('');
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('model_number', modelNumber.trim());
      formData.append('make', make.trim() || 'MarkEn');
      formData.append('product_category', productCategory.trim());
      formData.append('description', description.trim());

      const res = await fetch('/api/products/models/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setUploadError(data.error || 'Failed to upload datasheet.');
        return;
      }

      showToast(data.message || 'Datasheet uploaded and specifications extracted.', 'success');
      setShowUploadModal(false);
      setUploadFile(null);
      setModelNumber('');
      setProductCategory('');
      setDescription('');
      fetchModels();

      if (data.model) {
        handleOpenDetail(data.model);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Network error uploading datasheet.');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveSpecs = async () => {
    if (!selectedModel) return;
    try {
      setSavingSpecs(true);
      const res = await fetch(`/api/products/models/${selectedModel.id}/specifications`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(specItems),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Specifications saved successfully.', 'success');
        setSelectedModel(data.model);
        setSpecItems(data.model.specifications || []);
        fetchModels();
      } else {
        showToast(data.error || 'Failed to save specifications.', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error saving specifications.', 'error');
    } finally {
      setSavingSpecs(false);
    }
  };

  const handleVerifyAll = async () => {
    if (!selectedModel) return;
    try {
      setVerifying(true);
      const res = await fetch(`/api/products/models/${selectedModel.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Product model verified! Specifications are now eligible for tender matching.', 'success');
        setSelectedModel(data.model);
        setSpecItems(data.model.specifications || []);
        fetchModels();
      } else {
        showToast(data.error || 'Failed to verify model.', 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Network error verifying model.', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleAddSpecRow = () => {
    setSpecItems(prev => [
      ...prev,
      {
        parameter_name: '',
        parameter_value: '',
        source_page: 'Page 1',
        raw_evidence: '',
        is_verified: true,
        display_order: prev.length + 1
      }
    ]);
  };

  const handleRemoveSpecRow = (index: number) => {
    setSpecItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSpecFieldChange = (index: number, field: keyof SpecificationItem, val: any) => {
    setSpecItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  };

  const filteredModels = models.filter(m => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.model_number.toLowerCase().includes(q) ||
      m.make.toLowerCase().includes(q) ||
      m.product_category.toLowerCase().includes(q) ||
      (m.description && m.description.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-xl border flex items-center space-x-3 transition-all ${
          notification.type === 'success'
            ? 'bg-emerald-950/90 text-emerald-200 border-emerald-800'
            : 'bg-rose-950/90 text-rose-200 border-rose-800'
        }`}>
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-rose-400" />}
          <span className="text-sm font-medium">{notification.message}</span>
        </div>
      )}

      {/* Header with Stats & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 backdrop-blur-md">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                Product Model Catalogue
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                  Evidence-Based
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload manufacturer datasheets, verify authoritative specifications, and automatically populate Column 4 with citations.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => fetchModels()}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Refresh catalogue"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-medium text-sm shadow-lg shadow-orange-500/20 transition active:scale-95"
          >
            <UploadCloud className="w-4 h-4" />
            <span>Upload Datasheet</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search by model number, make, category, or description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900/50 border border-slate-800 text-slate-200 placeholder-slate-500 text-sm focus:outline-none focus:border-orange-500/50 transition"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3.5 py-2 rounded-xl bg-slate-900/50 border border-slate-800 text-slate-300 text-sm focus:outline-none focus:border-orange-500/50 transition"
        >
          <option value="">All Statuses</option>
          <option value="VERIFIED">Verified Only</option>
          <option value="EXTRACTED">Extracted (Pending Review)</option>
          <option value="DRAFT">Draft</option>
        </select>
      </div>

      {/* Models Grid / List */}
      {loading ? (
        <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-500" />
          <p className="text-sm">Loading product models...</p>
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
          <FileText className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">No product models found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
            Upload manufacturer datasheets to extract technical parameters with source citations and enable automatic Column 4 population.
          </p>
          <button
            onClick={() => setShowUploadModal(true)}
            className="mt-4 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
          >
            Upload First Datasheet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModels.map(model => {
            const isVerified = model.status === 'VERIFIED';
            const totalSpecs = model.total_specs || 0;
            const verifiedSpecs = model.verified_specs || 0;

            return (
              <div
                key={model.id}
                className="group relative bg-slate-900/40 hover:bg-slate-900/80 p-5 rounded-2xl border border-slate-800/80 hover:border-orange-500/40 transition-all duration-200 flex flex-col justify-between shadow-sm hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                      {model.make}
                    </span>
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                      isVerified
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : model.status === 'EXTRACTED'
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                    }`}>
                      {model.status}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-100 group-hover:text-orange-400 transition-colors">
                    {model.model_number}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                    {model.product_category}
                  </p>
                  {model.description && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                      {model.description}
                    </p>
                  )}
                </div>

                <div className="mt-5 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">{verifiedSpecs}</span>
                    <span className="text-slate-500"> / {totalSpecs} specs verified</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    {selectionMode ? (
                      <button
                        onClick={() => onSelectModel && onSelectModel(model)}
                        className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium transition"
                      >
                        Select Model
                      </button>
                    ) : (
                      <button
                        onClick={() => handleOpenDetail(model)}
                        className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
                      >
                        <span>Review & Verify</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Datasheet Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative">
            <button
              onClick={() => setShowUploadModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-5">
              <div className="p-2.5 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20">
                <UploadCloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">Upload Manufacturer Datasheet</h3>
                <p className="text-xs text-slate-400">Extract structured specifications with source citations.</p>
              </div>
            </div>

            {uploadError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{uploadError}</span>
              </div>
            )}

            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Datasheet PDF File *
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={e => setUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-orange-500/10 file:text-orange-400 hover:file:bg-orange-500/20 cursor-pointer border border-slate-800 rounded-xl p-2 bg-slate-950"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Model Number *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ME-OTL-200"
                    value={modelNumber}
                    onChange={e => setModelNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-orange-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Make / Brand
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. MarkEn"
                    value={make}
                    onChange={e => setMake(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Product Category / Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Operation Theatre Light, Hospital Bed, Centrifuge..."
                  value={productCategory}
                  onChange={e => setProductCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-orange-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Description / Remarks
                </label>
                <textarea
                  rows={2}
                  placeholder="Brief equipment description or brochure notes..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-orange-500"
                />
              </div>

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 transition"
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white text-xs font-semibold shadow-lg shadow-orange-500/20 disabled:opacity-50 transition"
                >
                  {uploading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{uploading ? 'Extracting Specifications...' : 'Upload & Extract'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review & Verification Drawer / Modal */}
      {selectedModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-800 flex items-start justify-between bg-slate-950/50">
              <div>
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-bold text-slate-100">{selectedModel.model_number}</h3>
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                    selectedModel.status === 'VERIFIED'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                  }`}>
                    {selectedModel.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Make: <span className="text-slate-200">{selectedModel.make}</span> | Category: <span className="text-slate-200">{selectedModel.product_category}</span>
                </p>
                {selectedModel.verified_by && (
                  <p className="text-[11px] text-emerald-400/80 mt-0.5">
                    Verified by {selectedModel.verified_by} on {selectedModel.verified_at}
                  </p>
                )}
              </div>

              <div className="flex items-center space-x-2">
                {selectedModel.datasheet_path && (
                  <a
                    href={selectedModel.datasheet_path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                  >
                    <FileText className="w-3.5 h-3.5 text-orange-400" />
                    <span>View Datasheet PDF</span>
                    <ExternalLink className="w-3 h-3 text-slate-500" />
                  </a>
                )}
                <button
                  onClick={() => setSelectedModel(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Specifications Table */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">
                    Extracted Technical Specifications ({specItems.length})
                  </h4>
                  <p className="text-xs text-slate-500">
                    Review and verify each parameter. Only verified rows are used for automatic tender matching.
                  </p>
                </div>
                <button
                  onClick={handleAddSpecRow}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-orange-400 text-xs font-medium border border-slate-700 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Parameter</span>
                </button>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3 w-12 text-center">Verify</th>
                      <th className="py-2.5 px-3 w-48">Parameter Name</th>
                      <th className="py-2.5 px-3">Offered Value</th>
                      <th className="py-2.5 px-3 w-24">Source</th>
                      <th className="py-2.5 px-3 w-12 text-center">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {specItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/30 transition-colors">
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={item.is_verified || false}
                            onChange={e => handleSpecFieldChange(idx, 'is_verified', e.target.checked)}
                            className="w-4 h-4 rounded border-slate-700 text-orange-500 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={item.parameter_name}
                            onChange={e => handleSpecFieldChange(idx, 'parameter_name', e.target.value)}
                            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:border-orange-500 focus:outline-none"
                            placeholder="e.g. Illumination"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={item.parameter_value}
                            onChange={e => handleSpecFieldChange(idx, 'parameter_value', e.target.value)}
                            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:border-orange-500 focus:outline-none"
                            placeholder="e.g. 160,000 Lux"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            value={item.source_page || ''}
                            onChange={e => handleSpecFieldChange(idx, 'source_page', e.target.value)}
                            className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:border-orange-500 focus:outline-none"
                            placeholder="Page 1"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => handleRemoveSpecRow(idx)}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/70 flex items-center justify-between">
              <div className="text-xs text-slate-400">
                <span className="font-semibold text-emerald-400">
                  {specItems.filter(i => i.is_verified).length}
                </span>{' '}
                of {specItems.length} specifications verified
              </div>

              <div className="flex items-center space-x-3">
                <button
                  onClick={handleSaveSpecs}
                  disabled={savingSpecs}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                >
                  {savingSpecs ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={handleVerifyAll}
                  disabled={verifying}
                  className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 transition active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{verifying ? 'Verifying...' : 'Verify All & Authorize'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
