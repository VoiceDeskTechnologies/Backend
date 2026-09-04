"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Plan = { id: string; name: string; monthly_price: number; minutes: number; max_agents: number; phone_numbers: number; knowledge_level: string; support_level: string };
type Package = { id: string; minutes: number; price: number };
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  useEffect(() => { Promise.all([fetch(`${api}/api/plans`).then((response) => response.json()), fetch(`${api}/api/payg`).then((response) => response.json())]).then(([loadedPlans, loadedPackages]) => { setPlans(loadedPlans); setPackages(loadedPackages); }); }, []);
  return <main className="landing-page pricing-page"><header className="landing-header"><Link href="/" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><Link href="/" className="landing-login">Open HandsFree <span>→</span></Link></header><section className="pricing-hero"><span className="eyebrow">3-DAY INTRODUCTORY TRIAL</span><h1>Choose your<br />calling power.</h1><p>Start with 3 days and 10 total AI calling minutes on us. When you are ready, choose the plan that fits how much you use HandsFree.</p><Link href="/auth/register" className="hero-action">Start your 3-day trial <span>→</span></Link></section><section className="plans-grid">{plans.map((plan) => <article className={`plan-card ${plan.name === "Pro" ? "popular" : ""}`} key={plan.id}>{plan.name === "Pro" && <span className="plan-badge">MOST POPULAR</span>}<h2>{plan.name}</h2><strong>${Number(plan.monthly_price).toFixed(2)}<small>/month</small></strong><p>{plan.minutes} included AI minutes</p><p>{plan.max_agents} AI agents · {plan.phone_numbers} HandsFree numbers</p><p>{plan.knowledge_level} knowledge · {plan.support_level} support</p><p>Manual renewal. No automatic renewal.</p><Link href={`/billing/checkout?planId=${plan.id}`} className="plan-action">Choose {plan.name} <span>→</span></Link></article>)}</section><section className="payg-section"><span className="eyebrow">HANDSFREE MINUTE PACKS</span><h2>Need more minutes?</h2><p>Buy additional calling time without upgrading. Packs are one-time purchases and do not automatically renew.</p><div className="payg-grid">{packages.map((pack) => <div className="payg-card" key={pack.id}><strong>{pack.minutes} minutes</strong><span>${Number(pack.price).toFixed(2)}</span><small>One-time purchase</small></div>)}</div></section></main>;
}
