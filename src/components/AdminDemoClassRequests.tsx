import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { AdminProfile } from '../types';
import { getWhatsAppUrl } from '../lib/whatsapp';
import { PremiumDropdown } from './PremiumDropdown';

type DemoClassStatus = 'Pending' | 'Contacted' | 'Scheduled' | 'Completed' | 'Cancelled';

interface DemoClassRequest {
  id: string;
  full_name: string;
  mobile: string;
  email: string;
  qualification_category: 'Student' | 'Graduate' | 'Working';
  parent_name: string | null;
  school_or_college_name: string | null;
  college_name: string | null;
  profession: string | null;
  educational_qualification: string;
  date_of_birth: string;
  address: string;
  city: string;
  additional_information: string | null;
  status: DemoClassStatus;
  created_at: string;
}

interface AdminDemoClassRequestsProps {
  currentAdmin: AdminProfile;
  onRequestsChanged: () => void;
  onSessionExpired: () => void;
  refreshToken: number;
}

const demoStatuses: DemoClassStatus[] = ['Pending', 'Contacted', 'Scheduled', 'Completed', 'Cancelled'];

const statusStyles: Record<DemoClassStatus, string> = {
  Pending: 'border-amber-200 bg-amber-50 text-amber-800',
  Contacted: 'border-blue-200 bg-blue-50 text-blue-800',
  Scheduled: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  Completed: 'border-violet-200 bg-violet-50 text-violet-800',
  Cancelled: 'border-slate-200 bg-slate-100 text-slate-700',
};

const formatDate = (value: string) => new Date(value).toLocaleString('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const AdminDemoClassRequests: React.FC<AdminDemoClassRequestsProps> = ({
  currentAdmin,
  onRequestsChanged,
  onSessionExpired,
  refreshToken,
}) => {
  const [requests, setRequests] = useState<DemoClassRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [requestToDelete, setRequestToDelete] = useState<DemoClassRequest | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | DemoClassStatus>('All');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canDelete = currentAdmin.role === 'admin' || currentAdmin.role === 'super_admin';

  const authHeaders = (): HeadersInit => ({
    Authorization: `Bearer ${currentAdmin.accessToken || sessionStorage.getItem('uptrends_access_token') || ''}`,
  });

  const loadRequests = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/demo-class-requests', { headers: authHeaders() });
      if (response.status === 401) onSessionExpired();
      const data = await response.json() as DemoClassRequest[] | { error?: string };
      if (!response.ok) {
        throw new Error(!Array.isArray(data) ? data.error || 'Unable to load demo requests.' : 'Unable to load demo requests.');
      }
      if (!Array.isArray(data)) throw new Error('The demo requests response was invalid.');
      setRequests(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load demo requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, [currentAdmin.id, refreshToken]);

  const changeStatus = async (request: DemoClassRequest, status: DemoClassStatus) => {
    setSavingId(request.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/admin/demo-class-requests/${encodeURIComponent(request.id)}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.status === 401) onSessionExpired();
      const result = await response.json() as DemoClassRequest | { error?: string };
      if (!response.ok || !('id' in result)) {
        throw new Error(!('id' in result) ? result.error || 'Unable to update demo request status.' : 'Unable to update demo request status.');
      }
      setRequests((current) => current.map((item) => item.id === request.id ? result : item));
      setSuccess(`Request status updated to ${status}.`);
      onRequestsChanged();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update demo request status.');
    } finally {
      setSavingId(null);
    }
  };

  const deleteRequest = async () => {
    if (!requestToDelete || !canDelete || deletingId) return;
    const request = requestToDelete;
    setDeletingId(request.id);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/admin/demo-class-requests/${encodeURIComponent(request.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (response.status === 401) onSessionExpired();
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Unable to delete demo class request.');
      }
      setRequests((current) => current.filter((item) => item.id !== request.id));
      setRequestToDelete(null);
      setSuccess('Demo class request deleted successfully.');
      onRequestsChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete demo class request.');
    } finally {
      setDeletingId(null);
    }
  };

  const counts = {
    total: requests.length,
    pending: requests.filter((request) => request.status === 'Pending').length,
    approved: requests.filter((request) => request.status === 'Scheduled').length,
    completed: requests.filter((request) => request.status === 'Completed').length,
  };

  const query = search.trim().toLowerCase();
  const filteredRequests = requests.filter((request) => {
    const searchable = [
      request.full_name,
      request.mobile,
      request.email,
      request.qualification_category,
      request.educational_qualification,
      request.parent_name || '',
      request.school_or_college_name || '',
      request.college_name || '',
      request.profession || '',
      request.city,
    ];
    return (statusFilter === 'All' || request.status === statusFilter)
      && searchable.some((value) => value.toLowerCase().includes(query));
  });

  const summaryCards = [
    { label: 'Total Requests', value: counts.total, note: 'All received requests', Icon: Users, tone: 'border-blue-100 bg-blue-50 text-blue-800', iconTone: 'bg-blue-100 text-blue-700' },
    { label: 'Pending Requests', value: counts.pending, note: 'Awaiting follow-up', Icon: Clock3, tone: 'border-orange-100 bg-orange-50 text-orange-800', iconTone: 'bg-orange-100 text-orange-700' },
    { label: 'Approved Requests', value: counts.approved, note: 'Currently marked Scheduled', Icon: BadgeCheck, tone: 'border-emerald-100 bg-emerald-50 text-emerald-800', iconTone: 'bg-emerald-100 text-emerald-700' },
    { label: 'Completed Requests', value: counts.completed, note: 'Demo classes completed', Icon: CheckCircle2, tone: 'border-violet-100 bg-violet-50 text-violet-800', iconTone: 'bg-violet-100 text-violet-700' },
  ];

  return (
    <section className="space-y-4 rounded-3xl bg-[#FFF9F2] p-1 sm:space-y-6 sm:p-2">
      <header className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-[#0B1F4D] via-[#123365] to-[#1B4778] p-4 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/10 text-orange-300 ring-1 ring-white/15 sm:h-12 sm:w-12">
            <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-200">Student Engagement</p>
            <h1 className="mt-1 text-lg font-extrabold sm:text-2xl">Demo Class Requests</h1>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-blue-100 sm:text-sm">
              Review enquiries, coordinate a demo session, and keep each request moving.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadRequests()}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-300 disabled:opacity-60 sm:min-h-11 sm:self-auto sm:px-4 sm:py-2.5"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh Requests
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {summaryCards.map(({ label, value, note, Icon, tone, iconTone }) => (
          <article key={label} className={`rounded-2xl border p-3 shadow-sm sm:p-5 ${tone}`}>
            <div className="flex items-start justify-between gap-2 sm:gap-3">
              <div>
                <p className="text-[10px] font-bold leading-tight sm:text-xs">{label}</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight text-[#0B1F4D] sm:mt-2 sm:text-3xl">
                  {loading ? <span className="inline-block h-7 w-8 animate-pulse rounded bg-current/10 sm:h-9 sm:w-10" aria-label="Loading count" /> : value}
                </p>
                <p className="mt-1 text-[9px] leading-tight opacity-80 sm:text-[11px]">{note}</p>
              </div>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl sm:h-10 sm:w-10 ${iconTone}`}>
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
              </span>
            </div>
          </article>
        ))}
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => void loadRequests()} disabled={loading} className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-60">
            Try again
          </button>
        </div>
      )}
      {success && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          {success}
        </div>
      )}

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:p-4">
        <label className="relative block">
          <span className="sr-only">Search demo requests</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search name, phone, email, qualification, or city"
            className="min-h-11 w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
          />
        </label>
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 sm:justify-start">
          <span>Status</span>
          <PremiumDropdown
            aria-label="Filter demo requests by status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'All' | DemoClassStatus)}
            className="min-h-9 min-w-32 rounded-lg bg-white px-2 text-sm text-[#0B1F4D] outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            options={[
              { value: 'All', label: 'All statuses' },
              ...demoStatuses.map((status) => ({ value: status, label: status })),
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div role="status" className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-sm font-medium text-slate-500 shadow-sm">
          <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-orange-600" aria-hidden="true" />
          Loading demo class requests…
        </div>
      ) : error && requests.length === 0 ? null : filteredRequests.length ? (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left">
                <thead className="bg-[#F4F7FB] text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3.5">Student</th>
                    <th scope="col" className="px-4 py-3.5">Contact</th>
                    <th scope="col" className="px-4 py-3.5">Qualification</th>
                    <th scope="col" className="px-4 py-3.5">Submitted</th>
                    <th scope="col" className="px-4 py-3.5">Status</th>
                    <th scope="col" className="px-4 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRequests.map((request) => (
                    <tr key={request.id} className="align-top transition-colors hover:bg-orange-50/40">
                      <td className="px-5 py-4">
                        <p className="font-bold text-[#0B1F4D]">{request.full_name}</p>
                        <p className="mt-1 text-xs text-slate-500">{request.qualification_category} · {request.city}</p>
                      </td>
                      <td className="max-w-56 px-4 py-4 text-xs">
                        <div className="flex items-center gap-1.5">
                          <a href={`tel:${request.mobile}`} aria-label={`Call ${request.mobile}`} title="Call" className="shrink-0 text-emerald-700 hover:text-emerald-800">
                            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                          </a>
                          {getWhatsAppUrl(request.mobile) ? (
                            <a href={getWhatsAppUrl(request.mobile)!} target="_blank" rel="noopener noreferrer" aria-label={`Chat with ${request.mobile} on WhatsApp`} onClick={(event) => event.stopPropagation()} className="font-semibold text-slate-700 hover:text-emerald-700">
                              {request.mobile}
                            </a>
                          ) : (
                            <span className="font-semibold text-slate-700">{request.mobile}</span>
                          )}
                        </div>
                        {request.email && (
                          <a href={`mailto:${request.email}`} className="mt-1.5 flex items-center gap-1.5 break-all text-slate-500 hover:text-orange-700">
                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{request.email}
                          </a>
                        )}
                      </td>
                      <td className="max-w-48 px-4 py-4 text-xs text-slate-700">
                        <p className="font-semibold">{request.educational_qualification}</p>
                        <p className="mt-1 text-slate-500">{request.profession || request.college_name || request.school_or_college_name || '—'}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-600">{formatDate(request.created_at)}                      </td>
                      <td className="px-4 py-4">
                        <div className="min-w-32">
                          <PremiumDropdown
                            id={`demo-status-${request.id}`}
                            value={request.status}
                            disabled={savingId === request.id || deletingId === request.id}
                            onChange={(value) => void changeStatus(request, value as DemoClassStatus)}
                            className={`block min-h-10 w-full rounded-lg border px-2.5 text-xs font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-60 ${statusStyles[request.status]}`}
                            aria-label={`Status for ${request.full_name}`}
                            options={demoStatuses.map((status) => ({ value: status, label: status }))}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setRequestToDelete(request)}
                              disabled={savingId === request.id || deletingId !== null}
                              aria-label={`Delete request from ${request.full_name}`}
                              className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-600 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="demo-class-request-list grid gap-3 lg:grid-cols-2 xl:hidden">
            {filteredRequests.map((request) => (
              <article key={request.id} className="demo-class-request-card space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-[#0B1F4D]">{request.full_name}</h2>
                    <p className="mt-1 text-xs text-slate-500">{request.qualification_category} · {request.city}</p>
                  </div>
                  <div className="w-32 shrink-0 space-y-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    <span className="block">Status</span>
                    <PremiumDropdown
                      aria-label={`Status for ${request.full_name}`}
                      value={request.status}
                      disabled={savingId === request.id || deletingId === request.id}
                      onChange={(value) => void changeStatus(request, value as DemoClassStatus)}
                      className={`min-h-9 w-full rounded-lg border px-2 text-xs font-bold normal-case tracking-normal outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-60 ${statusStyles[request.status]}`}
                      options={demoStatuses.map((status) => ({ value: status, label: status }))}
                    />
                  </div>
                </div>
                <div className="grid gap-3 text-xs sm:grid-cols-2">
                  <div className="flex min-w-0 items-center gap-2 break-all">
                    <a href={`tel:${request.mobile}`} aria-label={`Call ${request.mobile}`} title="Call" className="shrink-0 text-emerald-700 hover:text-emerald-800">
                      <Phone className="h-4 w-4" aria-hidden="true" />
                    </a>
                    {getWhatsAppUrl(request.mobile) ? (
                      <a href={getWhatsAppUrl(request.mobile)!} target="_blank" rel="noopener noreferrer" aria-label={`Chat with ${request.mobile} on WhatsApp`} onClick={(event) => event.stopPropagation()} className="min-w-0 font-semibold text-slate-700 hover:text-emerald-700">
                        {request.mobile}
                      </a>
                    ) : (
                      <span className="min-w-0 font-semibold text-slate-700">{request.mobile}</span>
                    )}
                  </div>
                  {request.email && (
                    <a href={`mailto:${request.email}`} className="flex min-w-0 items-center gap-2 break-all text-slate-600 hover:text-orange-700">
                      <Mail className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />{request.email}
                    </a>
                  )}
                  <p className="flex items-start gap-2 text-slate-700">
                    <GraduationCap className="h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
                    <span><span className="font-semibold">{request.educational_qualification}</span><span className="mt-0.5 block text-slate-500">{request.profession || request.college_name || request.school_or_college_name || '—'}</span></span>
                  </p>
                  <p className="flex items-start gap-2 text-slate-600">
                    <CalendarDays className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
                    <span>Submitted {formatDate(request.created_at)}</span>
                  </p>
                  {request.city && <p className="flex items-start gap-2 text-slate-600"><MapPin className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />{request.city}</p>}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => setRequestToDelete(request)}
                      disabled={savingId === request.id || deletingId !== null}
                      className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />Delete
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center shadow-sm">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-600">
            <GraduationCap className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-bold text-[#0B1F4D]">
            {requests.length ? 'No matching requests' : 'No demo requests yet'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
            {requests.length
              ? 'Try adjusting your search or status filter.'
              : 'New demo class enquiries will appear here when students submit the booking form.'}
          </p>
        </div>
      )}

      {requestToDelete && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingId) setRequestToDelete(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-demo-request-title"
            aria-describedby="delete-demo-request-description"
            className="w-full max-w-md space-y-5 rounded-2xl border border-rose-100 bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700">
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="delete-demo-request-title" className="font-extrabold text-[#0B1F4D]">Delete demo request?</h2>
                <p id="delete-demo-request-description" className="mt-2 text-sm leading-relaxed text-slate-600">
                  Are you sure you want to delete this demo class request? This action cannot be undone.
                </p>
                <p className="mt-2 text-sm font-bold text-slate-800">{requestToDelete.full_name}</p>
              </div>
              <button
                type="button"
                aria-label="Close delete confirmation"
                disabled={Boolean(deletingId)}
                onClick={() => setRequestToDelete(null)}
                className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={() => setRequestToDelete(null)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteRequest()}
                disabled={Boolean(deletingId)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:cursor-wait disabled:opacity-60"
              >
                {deletingId ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {deletingId ? 'Deleting…' : 'Delete Request'}
              </button>
            </div>
          </section>
        </div>
      )}

    </section>
  );
};
