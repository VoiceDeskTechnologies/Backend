"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";

type Plan = { id: string; name: string; monthly_price: number; minutes: number; area_code_selection: boolean };
type Order = { approvalUrl: string | null };

export default function CheckoutPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [areaCode, setAreaCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { const planId = new URLSearchParams(window.location.search).get("planId"); if (!planId) return; fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/plans`).then((response) => response.json()).then((plans: Plan[]) => setPlan(plans.find((item) => item.id === planId) ?? null)).catch(() => setError("Unable to load that plan.")); }, []);
  async function pay() { if (!plan) return; setLoading(true); setError(""); try { const order = await apiRequest<Order>("/api/billing/paypal/orders", { method: "POST", body: JSON.stringify({ planId: plan.id, ...(areaCode ? { areaCode } : {}) }) }); if (!order.approvalUrl) throw new Error("PayPal did not provide an approval link."); window.location.href = order.approvalUrl; } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to start payment."); setLoading(false); } }
  return <main className="phone-shell feature-page"><header className="app-header"><Link href="/pricing" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><Link className="feature-back" href="/pricing">Back to plans</Link></header><section className="feature-content"><span className="eyebrow">SECURE CHECKOUT</span><h1>{plan ? `Start ${plan.name}` : "Loading plan"}</h1>{plan && <><p className="lead-copy">${Number(plan.monthly_price).toFixed(2)} for {plan.minutes} AI minutes. Your real Telnyx number is provisioned after PayPal verifies payment.</p>{plan.area_code_selection && <label>Preferred area code<input inputMode="numeric" maxLength={3} value={areaCode} onChange={(event) => setAreaCode(event.target.value.replace(/\D/g, ""))} placeholder="Optional, e.g. 305" /></label>}<button className="primary-action" onClick={pay} disabled={loading}>{loading ? "Opening PayPal..." : "Continue to PayPal"} <span>→</span></button></>}{error && <p className="auth-error">{error}</p>}</section></main>;
}
