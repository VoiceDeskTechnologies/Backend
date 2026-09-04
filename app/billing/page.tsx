"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";

type Billing = {
  plan: { period_end: string; included_minutes: number; plans: { name: string; monthly_price: number } } | null;
  trial: { trial_status: string; trial_expires_at: string; trial_minutes_remaining: number } | null;
  balances: { planMinutes: number; paygMinutes: number; trialMinutes: number };
};

export default function BillingPage() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState("");
  const [paymentMessage, setPaymentMessage] = useState("");

  useEffect(() => {
    apiRequest<Billing>("/api/usage")
      .then(setBilling)
      .catch((reason: Error) => setError(reason.message));
    const orderId = new URLSearchParams(window.location.search).get("token");
    if (orderId)
      apiRequest<{ numberStatus: string }>(`/api/billing/paypal/orders/${orderId}/capture`, { method: "POST" })
        .then((result) => setPaymentMessage(result.numberStatus === "active" ? "Payment successful. Your HANDSFREE number is ready." : "Payment successful. Your HANDSFREE number is being prepared."))
        .catch((reason: Error) => setPaymentMessage(reason.message));
  }, []);

  const plan = billing?.plan;
  return <main className="phone-shell feature-page"><header className="app-header"><Link href="/" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><Link className="feature-back" href="/">Back to phone</Link></header><section className="feature-content billing-content"><span className="eyebrow">ACCOUNT CAPACITY</span><h1>Billing</h1>{paymentMessage && <p className="billing-note">{paymentMessage}</p>}{error && <p className="auth-error">Unable to load billing. {error}</p>}{!error && !billing && <p className="feature-muted">Loading billing...</p>}{billing && <><section className="billing-summary"><div><small>CURRENT PLAN</small><h2>{plan?.plans.name ?? "No paid plan"}</h2><p>{plan ? `$${Number(plan.plans.monthly_price).toFixed(2)} monthly period` : "Choose a plan to continue calling"}</p></div><div><small>STATUS</small><strong>{plan ? "Active" : billing.trial?.trial_status === "active" ? "Trial" : "Ended"}</strong><p>{plan ? `Ends ${new Date(plan.period_end).toLocaleDateString()}` : billing.trial ? `Trial ends ${new Date(billing.trial.trial_expires_at).toLocaleDateString()}` : "No active entitlement"}</p></div></section><p className="billing-note">Plans are one-time monthly purchases and do not automatically renew. Renew your plan each month after it ends.</p><div className="billing-actions"><Link href="/pricing" className="primary-action">View plans <span>→</span></Link><Link href="/billing/payg" className="secondary-action">Buy more minutes</Link></div><section className="usage-stat-grid"><div className="usage-card"><small>PLAN MINUTES</small><h2>{billing.balances.planMinutes.toFixed(1)} remaining</h2><p>Included: {plan?.included_minutes ?? 0} minutes</p></div><div className="usage-card"><small>PAY-AS-YOU-GO</small><h2>{billing.balances.paygMinutes.toFixed(1)} remaining</h2><p>One-time purchased minutes</p></div><div className="usage-card"><small>TRIAL</small><h2>{billing.balances.trialMinutes.toFixed(1)} remaining</h2><p>{billing.trial?.trial_status === "active" ? "3-day introductory access" : "Trial complete"}</p></div></section></>}</section></main>;
}
