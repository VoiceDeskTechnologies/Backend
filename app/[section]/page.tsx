import Link from "next/link";

const sections: Record<string, { title: string; eyebrow: string; message: string }> = {
  "my-numbers": { title: "My Numbers", eyebrow: "PHONE IDENTITY", message: "Provisioned HandsFree numbers will appear here when a telephony provider is configured." },
  "knowledge-base": { title: "Knowledge Base", eyebrow: "AGENT CONTEXT", message: "Add verified business information for your agents when knowledge storage is configured." },
  usage: { title: "Usage", eyebrow: "MINUTES AND CREDITS", message: "Usage will appear here from the immutable call ledger." },
  billing: { title: "Billing", eyebrow: "ONE-TIME MONTHLY PURCHASES", message: "Payment history will appear here after PayPal is configured." },
  settings: { title: "Settings", eyebrow: "ACCOUNT PREFERENCES", message: "Account settings will be available after your profile is connected." },
  "help-&-support": { title: "Help & Support", eyebrow: "WE ARE HERE TO HELP", message: "Create and track a support ticket when support storage is configured." },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const content = sections[section] ?? { title: "HandsFree", eyebrow: "PHONE FIRST", message: "This section is not available." };
  return <main className="phone-shell feature-page"><header className="app-header"><Link href="/" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><Link className="feature-back" href="/">Back to phone</Link></header><section className="feature-content"><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}</h1><div className="empty-state"><h2>No records yet.</h2><p>{content.message}</p><Link href="/" className="primary-action">Return to phone <span>→</span></Link></div></section></main>;
}
