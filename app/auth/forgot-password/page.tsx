"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setLoading(true); const supabase = createSupabaseBrowserClient(); if (!supabase) setMessage("Authentication is not configured. Add the Supabase environment variables."); else { const { error } = await supabase.auth.resetPasswordForEmail(email); setMessage(error?.message ?? "If an account exists, a reset link is on its way."); } setLoading(false); }
  return <main className="auth-page"><Link href="/landing" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><form className="auth-card" onSubmit={submit}><span className="eyebrow">ACCOUNT ACCESS</span><h1>Reset your password.</h1><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>{message && <p className="auth-error">{message}</p>}<button className="primary-action" disabled={loading}>{loading ? "Sending..." : "Send reset link"}<span>→</span></button><p className="auth-switch"><Link href="/auth/login">Back to sign in</Link></p></form></main>;
}