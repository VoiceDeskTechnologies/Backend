"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [country, setCountry] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Authentication is not configured. Add the Supabase environment variables.");
      setLoading(false);
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName.trim(), last_name: lastName.trim(), display_name: `${firstName.trim()} ${lastName.trim()}`.trim(), business_name: businessName.trim() || null, country } },
    });
    setMessage(error ? error.message : "Check your email to verify your account, then sign in.");
    setLoading(false);
  }

  return <main className="auth-page"><Link href="/landing" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><form className="auth-card" onSubmit={submit}><span className="eyebrow">GET STARTED</span><h1>Your AI, on the phone.</h1><label>First name<input type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" required /></label><label>Last name<input type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" required /></label><label>Business name <small>(optional)</small><input type="text" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" /></label><label>Country<input type="text" value={country} onChange={(event) => setCountry(event.target.value)} autoComplete="country-name" placeholder="United States" required /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></label>{message && <p className="auth-error">{message}</p>}<button className="primary-action" disabled={loading}>{loading ? "Creating account..." : "Create account"}<span>→</span></button><p className="auth-switch">Already have an account? <Link href="/auth/login">Sign in</Link></p></form></main>;
}
