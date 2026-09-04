"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";

type Agent = { id: string; name: string; role: string; personality: string; status: string; };
export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  useEffect(() => { apiRequest<Agent[]>("/api/agents").then(setAgents).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }, []);
  return <main className="phone-shell feature-page"><header className="app-header"><Link href="/" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><Link className="feature-back" href="/">Back to phone</Link></header><section className="feature-content"><div className="feature-heading"><div><span className="eyebrow">YOUR AI TEAM</span><h1>AI Agents</h1></div><Link href="/agents/create" className="primary-action feature-action">Create agent <span>+</span></Link></div>{loading && <p className="feature-muted">Loading agents...</p>}{error && <p className="auth-error">{error}</p>}{!loading && !error && agents.length === 0 && <div className="empty-state"><h2>No agents yet.</h2><p>Create your first AI agent to handle calls.</p><Link href="/agents/create" className="primary-action">Create your first agent <span>→</span></Link></div>}<div className="agent-grid">{agents.map((agent) => <article className="agent-card" key={agent.id}><span className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</span><div><h2>{agent.name}</h2><p>{agent.role}</p><small>{agent.personality}</small></div><span className="agent-status">{agent.status}</span></article>)}</div></section></main>;
}