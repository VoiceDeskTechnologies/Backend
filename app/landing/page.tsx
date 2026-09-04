import Link from "next/link";

export default function LandingPage() {
  return <main className="landing-page">
    <header className="landing-header"><Link href="/" className="brand"><span className="brand-name">Hands<span>Free</span></span><span className="brand-parent">by VoiceDesk Technologies</span></Link><Link href="/" className="landing-login">Open HandsFree <span>→</span></Link></header>
      <section className="landing-hero"><div className="hero-copy"><span className="eyebrow">THE AI PHONE FOR REAL LIFE</span><h1>Let AI handle<br /><em>the call.</em></h1><p>Tell HandsFree what you need done. Start with 10 AI calling minutes on us for 3 days, then choose a paid plan when you are ready.</p><Link href="/auth/register" className="hero-action">Start your trial <span>→</span></Link></div><div className="demo-card"><div className="demo-top"><span className="live-dot" /> Sarah is calling</div><div className="demo-quote">“I’m calling to check on an order that hasn’t shipped yet.”</div><div className="demo-result"><span>✓</span><div><strong>Call complete</strong><small>Try 3 days · 10 total minutes</small></div></div></div></section>
    <section className="landing-section"><span className="eyebrow">ONE SIMPLE IDEA</span><h2>Your calls. Handled.</h2><div className="steps"><article><b>01</b><h3>Tell it what to do</h3><p>Give your agent the goal in plain language. No scripts required.</p></article><article><b>02</b><h3>HandsFree calls</h3><p>Your agent uses its own number, voice, and context to handle the conversation.</p></article><article><b>03</b><h3>Get the result</h3><p>Read the summary, transcript, and important details when it’s done.</p></article></div></section>
    <footer className="landing-footer"><span>HandsFree by VoiceDesk Technologies</span><Link href="/">Open the phone <span>→</span></Link></footer>
  </main>;
}
