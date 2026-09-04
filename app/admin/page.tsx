"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";

type Dashboard = { kpis: { users: number; calls: number; aiMinutes: number; activeNumbers: number; activeAgents: number; openTickets: number }; usageSeries: number[]; generatedAt: string };
const cards = [["users", "Total users", "Registered accounts", "/admin/users"], ["calls", "Total calls", "All recorded call activity", "/admin/calls"], ["aiMinutes", "AI minutes used", "Usage ledger total", "/admin/usage"], ["activeNumbers", "Active numbers", "Provisioned phone lines", "/admin/phone-numbers"], ["openTickets", "Open support", "Tickets needing attention", "/admin/support"]] as const;

export default function AdminDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { apiRequest<Dashboard>("/api/admin/dashboard").then(setDashboard).catch((reason: Error) => setError(reason.message)); }, []);
  return <section className="admin-content"><div className="admin-page-heading"><div><p className="admin-kicker">LIVE OVERVIEW</p><h2>Platform performance</h2><p>Real-time operating signals across HandsFree.</p></div><span className="admin-date">Updated {dashboard ? new Date(dashboard.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "..."}</span></div>
    {error && <div className="admin-error" role="alert">Unable to load dashboard. {error}</div>}
    <div className="admin-stat-grid">{cards.map(([key, title, detail, href]) => <Link href={href} className="admin-stat-card" key={key}><span className="admin-stat-icon">{key === "aiMinutes" ? "◉" : key === "calls" ? "⌁" : key === "openTickets" ? "●" : "✦"}</span><span><small>{title}</small><strong>{dashboard ? dashboard.kpis[key]!.toLocaleString() : "—"}</strong><em>{detail}</em></span><b>↗</b></Link>)}</div>
    <div className="admin-panel-grid"><div className="admin-panel admin-chart-panel"><div className="admin-panel-heading"><span><p className="admin-kicker">ACTIVITY</p><h3>AI minutes usage</h3></span><span className="admin-chip">From usage ledger</span></div><div className="activity-bars" aria-label="AI minutes usage summary">{(dashboard?.usageSeries ?? Array(8).fill(0)).map((value, index, series) => <i key={index} style={{ height: `${Math.max(4, (value / Math.max(...series, 1)) * 100)}%` }} />)}</div><div className="chart-labels"><span>8 weeks ago</span><span>Current week</span></div></div><div className="admin-panel"><div className="admin-panel-heading"><span><p className="admin-kicker">SYSTEM HEALTH</p><h3>Service status</h3></span><Link href="/admin/settings">Manage</Link></div>{["Supabase database", "Telephony", "AI runtime", "Email delivery"].map((service) => <div className="health-row" key={service}><span><i />{service}</span><strong>Configured</strong></div>)}</div></div>
    <div className="admin-panel quick-panel"><div className="admin-panel-heading"><span><p className="admin-kicker">OPERATIONS</p><h3>Quick actions</h3></span></div><div className="quick-actions"><Link href="/admin/users">Search user <span>→</span></Link><Link href="/admin/support">Open support queue <span>→</span></Link><Link href="/admin/calls?status=failed">Review failed calls <span>→</span></Link><Link href="/admin/billing">Review billing <span>→</span></Link></div></div>
  </section>;
}