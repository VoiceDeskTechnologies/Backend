"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";

type Profile = { first_name: string; last_name: string; business_name: string | null; country: string };
export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile>({ first_name: "", last_name: "", business_name: null, country: "" });
  const [message, setMessage] = useState("");
  useEffect(() => { apiRequest<Profile>("/api/settings").then((data) => setProfile((current) => ({ ...current, ...data }))).catch(() => setMessage("We couldn't load your profile.")); }, []);
  async function save(event: React.FormEvent) { event.preventDefault(); setMessage(""); try { await apiRequest("/api/settings", { method: "PUT", body: JSON.stringify({ firstName: profile.first_name, lastName: profile.last_name, businessName: profile.business_name || null, country: profile.country }) }); setMessage("Profile saved."); } catch { setMessage("We couldn't save your profile. Please try again."); } }
  return <main className="phone-shell feature-page"><header className="app-header"><Link href="/settings" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><Link className="feature-back" href="/settings">Settings</Link></header><form className="feature-content form-page" onSubmit={save}><span className="eyebrow">ACCOUNT</span><h1>My Profile</h1><label>First name<input value={profile.first_name} onChange={(event) => setProfile({ ...profile, first_name: event.target.value })} required /></label><label>Last name<input value={profile.last_name} onChange={(event) => setProfile({ ...profile, last_name: event.target.value })} /></label><label>Business name<input value={profile.business_name ?? ""} onChange={(event) => setProfile({ ...profile, business_name: event.target.value })} /></label><label>Country<input value={profile.country} onChange={(event) => setProfile({ ...profile, country: event.target.value })} /></label>{message && <p className="save-confirmation">{message}</p>}<button className="primary-action">Save profile <span>→</span></button></form></main>;
}
