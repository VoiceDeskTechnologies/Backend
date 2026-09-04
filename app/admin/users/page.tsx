"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";
type User = {
  id: string;
  display_name: string | null;
  status: string;
  created_at: string;
};
type Plan = { id: string; name: string; monthly_price: number; minutes: number; active: boolean };
type Detail = { profile: User & { email?: string; country?: string; business_name?: string }; plan: { period_end: string; included_minutes: number; used_minutes: number; plans: { name: string; monthly_price: number } } | null; balance: { monthly_remaining: number; payg_remaining: number; trial_remaining?: number } | null; calls: { total: number; completed: number; failed: number; averageDurationSeconds: number }; agents: number; numbers: number; admin: { role: string; active: boolean } | null };
type Result = { data: User[]; total: number; page: number; pageSize: number };
export default function AdminUsers() {
  const [result, setResult] = useState<Result | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  function load(value = search) {
    setLoading(true);
    setError("");
    apiRequest<Result>(
      `/api/admin/users?page=1&pageSize=25&search=${encodeURIComponent(value)}`,
    )
      .then(setResult)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    void apiRequest<Result>("/api/admin/users?page=1&pageSize=25")
      .then(setResult)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void apiRequest<Plan[]>("/api/admin/plans").then(setPlans).catch((reason: Error) => setError(reason.message)); }, []);
  async function openUser(user: User) { setBusy(user.id); setError(""); try { setSelected(await apiRequest<Detail>(`/api/admin/users/${user.id}`)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load user details"); } finally { setBusy(null); } }
  async function changePlan(user: User, planId: string) { const reason = window.prompt("Reason for changing this user's plan:"); if (!reason?.trim()) return; setBusy(user.id); try { await apiRequest(`/api/admin/users/${user.id}/plan`, { method: "PATCH", body: JSON.stringify({ planId, reason }) }); await openUser(user); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to change plan"); } finally { setBusy(null); } }
  async function changeAdmin(user: User, active: boolean) { const reason = window.prompt(active ? "Reason for granting admin access:" : "Reason for removing admin access:"); if (!reason?.trim()) return; setBusy(user.id); try { await apiRequest(`/api/admin/users/${user.id}/admin-role`, { method: "PATCH", body: JSON.stringify({ role: "administrator", active, reason }) }); await openUser(user); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update admin access"); } finally { setBusy(null); } }
  return (
    <section className="admin-content">
      <div className="admin-page-heading">
        <div>
          <p className="admin-kicker">DIRECTORY</p>
          <h2>Users</h2>
          <p>Search and inspect platform accounts.</p>
        </div>
      </div>
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          load();
        }}
      >
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or user ID"
          aria-label="Search users"
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              load("");
            }}
          >
            Clear
          </button>
        )}
        <button type="submit">Search</button>
      </form>
      {error && (
        <div className="admin-error" role="alert">
          Unable to load users. {error}
        </div>
      )}
      <div className="admin-panel table-panel">
        <div className="admin-table-meta">
          <span>
            {result
              ? `${result.total.toLocaleString()} accounts`
              : "Loading accounts"}
          </span>
          <span>Server-side pagination · 25 per page</span>
        </div>
        <div className="admin-table-scroll">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th><th>Plan</th><th>Admin access</th>
                <th>Joined</th>
                <th>Account ID</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading users...</td>
                </tr>
              ) : result?.data.length ? (
                result.data.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.display_name || "Unnamed user"}</strong>
                      <small>{user.id.slice(0, 8)}...</small>
                    </td>
                    <td>
                      <span className={`status-pill ${user.status}`}>
                        {user.status}
                      </span>
                    </td>
                    <td><select aria-label={`Change plan for ${user.display_name || user.id}`} defaultValue="" disabled={busy === user.id} onChange={(event) => { if (event.target.value) void changePlan(user, event.target.value); }}><option value="">Change plan...</option>{plans.filter((plan) => plan.active).map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {plan.minutes} min</option>)}</select></td>
                    <td><button className="admin-inline-action" onClick={() => void openUser(user)}>{busy === user.id ? "Loading..." : "View / manage"}</button></td>
                    <td>{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="mono">{user.id}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No users match your search.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {selected && <div className="modal-layer admin-user-layer" role="dialog" aria-modal="true" aria-labelledby="user-detail-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="data-popup admin-user-detail"><button className="modal-close" onClick={() => setSelected(null)} aria-label="Close user details">×</button><p className="admin-kicker">USER ACCOUNT</p><h2 id="user-detail-title">{selected.profile.display_name || "Unnamed user"}</h2><p className="mono">{selected.profile.id}</p><div className="admin-detail-grid"><div><small>Current plan</small><strong>{selected.plan?.plans.name ?? "No active plan"}</strong></div><div><small>Plan expiry</small><strong>{selected.plan ? new Date(selected.plan.period_end).toLocaleDateString() : "—"}</strong></div><div><small>Minutes used</small><strong>{Number(selected.plan?.used_minutes ?? 0).toFixed(1)}</strong></div><div><small>Minutes remaining</small><strong>{Number(selected.balance?.monthly_remaining ?? 0).toFixed(1)}</strong></div><div><small>Total calls</small><strong>{selected.calls.total}</strong></div><div><small>Completed / failed</small><strong>{selected.calls.completed} / {selected.calls.failed}</strong></div><div><small>Agents</small><strong>{selected.agents}</strong></div><div><small>Phone numbers</small><strong>{selected.numbers}</strong></div></div><div className="admin-user-actions"><label>Plan<select value="" onChange={(event) => { if (event.target.value) void changePlan(selected.profile, event.target.value); }}><option value="">Select plan...</option>{plans.filter((plan) => plan.active).map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {plan.minutes} min</option>)}</select></label><button className="primary-action" onClick={() => void changeAdmin(selected.profile, !selected.admin?.active)}>{selected.admin?.active ? "Remove admin access" : "Make administrator"}<span>→</span></button></div></section></div>}
    </section>
  );
}
