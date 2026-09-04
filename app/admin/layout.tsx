"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";

const navigation = [
  ["Dashboard", "/admin", "▦"], ["Users", "/admin/users", "♙"], ["Calls", "/admin/calls", "◷"], ["AI Agents", "/admin/agents", "✦"], ["Phone Numbers", "/admin/phone-numbers", "⌕"],
  ["Billing & Revenue", "/admin/billing", "$"], ["Usage & Analytics", "/admin/usage", "▥"], ["Support", "/admin/support", "●"], ["Settings", "/admin/settings", "⚙"], ["Audit Logs", "/admin/audit-logs", "▤"],
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [badge, setBadge] = useState<string | null>(null);
  useEffect(() => { apiRequest<{ badge: string | null }>("/api/admin/support/unread-count").then((result) => setBadge(result.badge)).catch(() => setBadge(null)); }, []);
  return <div className="admin-app">
    <aside className={menuOpen ? "admin-sidebar open" : "admin-sidebar"}>
      <div className="admin-brand"><span className="admin-brand-mark">⌁</span><span><strong>HandsFree</strong><small>by VoiceDesk Technologies</small></span></div>
      <nav className="admin-nav" aria-label="Admin navigation">{navigation.map(([label, href, icon]) => <Link key={href} href={href} className={pathname === href || (href !== "/admin" && pathname.startsWith(href)) ? "active" : ""} onClick={() => setMenuOpen(false)}><span aria-hidden="true">{icon}</span>{label}{label === "Support" && badge && <b className="admin-badge">{badge}</b>}</Link>)}</nav>
      <div className="admin-profile"><span className="profile-avatar">A</span><span><strong>Administrator</strong><small>Operations control</small></span><span className="profile-more">⋮</span></div>
    </aside>
    {menuOpen && <button className="admin-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="admin-main"><header className="admin-header"><button className="admin-menu-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}>☰</button><div><p className="admin-kicker">HANDSFREE / CONTROL CENTER</p><h1>Mission control</h1></div><div className="admin-header-actions"><button aria-label="Notifications">♧</button><span className="admin-status"><i /> Systems monitored</span></div></header>{children}</main>
  </div>;
}