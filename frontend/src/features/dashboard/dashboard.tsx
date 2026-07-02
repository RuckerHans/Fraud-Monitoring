'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { yesterday } from '@/lib/dates';
import type { Branch, ReportParams, Transaction } from '@/lib/types';
import {
  baseUrl,
  useGetBranchesQuery,
  useGetMeQuery,
  useLazyGetMeQuery,
  useLazyGetTransactionsQuery,
  useLoginMutation,
} from '@/store/api';

const money = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
});

function authToken(result: Record<string, unknown>): string | undefined {
  const user = result.user as Record<string, unknown> | undefined;
  return [result.access_token, result.accessToken, result.token, user?.token].find(
    (value): value is string => typeof value === 'string',
  );
}

function requestErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: number | string; data?: unknown };
  const data = value.data as { message?: string | string[] } | undefined;
  const message = Array.isArray(data?.message) ? data.message.join(' ') : data?.message;
  if (message) return message;
  if (value.status === 401) return 'Your session expired. Sign in again.';
  if (value.status === 408) return 'The selected branches could not be reached.';
  return 'The report request failed. Check branch connectivity and try again.';
}

export function Dashboard() {
  const defaultDate = yesterday();
  const [draft, setDraft] = useState({
    branchIds: [] as string[],
    from: defaultDate,
    to: defaultDate,
    exception: 'returnedOrVoided' as ReportParams['exception'],
    points: '',
  });
  const [applied, setApplied] = useState<ReportParams | null>(null);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [queryCancelled, setQueryCancelled] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const initializedBranches = useRef(false);
  const reportRequest = useRef<{ abort: () => void } | null>(null);
  const {
    currentData: currentUser,
    isLoading: checkingSession,
    refetch: recheckSession,
  } = useGetMeQuery(undefined, { pollingInterval: 60_000, refetchOnFocus: true });
  const signedIn = Boolean(currentUser) && !sessionExpired;
  const { data: branches = [], isLoading: loadingBranches, isError: branchError } =
    useGetBranchesQuery(undefined, { skip: !signedIn });
  const [
    loadTransactions,
    { data: report, isFetching, error: reportError },
  ] = useLazyGetTransactionsQuery();
  const onlineBranches = useMemo(
    () => branches.filter((branch) => branch.online),
    [branches],
  );
  const selectedBranches = useMemo(
    () => branches.filter((branch) => draft.branchIds.includes(branch.id)),
    [branches, draft.branchIds],
  );

  useEffect(() => {
    if (initializedBranches.current || onlineBranches.length === 0) return;
    initializedBranches.current = true;
    const ids = onlineBranches.map((branch) => branch.id);
    setDraft((current) => ({ ...current, branchIds: ids }));
  }, [onlineBranches]);

  useEffect(() => {
    if (!currentUser?.expiresAt) return;
    const expire = () => {
      window.localStorage.removeItem('fraud-monitoring-token');
      setSessionExpired(true);
      setAccountOpen(false);
      void recheckSession();
    };
    let timer: number | undefined;
    const schedule = () => {
      const remaining = currentUser.expiresAt * 1_000 - Date.now();
      if (remaining <= 0) {
        expire();
        return;
      }
      timer = window.setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [currentUser?.expiresAt, recheckSession]);

  useEffect(() => () => reportRequest.current?.abort(), []);

  const stats = useMemo(() => {
    const rows = report?.data ?? [];
    return {
      returned: rows.filter((row) => row.returned).length,
      voided: rows.filter((row) => row.voided).length,
      points: rows.reduce((sum, row) => sum + row.pointsRedeemed, 0),
    };
  }, [report]);
  const groupedResults = useMemo(() => {
    const groups = new Map<string, {
      branchId: string;
      branchCode: string;
      branchLocation: string;
      rows: Transaction[];
    }>();
    for (const row of report?.data ?? []) {
      const group = groups.get(row.branchId);
      if (group) {
        group.rows.push(row);
      } else {
        groups.set(row.branchId, {
          branchId: row.branchId,
          branchCode: row.branchCode,
          branchLocation: row.branchLocation,
          rows: [row],
        });
      }
    }
    return [...groups.values()].sort((left, right) =>
      left.branchLocation.localeCompare(right.branchLocation),
    );
  }, [report]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (!draft.branchIds.length) return;
    const params: ReportParams = {
      branchIds: draft.branchIds,
      branchLocations: Object.fromEntries(
        selectedBranches.map((branch) => [branch.id, branch.location]),
      ),
      from: draft.from,
      to: draft.to,
      page: 1,
      pageSize: 50,
      points: draft.points ? (draft.points as ReportParams['points']) : undefined,
      exception: draft.exception,
    };
    reportRequest.current?.abort();
    setQueryCancelled(false);
    setNotice('');
    setApplied(params);
    reportRequest.current = loadTransactions(params);
  }

  async function exportReport() {
    if (!applied) return;
    setExporting(true);
    setNotice('');
    try {
      const params = new URLSearchParams();
      Object.entries(applied).forEach(([key, value]) => {
        if (
          value !== undefined &&
          !['page', 'pageSize', 'branchLocations'].includes(key)
        ) {
          params.set(key, Array.isArray(value) ? value.join(',') : String(value));
        }
      });
      const token = window.localStorage.getItem('fraud-monitoring-token');
      const response = await fetch(`${baseUrl}/reports/transactions/export?${params}`, {
        credentials: 'include',
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `fraud-monitoring-${applied.from}-to-${applied.to}.xlsx`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      setNotice('Export could not be completed. Check your session and branch connection.');
    } finally {
      setExporting(false);
    }
  }

  function changePage(page: number) {
    if (!applied) return;
    const params = { ...applied, page };
    reportRequest.current?.abort();
    setQueryCancelled(false);
    setApplied(params);
    reportRequest.current = loadTransactions(params);
  }

  function cancelReport() {
    reportRequest.current?.abort();
    reportRequest.current = null;
    setQueryCancelled(true);
    setNotice('Report request cancelled.');
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <Image src="/icon.svg" width={38} height={38} alt="" priority />
          <div>
            <strong>Transaction review</strong>
            <span>Fraud Monitoring</span>
          </div>
        </div>
        <div className="top-actions">
          <button
            className="header-export"
            onClick={exportReport}
            disabled={!report || exporting}
          >
            {exporting ? 'Preparing…' : 'Export .xlsx'}
          </button>
          <span className="live-dot">Systems live</span>
          <button
            className="avatar"
            onClick={() => setAccountOpen((open) => !open)}
            aria-label="Open account menu"
            aria-expanded={accountOpen}
          >
            {currentUser?.username?.slice(0, 2).toUpperCase() ?? 'AU'}
          </button>
          {accountOpen && currentUser && (
            <div className="account-menu">
              <span>Signed in as</span>
              <strong>{currentUser.username}</strong>
              <small>
                Session expires {new Date(currentUser.expiresAt * 1_000).toLocaleString('en-PH')}
              </small>
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem('fraud-monitoring-token');
                  window.location.reload();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="shell">
        <form className="filter-card" onSubmit={applyFilters}>
          <div className="branch-summary">
            <div className="branch-summary-icon" aria-hidden="true">▦</div>
            <div>
              <span>Branch scope</span>
              <strong>
                {loadingBranches
                  ? 'Loading branches…'
                  : draft.branchIds.length === onlineBranches.length
                    ? `All ${onlineBranches.length} online branches`
                    : `${draft.branchIds.length} selected branch${draft.branchIds.length === 1 ? '' : 'es'}`}
              </strong>
              <small>
                {selectedBranches.length > 0 && selectedBranches.length <= 3
                  ? selectedBranches.map((branch) => branch.location).join(', ')
                  : 'Choose all online locations or a smaller custom set.'}
              </small>
            </div>
            <button type="button" onClick={() => setBranchModalOpen(true)}>
              Choose branches
            </button>
          </div>
          <label>
            <span>From</span>
            <input
              type="date"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
              required
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="date"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
              required
            />
          </label>
          <label>
            <span>Exception</span>
            <select
              value={draft.exception}
              onChange={(event) => setDraft({
                ...draft,
                exception: event.target.value as ReportParams['exception'],
              })}
            >
              <option value="returnedOrVoided">Returned and voided</option>
              <option value="returned">Returned only</option>
              <option value="voided">Voided only</option>
              <option value="all">All activity</option>
            </select>
          </label>
          <label>
            <span>Points</span>
            <select
              value={draft.points}
              onChange={(event) => setDraft({ ...draft, points: event.target.value })}
            >
              <option value="">Any points activity</option>
              <option value="earned">Earned</option>
              <option value="redeemed">Redeemed</option>
            </select>
          </label>
          <button className="primary" type="submit" disabled={!draft.branchIds.length || isFetching}>
            {isFetching ? 'Querying…' : 'Run report'}
          </button>
        </form>

        {(branchError || (reportError && !queryCancelled) || notice || report?.warnings.length) && (
          <div className="alert">
            {notice ||
              (branchError
                ? 'The branch directory is unavailable.'
                : reportError && !queryCancelled
                  ? requestErrorMessage(reportError)
                  : `${report?.warnings.length} branch${report?.warnings.length === 1 ? '' : 'es'} could not be queried: ${report?.warnings.join(' ')}`)}
          </div>
        )}

        <section className="stats" aria-label="Current page summary">
          <article>
            <span className="stat-icon amber">↩</span>
            <div><small>Returns on page</small><strong>{stats.returned}</strong></div>
          </article>
          <article>
            <span className="stat-icon red">×</span>
            <div><small>Voids on page</small><strong>{stats.voided}</strong></div>
          </article>
          <article>
            <span className="stat-icon blue">◆</span>
            <div><small>Points redeemed</small><strong>{stats.points.toLocaleString()}</strong></div>
          </article>
          <article>
            <span className="stat-icon slate">#</span>
            <div><small>Matching records</small><strong>{report?.meta.total ?? 0}</strong></div>
          </article>
        </section>

        <section className="results-section">
          <div className="results-heading">
            <div>
              <h2>Transaction results</h2>
              <p>
                {selectedBranches.length
                  ? `${selectedBranches.length} selected branch${selectedBranches.length > 1 ? 'es' : ''} · ${draft.from} to ${draft.to}`
                  : 'Choose one or more branches to begin'}
              </p>
            </div>
            {report?.data.length ? (
              <span>{groupedResults.length} branch group{groupedResults.length === 1 ? '' : 's'} on this page</span>
            ) : null}
          </div>

          {!groupedResults.length ? (
            <div className="results-empty">
              <span aria-hidden="true">⌕</span>
              <strong>No results to display</strong>
              <p>Run a report to view returned and voided transactions grouped by branch.</p>
            </div>
          ) : (
            <div className="branch-results">
              {groupedResults.map((group) => {
                const returnCount = group.rows.filter((row) => row.returned).length;
                const voidCount = group.rows.filter((row) => row.voided).length;
                return (
                  <article className="branch-result-card" key={group.branchId}>
                    <header className="branch-result-header">
                      <div className="branch-result-identity">
                        <span aria-hidden="true">{group.branchCode.slice(0, 2)}</span>
                        <div>
                          <small>{group.branchCode}</small>
                          <h3>{group.branchLocation}</h3>
                        </div>
                      </div>
                      <div className="branch-result-metrics">
                        <span><strong>{group.rows.length}</strong> records</span>
                        <span className="return"><strong>{returnCount}</strong> returned</span>
                        <span className="void"><strong>{voidCount}</strong> voided</span>
                      </div>
                    </header>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Transaction</th><th>Customer</th><th>Amount</th><th>Date & time</th>
                            <th>Cashier / terminal</th><th>Status</th><th>Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row) => (
                            <tr key={`${row.branchId}-${row.transactionNo}`}>
                              <td className="mono">{row.transactionNo}</td>
                              <td>{row.customerName || row.customerCode || 'Walk-in'}</td>
                              <td className="amount">{money.format(row.amount)}</td>
                              <td>{new Date(row.logDate).toLocaleString('en-PH')}</td>
                              <td>{row.userId || '—'} <span className="muted">/ {row.terminalNo || '—'}</span></td>
                              <td>
                                <div className="badges">
                                  {row.returned && <span className="badge return">Returned</span>}
                                  {row.voided && <span className="badge void">Voided</span>}
                                  {!row.returned && !row.voided && <span className="badge clear">Clear</span>}
                                </div>
                              </td>
                              <td>
                                <span className="earned">+{row.pointsEarned}</span>
                                <span className="redeemed"> −{row.pointsRedeemed}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {report && report.meta.totalPages > 1 && (
            <div className="pagination">
              <span>Page {report.meta.page} of {report.meta.totalPages}</span>
              <div>
                <button onClick={() => changePage(report.meta.page - 1)} disabled={report.meta.page <= 1}>Previous</button>
                <button onClick={() => changePage(report.meta.page + 1)} disabled={report.meta.page >= report.meta.totalPages}>Next</button>
              </div>
            </div>
          )}
        </section>
      </section>
      {branchModalOpen && signedIn && (
        <BranchPickerModal
          branches={branches}
          selectedIds={draft.branchIds}
          close={() => setBranchModalOpen(false)}
          apply={(branchIds) => {
            setDraft((current) => ({ ...current, branchIds }));
            setBranchModalOpen(false);
          }}
        />
      )}
      {isFetching && applied && !queryCancelled && (
        <ReportLoadingModal
          branchCount={applied.branchIds.length}
          from={applied.from}
          to={applied.to}
          cancel={cancelReport}
        />
      )}
      {checkingSession && !sessionExpired ? (
        <SessionCheck />
      ) : (
        !signedIn && (
          <LoginDialog
            message={sessionExpired ? 'Your session expired. Sign in again to continue.' : undefined}
            authenticated={() => {
              setSessionExpired(false);
            }}
          />
        )
      )}
    </main>
  );
}

function ReportLoadingModal({
  branchCount,
  from,
  to,
  cancel,
}: {
  branchCount: number;
  from: string;
  to: string;
  cancel: () => void;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - started) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(
    elapsedSeconds % 60,
  ).padStart(2, '0')}`;

  return (
    <div className="modal-backdrop query-backdrop">
      <section
        className="query-progress-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="query-progress-title"
      >
        <div className="query-progress-visual" aria-hidden="true">
          <span className="query-progress-ring" />
          <span>FM</span>
        </div>
        <p className="eyebrow">Branch report in progress</p>
        <h2 id="query-progress-title">Reading transaction activity</h2>
        <p>
          Querying {branchCount} selected branch{branchCount === 1 ? '' : 'es'} in
          parallel. Slow local servers may take several minutes.
        </p>
        <div className="query-progress-meta">
          <div>
            <span>Date range</span>
            <strong>{from} → {to}</strong>
          </div>
          <div>
            <span>Elapsed</span>
            <strong>{elapsed}</strong>
          </div>
        </div>
        <div className="query-progress-track"><span /></div>
        <button type="button" className="query-cancel" onClick={cancel}>
          Cancel request
        </button>
      </section>
    </div>
  );
}

function BranchPickerModal({
  branches,
  selectedIds,
  close,
  apply,
}: {
  branches: Branch[];
  selectedIds: string[];
  close: () => void;
  apply: (branchIds: string[]) => void;
}) {
  const onlineBranches = useMemo(
    () => branches.filter((branch) => branch.online),
    [branches],
  );
  const initiallyAll =
    onlineBranches.length > 0 &&
    onlineBranches.every((branch) => selectedIds.includes(branch.id));
  const [mode, setMode] = useState<'all' | 'specific'>(initiallyAll ? 'all' : 'specific');
  const [selection, setSelection] = useState(selectedIds);
  const [search, setSearch] = useState('');
  const filteredBranches = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return branches;
    return branches.filter((branch) =>
      `${branch.location} ${branch.code}`.toLowerCase().includes(value),
    );
  }, [branches, search]);

  function chooseMode(nextMode: 'all' | 'specific') {
    setMode(nextMode);
    setSelection(nextMode === 'all' ? onlineBranches.map((branch) => branch.id) : []);
    if (nextMode === 'all') setSearch('');
  }

  function toggleBranch(branchId: string) {
    setSelection((current) =>
      current.includes(branchId)
        ? current.filter((id) => id !== branchId)
        : [...current, branchId],
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <section
        className="branch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="branch-modal-header">
          <div>
            <p className="eyebrow">Report scope</p>
            <h2 id="branch-modal-title">Choose branches</h2>
            <p>Select all online locations or build a smaller report set.</p>
          </div>
          <button type="button" className="close" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="branch-mode-grid">
          <button
            type="button"
            className={mode === 'all' ? 'branch-mode selected' : 'branch-mode'}
            onClick={() => chooseMode('all')}
          >
            <span className="mode-icon">▦</span>
            <span>
              <strong>All online branches</strong>
              <small>Query all {onlineBranches.length} reporting locations in parallel.</small>
            </span>
            {mode === 'all' && <b aria-hidden="true">✓</b>}
          </button>
          <button
            type="button"
            className={mode === 'specific' ? 'branch-mode selected' : 'branch-mode'}
            onClick={() => chooseMode('specific')}
          >
            <span className="mode-icon">⌕</span>
            <span>
              <strong>Specific branches</strong>
              <small>Search and select only the locations you need.</small>
            </span>
            {mode === 'specific' && <b aria-hidden="true">✓</b>}
          </button>
        </div>
        {mode === 'specific' && (
          <div className="specific-branches">
            <div className="branch-toolbar">
              <label className="branch-search">
                <span className="sr-only">Search branches</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by location or code…"
                  autoFocus
                />
              </label>
              <span>{selection.length} selected</span>
              <button
                type="button"
                onClick={() => setSelection(onlineBranches.map((branch) => branch.id))}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelection([])}
                disabled={!selection.length}
              >
                Clear
              </button>
            </div>
            <div className="branch-card-grid">
              {filteredBranches.length ? filteredBranches.map((branch) => {
                const selected = selection.includes(branch.id);
                return (
                  <button
                    type="button"
                    key={branch.id}
                    className={`branch-card${selected ? ' selected' : ''}${branch.online ? '' : ' offline'}`}
                    onClick={() => toggleBranch(branch.id)}
                    disabled={!branch.online}
                    aria-pressed={selected}
                  >
                    <span>{branch.code}</span>
                    <strong>{branch.location}</strong>
                    {selected && <b aria-hidden="true">✓</b>}
                    {!branch.online && <em>Offline</em>}
                  </button>
                );
              }) : (
                <span className="branch-loading">No branches match your search.</span>
              )}
            </div>
          </div>
        )}
        <div className="branch-modal-footer">
          <span>
            {selection.length} branch{selection.length === 1 ? '' : 'es'} selected
          </span>
          <div>
            <button type="button" className="secondary" onClick={close}>Cancel</button>
            <button
              type="button"
              className="primary"
              onClick={() => apply(selection)}
              disabled={!selection.length}
            >
              Apply selection
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function LoginDialog({
  close,
  message,
  authenticated,
}: {
  close?: () => void;
  message?: string;
  authenticated: () => void;
}) {
  const [login, { isLoading }] = useLoginMutation();
  const [verifySession, { isFetching: isVerifying }] = useLazyGetMeQuery();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    let tokenIssued = false;
    try {
      const result = await login({ username, password }).unwrap();
      tokenIssued = true;
      const token = authToken(result);
      if (token) {
        window.localStorage.setItem('fraud-monitoring-token', token);
      } else {
        window.localStorage.removeItem('fraud-monitoring-token');
      }
      await verifySession().unwrap();
      authenticated();
    } catch {
      window.localStorage.removeItem('fraud-monitoring-token');
      setError(
        tokenIssued
          ? 'Sign-in succeeded but the issued session could not be verified. Restart the backend and try again.'
          : 'Sign-in failed. Check your credentials and try again.',
      );
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form className="login-card" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        {close && <button type="button" className="close" onClick={close}>×</button>}
        <p className="eyebrow">Secure authentication</p>
        <h2>Sign in</h2>
        <p>Your credentials are checked against the existing internal monitoring account table.</p>
        {message && <div className="session-message">{message}</div>}
        <label><span>Username</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required /></label>
        <label>
          <span>Password</span>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="password-toggle">
          <input
            type="checkbox"
            checked={showPassword}
            onChange={(event) => setShowPassword(event.target.checked)}
          />
          <span>Show password</span>
        </label>
        {error && <div className="login-error" role="alert">{error}</div>}
        <button className="primary" disabled={isLoading || isVerifying}>
          {isLoading ? 'Signing in…' : isVerifying ? 'Verifying session…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

function SessionCheck() {
  return (
    <div className="modal-backdrop">
      <div className="login-card session-check" role="status">
        <span className="session-spinner" aria-hidden="true" />
        <h2>Checking session</h2>
        <p>Please wait while your access is verified.</p>
      </div>
    </div>
  );
}
