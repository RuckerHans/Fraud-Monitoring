'use client';

import { FormEvent, useMemo, useState } from 'react';
import { yesterday } from '@/lib/dates';
import type { ReportParams } from '@/lib/types';
import {
  baseUrl,
  useGetBranchesQuery,
  useGetMeQuery,
  useGetTransactionsQuery,
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

export function Dashboard() {
  const defaultDate = yesterday();
  const [draft, setDraft] = useState({
    branchIds: [] as string[],
    from: defaultDate,
    to: defaultDate,
    returned: '',
    voided: '',
    points: '',
  });
  const [applied, setApplied] = useState<ReportParams | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const { data: currentUser, isLoading: checkingSession } = useGetMeQuery();
  const signedIn = Boolean(currentUser);
  const { data: branches = [], isLoading: loadingBranches, isError: branchError } =
    useGetBranchesQuery(undefined, { skip: !signedIn });
  const {
    data: report,
    isFetching,
    error: reportError,
  } = useGetTransactionsQuery(applied!, { skip: !applied || !signedIn });
  const onlineBranches = branches.filter((branch) => branch.online);
  const selectedBranches = branches.filter((branch) => draft.branchIds.includes(branch.id));
  const allOnlineSelected =
    onlineBranches.length > 0 && onlineBranches.every((branch) => draft.branchIds.includes(branch.id));

  const stats = useMemo(() => {
    const rows = report?.data ?? [];
    return {
      returned: rows.filter((row) => row.returned).length,
      voided: rows.filter((row) => row.voided).length,
      points: rows.reduce((sum, row) => sum + row.pointsRedeemed, 0),
    };
  }, [report]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (!draft.branchIds.length) return;
    setApplied({
      branchIds: draft.branchIds,
      from: draft.from,
      to: draft.to,
      page: 1,
      pageSize: 50,
      returned: draft.returned === '' ? undefined : draft.returned === 'true',
      voided: draft.voided === '' ? undefined : draft.voided === 'true',
      points: draft.points ? (draft.points as ReportParams['points']) : undefined,
    });
  }

  async function exportReport() {
    if (!applied) return;
    setExporting(true);
    setNotice('');
    try {
      const params = new URLSearchParams();
      Object.entries(applied).forEach(([key, value]) => {
        if (value !== undefined && !['page', 'pageSize'].includes(key)) {
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
    if (applied) setApplied({ ...applied, page });
  }

  function toggleBranch(branchId: string) {
    setDraft((current) => ({
      ...current,
      branchIds: current.branchIds.includes(branchId)
        ? current.branchIds.filter((id) => id !== branchId)
        : [...current.branchIds, branchId],
    }));
  }

  function toggleAllOnline() {
    setDraft((current) => ({
      ...current,
      branchIds: allOnlineSelected ? [] : onlineBranches.map((branch) => branch.id),
    }));
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">FM</span>
          <div>
            <strong>Fraud Monitoring</strong>
            <span>Retail operations</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="live-dot">Systems live</span>
          <button className="avatar" onClick={() => setLoginOpen(true)} aria-label="Authentication">
            {currentUser?.username?.slice(0, 2).toUpperCase() ?? 'AU'}
          </button>
        </div>
      </header>

      <section className="shell">
        <div className="hero">
          <div>
            <p className="eyebrow">Exception intelligence</p>
            <h1>Transaction review</h1>
            <p>Trace returns, voids, and loyalty activity across selected branches.</p>
          </div>
          <button className="secondary" onClick={exportReport} disabled={!report || exporting}>
            {exporting ? 'Preparing…' : 'Export .xlsx'}
          </button>
        </div>

        <form className="filter-card" onSubmit={applyFilters}>
          <fieldset className="branch-field" disabled={loadingBranches}>
            <div className="branch-picker-heading">
              <legend>Branches</legend>
              <label className="select-all">
                <input
                  type="checkbox"
                  checked={allOnlineSelected}
                  onChange={toggleAllOnline}
                />
                <span>Select all online ({onlineBranches.length})</span>
              </label>
            </div>
            <div className="branch-options">
              {loadingBranches ? (
                <span className="branch-loading">Loading branches…</span>
              ) : branches.map((branch) => (
                <label key={branch.id} className={branch.online ? '' : 'offline'}>
                  <input
                    type="checkbox"
                    checked={draft.branchIds.includes(branch.id)}
                    onChange={() => toggleBranch(branch.id)}
                    disabled={!branch.online}
                  />
                  <span>{branch.location} <small>{branch.code}</small></span>
                  {!branch.online && <em>Offline</em>}
                </label>
              ))}
            </div>
          </fieldset>
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
              value={draft.voided}
              onChange={(event) => setDraft({ ...draft, voided: event.target.value })}
            >
              <option value="">All activity</option>
              <option value="true">Voided only</option>
              <option value="false">Not voided</option>
            </select>
          </label>
          <button className="primary" type="submit" disabled={!draft.branchIds.length || isFetching}>
            {isFetching ? 'Querying…' : 'Run report'}
          </button>
          <div className="subfilters">
            <label>
              <span>Returns</span>
              <select
                value={draft.returned}
                onChange={(event) => setDraft({ ...draft, returned: event.target.value })}
              >
                <option value="">Any</option>
                <option value="true">Returned</option>
                <option value="false">Not returned</option>
              </select>
            </label>
            <label>
              <span>Points</span>
              <select
                value={draft.points}
                onChange={(event) => setDraft({ ...draft, points: event.target.value })}
              >
                <option value="">Any</option>
                <option value="earned">Earned</option>
                <option value="redeemed">Redeemed</option>
              </select>
            </label>
          </div>
        </form>

        {(branchError || reportError || notice) && (
          <div className="alert">
            {notice ||
              (branchError
                ? 'The branch directory is unavailable.'
                : 'The report could not be loaded. Sign in or check branch connectivity.')}
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

        <section className="table-card">
          <div className="table-heading">
            <div>
              <h2>Transactions</h2>
              <p>
                {selectedBranches.length
                  ? `${selectedBranches.length} branch${selectedBranches.length > 1 ? 'es' : ''} · ${draft.from} to ${draft.to}`
                  : 'Choose one or more branches to begin'}
              </p>
            </div>
            {isFetching && <span className="querying">Reading branch…</span>}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Branch</th><th>Transaction</th><th>Customer</th><th>Amount</th><th>Date & time</th>
                  <th>Cashier / terminal</th><th>Status</th><th>Points</th>
                </tr>
              </thead>
              <tbody>
                {!report?.data.length ? (
                  <tr><td colSpan={8} className="empty">No results to display.</td></tr>
                ) : report.data.map((row) => (
                  <tr key={`${row.branchId}-${row.transactionNo}`}>
                    <td><strong>{row.branchLocation}</strong> <span className="muted">{row.branchCode}</span></td>
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
      {checkingSession ? (
        <SessionCheck />
      ) : (
        (!signedIn || loginOpen) && (
          <LoginDialog close={signedIn ? () => setLoginOpen(false) : undefined} />
        )
      )}
    </main>
  );
}

function LoginDialog({
  close,
}: {
  close?: () => void;
}) {
  const [login, { isLoading }] = useLoginMutation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const result = await login({ username, password }).unwrap();
      const token = authToken(result);
      if (token) {
        window.localStorage.setItem('fraud-monitoring-token', token);
      } else {
        window.localStorage.removeItem('fraud-monitoring-token');
      }
      window.location.reload();
    } catch {
      setError('Sign-in failed. Check your credentials and try again.');
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form className="login-card" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        {close && <button type="button" className="close" onClick={close}>×</button>}
        <p className="eyebrow">External authentication</p>
        <h2>Sign in</h2>
        <p>Your credentials are sent directly to the existing company auth service.</p>
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
        <button className="primary" disabled={isLoading}>{isLoading ? 'Signing in…' : 'Continue'}</button>
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
