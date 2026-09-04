"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setMessage("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) { setMessage("Authentication is not configured. Add the Supabase environment variables."); setLoading(false); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message); else router.push("/");
    setLoading(false);
  }
  return <main className="auth-page"><Link href="/landing" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><form className="auth-card" onSubmit={submit}><span className="eyebrow">WELCOME BACK</span><h1>Open your phone.</h1><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{message && <p className="auth-error">{message}</p>}<button className="primary-action" disabled={loading}>{loading ? "Signing in..." : "Sign in"}<span>→</span></button><p className="auth-switch">New to HandsFree? <Link href="/auth/register">Create an account</Link></p></form></main>;
}