"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiRequest } from "@/lib/api/client";
import {
  playCallEndTone,
  playDialTone,
  startRingingTone,
  stopAllCallSounds,
} from "@/lib/audio/callSounds";

const keys = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
  ["*", ""],
  ["0", "+"],
  ["#", ""],
];
type CallSummary = { direction: string; status: string };
type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  phone_number: string;
};
type Call = {
  id: string;
  to_number: string;
  direction: string;
  status: string;
  duration_seconds: number | null;
  summary: string | null;
  created_at: string;
  ai_agents: { name: string } | null;
};
type SearchResults = {
  contacts: Contact[];
  calls: {
    id: string;
    to_number: string;
    status: string;
    summary: string | null;
  }[];
  agents: { id: string; name: string; role: string }[];
};
type DashboardNumber = { phone_number: string; provisioning_status: string; is_default: boolean };
type DashboardAgent = { id: string; name: string; role: string; status: string };
type DashboardUsage = { plan: { plans: { name: string; minutes: number }; included_minutes: number; used_minutes: number } | null; trial: { trial_status: string; trial_expires_at: string; trial_minutes_granted: number; trial_minutes_remaining: number } | null; balances: { planMinutes: number; trialMinutes: number } };

function Dashboard({ numbers, usage, calls, agents, onMakeCall, onCreateAgent, onCreateTask, onAddContact }: { numbers: DashboardNumber[]; usage: DashboardUsage | null; calls: Call[]; agents: DashboardAgent[]; onMakeCall: () => void; onCreateAgent: () => void; onCreateTask: () => void; onAddContact: () => void }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const number = numbers.find((item) => item.is_default) ?? numbers[0];
  const used = usage?.plan ? Number(usage.plan.included_minutes) - Number(usage.balances.planMinutes) : Number(usage?.trial?.trial_minutes_granted ?? 0) - Number(usage?.balances.trialMinutes ?? 0);
  const total = usage?.plan?.included_minutes ?? usage?.trial?.trial_minutes_granted ?? 0;
  return <section className="dashboard-content"><div className="dashboard-heading"><span className="eyebrow">YOUR HANDSFREE</span><h1>{greeting}, there.</h1><p>Here&apos;s what&apos;s happening with your HANDSFREE account.</p></div><div className="dashboard-grid"><article className="dashboard-card number-card"><div><small>YOUR HANDSFREE NUMBER</small><h2>{number?.phone_number ?? (numbers.some((item) => item.provisioning_status === "provisioning") ? "Your number is being prepared..." : "No HANDSFREE number assigned")}</h2><p className="dashboard-status">● {number?.provisioning_status === "active" ? "Active" : number?.provisioning_status ?? "Provisioning"}</p></div><Link href="/numbers" className="dashboard-link">Manage number →</Link></article><article className="dashboard-card usage-card"><small>{usage?.plan ? "AI MINUTES" : "TRIAL"}</small><h2>{Math.max(0, used).toFixed(0)} / {total} used</h2><div className="dashboard-progress"><span style={{ width: `${total ? Math.min(100, Math.max(0, used / total * 100)) : 0}%` }} /></div><p>{usage?.plan ? `${Math.max(0, Number(usage.balances.planMinutes)).toFixed(0)} minutes remaining · ${usage.plan.plans.name}` : `${Math.max(0, Number(usage?.balances.trialMinutes ?? 0)).toFixed(0)} minutes remaining`}</p></article></div><section className="dashboard-section"><div className="dashboard-section-heading"><h2>Quick actions</h2></div><div className="quick-actions"><button onClick={onMakeCall}><span>☎</span>Make a call</button><button onClick={onCreateAgent}><span>✦</span>Create AI agent</button><button onClick={onCreateTask}><span>◷</span>Create call task</button><button onClick={onAddContact}><span>◎</span>Add contact</button></div></section><div className="dashboard-columns"><section className="dashboard-section"><div className="dashboard-section-heading"><h2>Recent calls</h2><Link href="/calls">View all →</Link></div>{calls.length ? calls.slice(0, 4).map((call) => <article className="dashboard-row" key={call.id}><span className="dashboard-row-icon">{call.direction === "inbound" ? "↓" : "↑"}</span><div><strong>{call.to_number}</strong><small>{call.direction === "inbound" ? "Incoming" : "Outgoing"} · {new Date(call.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div><em>{call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : call.status}</em></article>) : <p className="dashboard-empty">No calls yet.</p>}</section><section className="dashboard-section"><div className="dashboard-section-heading"><h2>Your AI agents</h2><Link href="/agents">View all →</Link></div>{agents.length ? agents.slice(0, 3).map((agent) => <article className="dashboard-row" key={agent.id}><span className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</span><div><strong>{agent.name}</strong><small>{agent.role}</small></div><em className="dashboard-agent-status">● {agent.status}</em></article>) : <><p className="dashboard-empty">You haven&apos;t created an AI agent yet.</p><button className="dashboard-inline-action" onClick={onCreateAgent}>Create your first agent →</button></>}</section></div></section>;
}

export default function Home() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<"dashboard" | "calls">("dashboard");
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [callMode, setCallMode] = useState(false);
  const [task, setTask] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(
    () => !createSupabaseBrowserClient(),
  );
  const [missedCalls, setMissedCalls] = useState(0);
  const [ringing, setRinging] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [liveTransferOpen, setLiveTransferOpen] = useState(false);
  const [callError, setCallError] = useState("");
  const [popup, setPopup] = useState<"contacts" | "calls" | "search" | null>(
    null,
  );
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults>({
    contacts: [],
    calls: [],
    agents: [],
  });
  const [popupLoading, setPopupLoading] = useState(false);
  const [popupError, setPopupError] = useState("");
  const [dashboardNumbers, setDashboardNumbers] = useState<DashboardNumber[]>([]);
  const [dashboardUsage, setDashboardUsage] = useState<DashboardUsage | null>(null);
  const [dashboardCalls, setDashboardCalls] = useState<Call[]>([]);
  const [dashboardAgents, setDashboardAgents] = useState<DashboardAgent[]>([]);
  const [contactComposerOpen, setContactComposerOpen] = useState(false);
  const [contactSaving, setContactSaving] = useState(false);
  const [contactForm, setContactForm] = useState({
    firstName: "",
    lastName: "",
    company: "",
    phoneNumber: "",
    email: "",
  });
  const append = (value: string) => {
    if (number.length < 15) setNumber((current) => current + value);
  };

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setSignedIn(Boolean(session)),
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authReady && !signedIn) router.replace("/auth/login");
  }, [authReady, signedIn, router]);

  useEffect(() => () => stopAllCallSounds(), []);
  useEffect(() => {
    if (!ringing || callStartedAt === null) return;
    const timer = window.setInterval(
      () => setCallSeconds(Math.floor((Date.now() - callStartedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [ringing, callStartedAt]);

  useEffect(() => {
    if (!signedIn) return;
    apiRequest<CallSummary[]>("/api/calls")
      .then((calls) =>
        setMissedCalls(
          calls.filter(
            (call) =>
              call.direction === "inbound" &&
              ["no_answer", "busy", "failed"].includes(call.status),
          ).length,
        ),
      )
      .catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    Promise.all([
      apiRequest<DashboardNumber[]>("/api/numbers"),
      apiRequest<DashboardUsage>("/api/usage"),
      apiRequest<Call[]>("/api/calls"),
      apiRequest<DashboardAgent[]>("/api/agents"),
    ]).then(([numbers, usage, recentCalls, agents]) => {
      setDashboardNumbers(numbers);
      setDashboardUsage(usage);
      setDashboardCalls(recentCalls);
      setDashboardAgents(agents);
    }).catch(() => undefined);
  }, [signedIn]);

  useEffect(() => {
    if (!popup) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPopup(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [popup]);

  useEffect(() => {
    if (!popup || !signedIn) return;
    const path = popup === "contacts" ? "/api/contacts" : "/api/calls";
    if (popup === "search") return;
    apiRequest<Contact[] | Call[]>(path)
      .then((data) =>
        popup === "contacts"
          ? setContacts(data as Contact[])
          : setCalls(data as Call[]),
      )
      .catch((reason: Error) => setPopupError(reason.message))
      .finally(() => setPopupLoading(false));
  }, [popup, signedIn]);

  async function startAiCall() {
    setCallError("");
    if (!/^\+[1-9]\d{6,14}$/.test(number)) {
      setCallError("Enter the full number in international format, for example +14155550123.");
      return;
    }
    try {
      await apiRequest<{ allowed: boolean }>("/api/calls/authorize", {
        method: "POST",
      });
      await apiRequest("/api/calls", {
        method: "POST",
        body: JSON.stringify({ toNumber: number, agentId: null }),
      });
      startRingingTone();
      setCallStartedAt(Date.now());
      setCallSeconds(0);
      setRinging(true);
      setCallMode(false);
    } catch (error) {
      setCallError(
        error instanceof Error
          ? error.message
          : "Your account cannot start this call.",
      );
    }
  }
  function endCall() {
    stopAllCallSounds();
    playCallEndTone();
    setRinging(false);
    setCallStartedAt(null);
    setCallSeconds(0);
    setMuted(false);
    setLiveTransferOpen(false);
  }
  function formatDuration(seconds: number) {
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (searchQuery.trim().length < 2) return;
    setPopupLoading(true);
    setPopupError("");
    try {
      setSearchResults(
        await apiRequest<SearchResults>(
          `/api/search?q=${encodeURIComponent(searchQuery.trim())}`,
        ),
      );
    } catch (reason) {
      setPopupError(
        reason instanceof Error ? reason.message : "Unable to search",
      );
    } finally {
      setPopupLoading(false);
    }
  }
  function openPopup(nextPopup: "contacts" | "calls" | "search") {
    setPopupError("");
    setPopupLoading(nextPopup !== "search");
    setPopup(nextPopup);
  }
  async function addContact(event: React.FormEvent) {
    event.preventDefault();
    setContactSaving(true);
    setPopupError("");
    try {
      await apiRequest("/api/contacts", {
        method: "POST",
        body: JSON.stringify({
          ...contactForm,
          company: contactForm.company || null,
          email: contactForm.email || null,
        }),
      });
      setContactForm({
        firstName: "",
        lastName: "",
        company: "",
        phoneNumber: "",
        email: "",
      });
      setContactComposerOpen(false);
      setPopupLoading(true);
      setContacts(await apiRequest<Contact[]>("/api/contacts"));
    } catch (reason) {
      setPopupError(
        reason instanceof Error ? reason.message : "Unable to add contact",
      );
    } finally {
      setContactSaving(false);
      setPopupLoading(false);
    }
  }
  return (
    <main className="phone-shell">
      {popup === "contacts" && (
        <button
          className="popup-add-floating"
          onClick={() => setContactComposerOpen(true)}
        >
          Add new contact <span>+</span>
        </button>
      )}
      {contactComposerOpen && (
        <div
          className="modal-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-title"
        >
          <form className="call-modal" onSubmit={addContact}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setContactComposerOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
            <span className="eyebrow">NEW CONTACT</span>
            <h1 id="contact-title">Add a contact</h1>
            {(
              [
                ["firstName", "First name"],
                ["lastName", "Last name"],
                ["company", "Company"],
                ["phoneNumber", "Phone number"],
                ["email", "Email"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type={key === "email" ? "email" : "text"}
                  value={contactForm[key]}
                  onChange={(event) =>
                    setContactForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  required={key === "firstName" || key === "phoneNumber"}
                />
              </label>
            ))}
            <button className="primary-action" disabled={contactSaving}>
              {contactSaving ? "Saving contact..." : "Add contact"}
              <span>→</span>
            </button>
          </form>
        </div>
      )}
      <div className="ambient-glow" />
      <header className="app-header">
        <Link
          href="/landing"
          className="brand"
          aria-label="Visit HandsFree landing page"
        >
          <span className="brand-name">
            Hands<span>Free</span>
          </span>
          <span className="brand-parent">by VoiceDesk Technologies</span>
        </Link>
      </header>
      {signedIn && activeView === "dashboard" ? <Dashboard numbers={dashboardNumbers} usage={dashboardUsage} calls={dashboardCalls} agents={dashboardAgents} onMakeCall={() => setActiveView("calls")} onCreateAgent={() => router.push("/agents/create")} onCreateTask={() => router.push("/tasks")} onAddContact={() => openPopup("contacts")} /> : ringing ? (
        <section className="live-call" aria-label="Live call">
          <div className="call-topline">
            <button
              className="call-back"
              onClick={endCall}
              aria-label="End call"
            >
              ↓
            </button>
            <span>{callSeconds === 0 ? "CONNECTING" : "AI CALL"}</span>
            <span className="call-topline-spacer" aria-hidden="true" />
          </div>
          <div className="caller-orb">{number.slice(-2) || "HF"}</div>
          <h1>{number || "Unknown caller"}</h1>
          <p className="caller-number">
            {callSeconds === 0
              ? "Connecting securely..."
              : formatDuration(callSeconds)}
          </p>
          <p className="agent-line">
            <span className="status-dot" /> Sarah · AI agent
          </p>
          <div className="waveform" aria-label="Call audio activity">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="call-controls">
            <button
              className={muted ? "control active-control" : "control"}
              onClick={() => setMuted((value) => !value)}
            >
              <span aria-hidden="true" />
              <small>{muted ? "Unmute" : "Mute"}</small>
            </button>
            <button
              className="control"
              onClick={() => setLiveTransferOpen((value) => !value)}
            >
              <span>⇄</span>
              <small>Live transfer</small>
            </button>
            <button
              className="end-call"
              onClick={endCall}
              aria-label="End call"
            >
              <span className="phone-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z" /></svg></span>
              <small>End</small>
            </button>
          </div>
          {liveTransferOpen && (
            <div className="call-popover">
              <strong>Live transfer</strong>
              <p>Enter a number, then start talking to the person on the line.</p>
              <label>
                Transfer number
                <input type="tel" placeholder="+1 555 123 4567" />
              </label>
              <button
                className="primary-action"
                onClick={() => setLiveTransferOpen(false)}
              >
                Start live transfer <span>→</span>
              </button>
            </div>
          )}
        </section>
      ) : (
        <section className="dialer-content" aria-label="HandsFree dialer">
          <div className="number-entry">
            <div className={`number-display ${number ? "has-number" : ""}`}>
              {number || "Enter a number"}
            </div>
            {!number.startsWith("+") && <button className="prefix-button" aria-label="Add international plus prefix" onClick={() => setNumber((current) => current ? `+${current}` : "+")}>+</button>}
            {number && (
              <button
                className="erase-button"
                aria-label="Erase last digit"
                onClick={() => setNumber((current) => current.slice(0, -1))}
              >
                ⌫
              </button>
            )}
          </div>
          <div className="keypad" role="group" aria-label="Phone keypad">
            {keys.map(([digit, letters]) => (
              <button
                className="key"
                key={digit}
                onClick={() => {
                  append(digit);
                  playDialTone();
                }}
              >
                <strong>{digit}</strong>
                <small>{letters}</small>
              </button>
            ))}
          </div>
          {ringing && (
            <div className="ringing-status" role="status">
              <span className="ringing-dot" /> Ringing{" "}
              <button onClick={endCall}>End call</button>
            </div>
          )}
          <button
            className="call-button"
            aria-label="Ask HandsFree to call"
            onClick={() => {
              playDialTone();
              setCallMode(true);
            }}
          >
            <span className="phone-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92z" /></svg></span>
          </button>
        </section>
      )}
      <nav className="bottom-nav" aria-label="Primary navigation">
        <button className={activeView === "dashboard" ? "active" : ""} onClick={() => setActiveView("dashboard")}><span className="nav-icon">⌂</span>Dashboard</button>
        <button className={activeView === "calls" ? "active call-nav-item" : "call-nav-item"} onClick={() => setActiveView("calls")}><span className="nav-icon">☎</span>Calls
          {missedCalls > 0 && (
            <span
              className="call-badge"
              aria-label={`${missedCalls} missed calls`}
            >
              {missedCalls > 9 ? "9+" : missedCalls}
            </span>
          )}
        </button>
        <button className="plus-nav-item" onClick={() => setActionSheetOpen(true)} aria-label="Open quick actions"><span className="nav-icon">+</span></button>
        <Link href="/agents"><span className="nav-icon">✦</span>AI Agents</Link>
        <Link href="/settings"><span className="nav-icon">⚙</span>Settings</Link>
      </nav>
      {actionSheetOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="quick-actions-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setActionSheetOpen(false); }}><section className="action-sheet"><button className="modal-close" onClick={() => setActionSheetOpen(false)} aria-label="Close">×</button><span className="eyebrow">QUICK ACTIONS</span><h1 id="quick-actions-title">What would you like to do?</h1><button onClick={() => { setActionSheetOpen(false); setActiveView("calls"); }}><span>☎</span>Make a call</button><Link href="/agents/create"><span>✦</span>Create AI agent</Link><Link href="/tasks"><span>◷</span>Create call task</Link><button onClick={() => { setActionSheetOpen(false); openPopup("contacts"); }}><span>◎</span>Add contact</button></section></div>}
      {popup && (
        <div
          className="modal-layer popup-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="popup-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPopup(null);
          }}
        >
          <section className="data-popup">
            <button
              className="modal-close"
              onClick={() => setPopup(null)}
              aria-label="Close popup"
            >
              ×
            </button>
            <span className="eyebrow">
              {popup === "contacts"
                ? "YOUR PEOPLE"
                : popup === "calls"
                  ? "YOUR HISTORY"
                  : "FIND ANYTHING"}
            </span>
            <h1 id="popup-title">
              {popup === "contacts"
                ? "Contacts"
                : popup === "calls"
                  ? "Calls"
                  : "Search"}
            </h1>
            {popup === "search" && (
              <form className="search-form popup-search" onSubmit={runSearch}>
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Contacts, calls, agents..."
                  minLength={2}
                  required
                />
                <button className="primary-action">
                  Search <span>⌕</span>
                </button>
              </form>
            )}
            {popupError && <p className="auth-error">{popupError}</p>}
            {popupLoading && <p className="popup-state">Loading...</p>}
            {popup === "contacts" && !popupLoading && (
              <div className="contact-list">
                {contacts.length ? (
                  contacts.map((contact) => (
                    <article className="contact-row" key={contact.id}>
                      <span className="agent-avatar">
                        {contact.first_name.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <h2>
                          {contact.first_name} {contact.last_name}
                        </h2>
                        <p>{contact.company || contact.phone_number}</p>
                        <small>{contact.phone_number}</small>
                      </div>
                      <a
                        className="row-call"
                        href={`tel:${contact.phone_number}`}
                        aria-label={`Call ${contact.first_name}`}
                      >
                        ☎
                      </a>
                    </article>
                  ))
                ) : (
                  <div className="popup-state">No contacts yet.</div>
                )}
              </div>
            )}
            {popup === "calls" && !popupLoading && (
              <div className="contact-list">
                {calls.length ? (
                  calls.map((call) => (
                    <article className="contact-row" key={call.id}>
                      <span className="agent-avatar">
                        {call.direction === "inbound" ? "↓" : "↑"}
                      </span>
                      <div>
                        <h2>{call.to_number}</h2>
                        <p>
                          {call.ai_agents?.name || "Unassigned agent"} ·{" "}
                          {call.status}
                        </p>
                        <small>{call.summary || "No summary available"}</small>
                      </div>
                      <time className="call-time">
                        {new Date(call.created_at).toLocaleDateString()}
                      </time>
                    </article>
                  ))
                ) : (
                  <div className="popup-state">No calls yet.</div>
                )}
              </div>
            )}
            {popup === "search" && !popupLoading && searchQuery && (
              <div className="popup-results">
                {searchResults.contacts.length +
                  searchResults.calls.length +
                  searchResults.agents.length ===
                0 ? (
                  <div className="popup-state">No results.</div>
                ) : (
                  <>
                    {searchResults.contacts.length > 0 && (
                      <>
                        <h2 className="result-heading">Contacts</h2>
                        {searchResults.contacts.map((item) => (
                          <div className="result-row" key={item.id}>
                            <strong>
                              {item.first_name} {item.last_name}
                            </strong>
                            <span>{item.company || item.phone_number}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {searchResults.calls.length > 0 && (
                      <>
                        <h2 className="result-heading">Calls</h2>
                        {searchResults.calls.map((item) => (
                          <div className="result-row" key={item.id}>
                            <strong>{item.to_number}</strong>
                            <span>
                              {item.status} · {item.summary || "No summary"}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                    {searchResults.agents.length > 0 && (
                      <>
                        <h2 className="result-heading">AI Agents</h2>
                        {searchResults.agents.map((item) => (
                          <div className="result-row" key={item.id}>
                            <strong>{item.name}</strong>
                            <span>{item.role}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      {callMode && (
        <div
          className="modal-layer"
          role="dialog"
          aria-modal="true"
          aria-labelledby="call-title"
        >
          <div className="call-modal">
            <button
              className="modal-close"
              onClick={() => setCallMode(false)}
              aria-label="Close"
            >
              ×
            </button>
            <span className="eyebrow">AI CALL</span>
            <h1 id="call-title">How should HandsFree help?</h1>
            <p>
              Your agent will call <strong>{number || "this number"}</strong>{" "}
              and handle the conversation for you.
            </p>
            <label htmlFor="task">What should they do?</label>
            <textarea
              id="task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Ask about an order, appointment, or anything else..."
            />
            {callError && (
              <p className="auth-error">
                {callError} <Link href="/pricing">View plans</Link>
              </p>
            )}
            <button
              className="primary-action"
              disabled={!number || !task.trim()}
              onClick={startAiCall}
            >
              Start AI Call <span>→</span>
            </button>
            <Link className="secondary-action" href="/agents">
              Choose a different agent
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
