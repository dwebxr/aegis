"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { ShieldIcon, FireIcon, ZapIcon, ChartIcon, GitHubIcon, RSSIcon, SearchIcon, ShareIcon, GlobeIcon, ChromeIcon } from "@/components/icons";

interface LandingHeroProps {
  onTryDemo: () => void;
  onLogin: () => void;
  mobile?: boolean;
}

const HOW_IT_WORKS = [
  {
    step: "1",
    icon: <RSSIcon s={22} />,
    title: "Add Your Feeds",
    desc: "Register RSS feeds, Nostr relays, or social sources you already follow.",
    colorClass: "text-cyan-400",
  },
  {
    step: "2",
    icon: <ShieldIcon s={22} />,
    title: "AI Filters the Noise",
    desc: "Every article is scored for quality, originality, and credibility. Low-effort content is filtered out.",
    colorClass: "text-blue-400",
  },
  {
    step: "3",
    icon: <SearchIcon s={22} />,
    title: "Read What Matters",
    desc: "Get a curated reading list daily. Only articles worth your time.",
    colorClass: "text-emerald-400",
  },
];

const OUTCOMES = [
  {
    icon: <RSSIcon s={20} />,
    title: "AI-Curated Daily Reading List",
    desc: "Every morning, receive only the articles worth your time from all your feeds.",
    colorClass: "text-cyan-400",
    borderClass: "border-l-cyan-400",
  },
  {
    icon: <ChartIcon s={20} />,
    title: "Instant Quality Scores",
    desc: "See quality, originality, and credibility scores at a glance. Skip the clickbait.",
    colorClass: "text-purple-400",
    borderClass: "border-l-purple-400",
  },
  {
    icon: <ShareIcon s={20} />,
    title: "Share Quality Signals on Nostr",
    desc: "Publish \u201cworth reading\u201d signals to Nostr with your evaluation attached.",
    colorClass: "text-emerald-400",
    borderClass: "border-l-emerald-400",
  },
  {
    icon: <FireIcon s={20} />,
    title: "Peer-to-Peer Content Exchange",
    desc: "Your agent trades high-quality content with other agents. Encrypted, no middleman.",
    colorClass: "text-orange-400",
    borderClass: "border-l-orange-400",
  },
];

const FEATURES = [
  {
    icon: <ShieldIcon s={22} />,
    title: "Quality Filter",
    desc: "Automatically removes clickbait and thin aggregator posts. Only deep analysis and primary sources remain.",
    colorClass: "text-cyan-400",
    bgClass: "bg-gradient-to-br from-cyan-500/[0.09] to-blue-600/[0.04] border-cyan-500/[0.15]",
  },
  {
    icon: <ZapIcon s={22} />,
    title: "Nostr Publishing",
    desc: "Broadcast your curated picks to Nostr with quality scores attached. Build reputation as a trusted curator.",
    colorClass: "text-purple-400",
    bgClass: "bg-gradient-to-br from-purple-500/[0.09] to-blue-600/[0.04] border-purple-500/[0.15]",
  },
  {
    icon: <ChartIcon s={22} />,
    title: "Web of Trust",
    desc: "Content endorsed by people you follow on Nostr ranks higher. Your trust graph shapes your feed.",
    colorClass: "text-emerald-400",
    bgClass: "bg-gradient-to-br from-emerald-500/[0.09] to-cyan-500/[0.04] border-emerald-500/[0.15]",
  },
  {
    icon: <FireIcon s={22} />,
    title: "D2A Agents",
    desc: "Your personal agent discovers, evaluates, and exchanges quality content with other agents. Fully encrypted.",
    colorClass: "text-orange-400",
    bgClass: "bg-gradient-to-br from-orange-500/[0.09] to-amber-500/[0.04] border-orange-500/[0.15]",
  },
] as const;

const PERSONAS = [
  {
    role: "Crypto Trader",
    icon: <ChartIcon s={18} />,
    quote: "Instead of skimming 500 news articles a day, I read the 20 that actually move markets.",
    colorClass: "text-cyan-400",
    borderClass: "border-t-cyan-400",
  },
  {
    role: "Researcher",
    icon: <SearchIcon s={18} />,
    quote: "Papers and technical posts are auto-scored for depth. I spend my time reading, not triaging.",
    colorClass: "text-purple-400",
    borderClass: "border-t-purple-400",
  },
  {
    role: "Newsletter Writer",
    icon: <GlobeIcon s={18} />,
    quote: "My agent surfaces original analysis across 50 feeds. The curated picks go straight into my weekly digest.",
    colorClass: "text-emerald-400",
    borderClass: "border-t-emerald-400",
  },
];

const TRUST_PILLS = ["Open Source", "Self-Custodial", "No Tracking"];

export const LandingHero: React.FC<LandingHeroProps> = ({ onTryDemo, onLogin, mobile }) => (
  <div data-testid="aegis-landing-hero" className={cn(
    "flex flex-col items-center justify-center text-center animate-fade-in",
    mobile
      ? "min-h-auto px-4 pt-8 pb-16"
      : "min-h-[calc(100vh-120px)] px-6 py-12"
  )}>
    {/* Logo */}
    <div className="size-14 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mb-6 shadow-glow-cyan">
      <ShieldIcon s={28} />
    </div>

    {/* Hero heading */}
    <h1 data-testid="aegis-landing-heading" className={cn(
      "font-[800] leading-[1.1] tracking-tight text-foreground m-0 max-w-[600px]",
      mobile ? "text-[28px]" : "text-[40px]"
    )}>
      Cut Through the Noise in Your Feeds
    </h1>

    <p className="text-body font-semibold text-cyan-400 tracking-wide mt-2 mb-0">
      AI-powered quality filter for RSS and social feeds. Free and open source.
    </p>

    <p className={cn(
      "leading-relaxed text-[var(--color-text-tertiary)] mt-2 mb-0 max-w-[480px]",
      mobile ? "text-body-sm" : "text-body"
    )}>
      Built for researchers, analysts, and anyone whose work depends on finding signal.
    </p>

    {/* CTA */}
    <div className={cn(
      "flex flex-col items-center gap-2",
      mobile ? "mt-6 w-full" : "mt-8 w-auto"
    )}>
      <button
        data-testid="aegis-landing-try-demo"
        onClick={onTryDemo}
        className={cn(
          "px-8 py-3 bg-gradient-to-br from-blue-600 to-cyan-500 border-none rounded-md text-white text-body font-bold cursor-pointer font-sans shadow-glow-cyan transition-normal",
          mobile && "w-full"
        )}
      >
        Try the Demo
      </button>
      <button
        data-testid="aegis-landing-login"
        onClick={onLogin}
        className="px-4 py-1 bg-transparent border-none rounded-sm text-[var(--color-text-tertiary)] text-body-sm font-medium cursor-pointer font-sans underline decoration-[var(--color-border-emphasis)] underline-offset-[3px] transition-normal"
      >
        or sign in with Internet Identity
      </button>
    </div>

    {/* HOW IT WORKS */}
    <div className={cn("w-full max-w-[640px]", mobile ? "mt-10" : "mt-12")}>
      <div className="text-caption font-bold text-[var(--color-text-disabled)] tracking-[2px] uppercase mb-3 text-center">How It Works</div>
      <div className={cn("grid gap-4", mobile ? "grid-cols-1 gap-3" : "grid-cols-3")}>
        {HOW_IT_WORKS.map(s => (
          <div key={s.step} className={cn(
            "bg-card border border-border rounded-lg text-center relative overflow-hidden",
            mobile ? "p-4" : "p-5"
          )}>
            <div className={cn("text-[48px] font-[800] opacity-[0.12] absolute leading-none pointer-events-none", s.colorClass, mobile ? "-top-1 right-2" : "-top-0.5 right-3")}>
              {s.step}
            </div>
            <div className={cn("mb-2", s.colorClass)}>{s.icon}</div>
            <div className="text-h3 font-semibold text-secondary-foreground mb-1">
              {s.title}
            </div>
            <p className="text-body-sm text-muted-foreground leading-normal m-0">
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* WHAT YOU GET */}
    <div className={cn("w-full max-w-[640px]", mobile ? "mt-8" : "mt-10")}>
      <div className="text-caption font-bold text-[var(--color-text-disabled)] tracking-[2px] uppercase mb-3 text-center">What You Get</div>
      <div className={cn("grid gap-4", mobile ? "grid-cols-1 gap-3" : "grid-cols-2")}>
        {OUTCOMES.map(o => (
          <div key={o.title} className={cn(
            "bg-card border border-border border-l-[3px] rounded-lg text-left transition-normal",
            o.borderClass,
            mobile ? "p-4" : "p-5"
          )}>
            <div className={cn("flex items-center gap-2 mb-2", o.colorClass)}>
              {o.icon}
              <span className={cn("text-h3 font-semibold", o.colorClass)}>{o.title}</span>
            </div>
            <p className="text-body-sm text-muted-foreground leading-normal m-0">
              {o.desc}
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* FEATURES */}
    <div className={cn("w-full max-w-[640px]", mobile ? "mt-8" : "mt-10")}>
      <div className="text-caption font-bold text-[var(--color-text-disabled)] tracking-[2px] uppercase mb-3 text-center">Features</div>
      <div className={cn("grid gap-4", mobile ? "grid-cols-1 gap-3" : "grid-cols-2")}>
        {FEATURES.map(f => (
          <div key={f.title} className={cn(
            "border rounded-lg text-left transition-normal",
            f.bgClass,
            mobile ? "p-4" : "p-5"
          )}>
            <div className={cn("flex items-center gap-2 mb-2", f.colorClass)}>
              {f.icon}
              <span className={cn("text-h3 font-semibold", f.colorClass)}>{f.title}</span>
            </div>
            <p className="text-body-sm text-muted-foreground leading-normal m-0">
              {f.desc}
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* Browser Extension */}
    <div className={cn(
      "w-full max-w-[640px] bg-gradient-to-br from-cyan-500/[0.06] to-blue-600/[0.03] border border-cyan-500/[0.19] rounded-xl text-center",
      mobile ? "mt-8 px-5 py-6" : "mt-10 px-6 py-8"
    )}>
      <div className="text-cyan-400 mb-3">
        <ChromeIcon s={32} />
      </div>
      <div className="text-h2 font-bold text-foreground mb-2">
        Aegis Score for Chrome
      </div>
      <p className="text-body-sm text-muted-foreground leading-relaxed m-0 max-w-[420px] mx-auto">
        Any page, one click. See V/C/L quality scores instantly and send articles to Aegis without leaving your browser.
      </p>
      <a
        href="https://chromewebstore.google.com/detail/aegis-score/pnnpkepiojfpkppjpoimolkamflhbjhh"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 mt-5 px-6 py-3 bg-gradient-to-br from-cyan-500 to-blue-600 border-none rounded-md text-white text-body font-bold no-underline font-sans shadow-glow-cyan transition-normal"
      >
        <ChromeIcon s={18} />
        Install Extension
      </a>
    </div>

    {/* Trust & Safety */}
    <div className={cn(
      "w-full max-w-[640px] bg-card border border-border rounded-xl text-center",
      mobile ? "mt-8 p-5" : "mt-10 p-6"
    )}>
      <div className="text-[var(--color-text-tertiary)] mb-3">
        <GitHubIcon s={24} />
      </div>
      <div className="text-h2 font-bold text-foreground mb-2">
        Open Source &amp; Non-Custodial
      </div>
      <p className="text-body-sm text-muted-foreground leading-relaxed m-0 max-w-[480px] mx-auto">
        Fully open source on GitHub. Your data stays in your browser or your own Internet Computer canister. No accounts, no tracking, no vendor lock-in.
      </p>
      <div className="flex justify-center gap-2 mt-4 flex-wrap">
        {TRUST_PILLS.map(label => (
          <span key={label} className="border border-[var(--color-border-emphasis)] rounded-full px-3 py-1 text-tiny font-semibold text-[var(--color-text-tertiary)]">
            {label}
          </span>
        ))}
      </div>
    </div>

    {/* WHO IT'S FOR */}
    <div className={cn("w-full max-w-[640px]", mobile ? "mt-8" : "mt-10")}>
      <div className="text-caption font-bold text-[var(--color-text-disabled)] tracking-[2px] uppercase mb-3 text-center">Who It&rsquo;s For</div>
      <div className={cn("grid gap-4", mobile ? "grid-cols-1 gap-3" : "grid-cols-3")}>
        {PERSONAS.map(p => (
          <div key={p.role} className={cn(
            "bg-navy-lighter border border-[var(--color-border-subtle)] border-t-2 rounded-lg",
            p.borderClass,
            mobile ? "p-4" : "p-5"
          )}>
            <div className={cn("flex items-center gap-1 mb-2", p.colorClass)}>
              {p.icon}
              <span className={cn("text-caption font-bold uppercase tracking-[1.5px]", p.colorClass)}>
                {p.role}
              </span>
            </div>
            <p className="text-body-sm text-muted-foreground leading-relaxed italic m-0">
              &ldquo;{p.quote}&rdquo;
            </p>
          </div>
        ))}
      </div>
    </div>

    {/* Footer */}
    <div className="mt-8 text-caption text-[var(--color-text-disabled)] text-center">
      <span className="font-mono">v3.0</span>
      <span> &middot; Use your browser&rsquo;s translate feature to read in your language.</span>
    </div>
  </div>
);
