"use client";
import React from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { ShieldIcon, ChromeIcon, GitHubIcon, SocialIcon } from "@/components/icons";
import { SOCIAL_LINKS } from "@/lib/config";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */
interface LandingHeroProps {
  onTryDemo: () => void;
  onLogin: () => void;
  mobile?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Shared layout: image + text side-by-side                           */
/* ------------------------------------------------------------------ */
interface FeatureSectionProps {
  id: string;
  heading: string;
  body: React.ReactNode;
  imageSrc: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  imageFirst?: boolean; // true = image left, text right
  imageClassName?: string; // extra classes on the image container
  mobile?: boolean;
}

const FeatureSection: React.FC<FeatureSectionProps> = ({
  id,
  heading,
  body,
  imageSrc,
  imageAlt,
  imageWidth,
  imageHeight,
  imageFirst = false,
  imageClassName,
  mobile,
}) => (
  <section
    id={id}
    className={cn(
      "w-full max-w-[1080px] mx-auto",
      mobile ? "px-5 py-10" : "px-8 py-20"
    )}
  >
    <div
      className={cn(
        "flex items-center gap-10",
        mobile ? "flex-col" : imageFirst ? "flex-row" : "flex-row-reverse"
      )}
    >
      {/* Image */}
      <div className={cn("flex-1 min-w-0", mobile && "w-full", imageClassName)}>
        <Image
          src={imageSrc}
          alt={imageAlt}
          width={imageWidth}
          height={imageHeight}
          className="w-full h-auto rounded-xl border border-border shadow-lg"
        />
      </div>
      {/* Text */}
      <div className={cn("flex-1 min-w-0", mobile && "w-full text-center")}>
        <h2
          className={cn(
            "font-[700] leading-[1.15] tracking-tight text-foreground m-0",
            mobile ? "text-[22px]" : "text-[30px]"
          )}
        >
          {heading}
        </h2>
        <div
          className={cn(
            "mt-4 text-muted-foreground leading-relaxed",
            mobile ? "text-body-sm" : "text-body"
          )}
        >
          {body}
        </div>
      </div>
    </div>
  </section>
);

/* ------------------------------------------------------------------ */
/*  Persona data                                                       */
/* ------------------------------------------------------------------ */
const PERSONAS = [
  {
    role: "Crypto traders",
    quote:
      "\u201CI don\u2019t skim 500 headlines a day anymore. I just read the 20 stories that actually move the market.\u201D",
    accent: "border-t-cyan-400",
  },
  {
    role: "Researchers",
    quote:
      "\u201CPapers and technical posts are scored on depth automatically. I spend my time reading, not triaging.\u201D",
    accent: "border-t-purple-400",
  },
  {
    role: "Newsletter writers",
    quote:
      "\u201CMy agent surfaces original analysis from 50+ feeds. The curated list becomes the backbone of my weekly digest.\u201D",
    accent: "border-t-emerald-400",
  },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export const LandingHero: React.FC<LandingHeroProps> = ({
  onTryDemo,
  onLogin,
  mobile,
}) => (
  <div
    data-testid="aegis-landing-hero"
    className="flex flex-col items-center animate-fade-in"
  >
    {/* ============================================================ */}
    {/* 1. HERO                                                       */}
    {/* ============================================================ */}
    <header
      className={cn(
        "w-full max-w-[1080px] mx-auto flex items-center",
        mobile
          ? "flex-col text-center px-5 pt-10 pb-8 gap-8"
          : "flex-row px-8 pt-16 pb-12 gap-12"
      )}
    >
      {/* Copy side */}
      <div className={cn("flex-1 min-w-0", mobile && "w-full")}>
        {/* Logo */}
        <div
          className={cn(
            "size-12 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mb-5 shadow-glow-cyan",
            mobile && "mx-auto"
          )}
        >
          <ShieldIcon s={24} />
        </div>

        <h1
          data-testid="aegis-landing-heading"
          className={cn(
            "font-[800] leading-[1.08] tracking-tight text-foreground m-0",
            mobile ? "text-[30px]" : "text-[44px] max-w-[520px]"
          )}
        >
          Cut Through the Noise in Your Feeds
        </h1>

        <p className="text-body font-semibold text-cyan-400 tracking-wide mt-3 mb-0">
          AI-powered quality filter for RSS and social feeds. Free and open
          source.
        </p>

        <p
          className={cn(
            "leading-relaxed text-muted-foreground mt-3 mb-0",
            mobile ? "text-body-sm" : "text-body",
            !mobile && "max-w-[480px]"
          )}
        >
          Your AI agent learns what matters to you and filters out the slop
          — so you only see content worth your time.
        </p>

        {/* CTAs */}
        <div
          className={cn(
            "flex gap-3 mt-7",
            mobile ? "flex-col w-full" : "flex-row items-center"
          )}
        >
          <button
            type="button"
            data-testid="aegis-landing-try-demo"
            onClick={onTryDemo}
            className={cn(
              "px-7 py-3 bg-gradient-to-br from-blue-600 to-cyan-500 border-none rounded-md text-white text-body font-bold cursor-pointer font-sans shadow-glow-cyan transition-normal",
              mobile && "w-full"
            )}
          >
            Try the Demo
          </button>
          <button
            type="button"
            data-testid="aegis-landing-login"
            onClick={onLogin}
            className={cn(
              "px-5 py-3 bg-card border border-border rounded-md text-secondary-foreground text-body font-semibold cursor-pointer font-sans transition-normal",
              mobile && "w-full"
            )}
          >
            Sign in with Internet Identity
          </button>
        </div>
      </div>

      {/* Hero image */}
      <div className={cn("flex-1 min-w-0", mobile && "w-full")}>
        <Image
          src="/images/home-feed.png"
          alt="Aegis home feed showing filtered, high-signal content"
          width={900}
          height={459}
          priority
          className="w-full h-auto rounded-xl border border-border shadow-lg"
        />
      </div>
    </header>

    {/* ============================================================ */}
    {/* 2. HOW IT WORKS                                               */}
    {/* ============================================================ */}
    <section
      className={cn(
        "w-full max-w-[1080px] mx-auto",
        mobile ? "px-5 py-10" : "px-8 py-16"
      )}
    >
      <h2
        className={cn(
          "text-center font-[700] tracking-tight text-foreground m-0 mb-8",
          mobile ? "text-[20px]" : "text-[26px]"
        )}
      >
        How it works
      </h2>

      <div
        className={cn("grid gap-6", mobile ? "grid-cols-1" : "grid-cols-3")}
      >
        {[
          {
            n: "1",
            title: "Add your feeds",
            desc: "Connect the RSS feeds and social sources you already follow.",
            color: "text-cyan-400",
          },
          {
            n: "2",
            title: "AI filters out the slop",
            desc: "Every item is scored for quality, originality, and trust, and low-effort content gets filtered out.",
            color: "text-blue-400",
          },
          {
            n: "3",
            title: "Read only what matters",
            desc: "Get a daily reading list with the few pieces that are truly worth your time.",
            color: "text-emerald-400",
          },
        ].map((s) => (
          <div
            key={s.n}
            className={cn(
              "bg-card border border-border rounded-lg text-center relative overflow-hidden",
              mobile ? "p-5" : "p-6"
            )}
          >
            <div
              className={cn(
                "text-[52px] font-[800] opacity-[0.10] absolute leading-none pointer-events-none -top-0.5 right-3",
                s.color
              )}
            >
              {s.n}
            </div>
            <div
              className={cn(
                "text-h3 font-semibold text-foreground mb-1",
                mobile ? "text-[16px]" : "text-[17px]"
              )}
            >
              {s.title}
            </div>
            <p className="text-body-sm text-muted-foreground leading-normal m-0">
              {s.desc}
            </p>
          </div>
        ))}
      </div>
    </section>

    {/* Divider */}
    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 3. CONTENT SOURCES                                            */}
    {/* ============================================================ */}
    <FeatureSection
      id="sources"
      heading="Add RSS and social sources in one place"
      body={
        <>
          <p className="m-0">
            Add RSS, YouTube, Reddit, Bluesky, Mastodon, and more from one tab.
          </p>
          <p className="m-0 mt-2">
            Paste any feed URL or use quick-add presets.
          </p>
        </>
      }
      imageSrc="/images/sources.png"
      imageAlt="Sources tab with quick-add presets"
      imageWidth={640}
      imageHeight={640}
      imageFirst
      mobile={mobile}
    />

    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 4. AI SCORING (V/C/L)                                         */}
    {/* ============================================================ */}
    <FeatureSection
      id="scoring"
      heading="AI that knows what's real — and what's slop"
      body={
        <>
          <p className="m-0">
            Every item is scored on novelty, relevance, and slop.
          </p>
          <p className="m-0 mt-2">
            Validate or Flag to keep refining — your feed gets sharper
            with every click.
          </p>
        </>
      }
      imageSrc="/images/wot.png"
      imageAlt="V/C/L scoring visualization"
      imageWidth={640}
      imageHeight={640}
      imageFirst={false}
      mobile={mobile}
    />

    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 5. HOME DASHBOARD                                             */}
    {/* ============================================================ */}
    <FeatureSection
      id="dashboard"
      heading="Escape the infinite scroll"
      body={
        <>
          <p className="m-0 font-semibold text-secondary-foreground">
            Top&nbsp;3, Spotlight, Discoveries, Needs Review — all on one
            screen.
          </p>
          <p className="m-0 mt-2">
            No infinite scroll, just a concise overview of what matters right
            now.
          </p>
        </>
      }
      imageSrc="/images/home-dashboard.png"
      imageAlt="Aegis home dashboard with curated sections"
      imageWidth={778}
      imageHeight={778}
      imageFirst
      mobile={mobile}
    />

    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 6. BRIEFINGS                                                  */}
    {/* ============================================================ */}
    <FeatureSection
      id="briefings"
      heading="The luxury of only reading what matters"
      body={
        <>
          <p className="m-0">
            A daily curated reading list from all your feeds.
          </p>
          <p className="m-0 mt-2">
            One morning briefing covers everything that matters.
          </p>
        </>
      }
      imageSrc="/images/Briefing.png"
      imageAlt="Morning briefing with curated reading list"
      imageWidth={733}
      imageHeight={727}
      imageFirst={false}
      mobile={mobile}
    />

    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 7. AGENT NETWORK (D2A)                                        */}
    {/* ============================================================ */}
    <FeatureSection
      id="d2a"
      heading="A new layer of signal, beyond big social"
      body={
        <>
          <p className="m-0">
            Your agent discovers quality content and exchanges it with other
            agents, end-to-end encrypted.
          </p>
          <p className="m-0 mt-2">
            Curators you trust rank higher through your Web of Trust.
          </p>
        </>
      }
      imageSrc="/images/d2a.png"
      imageAlt="D2A agent network exchanging content"
      imageWidth={502}
      imageHeight={502}
      imageFirst
      mobile={mobile}
    />

    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 8. MOBILE & PWA                                               */}
    {/* ============================================================ */}
    <FeatureSection
      id="mobile"
      heading="Read anywhere, like a native app"
      body={
        <>
          <p className="m-0">
            Add to your home screen for a native-app reading experience.
          </p>
          <p className="m-0 mt-2">
            Works on any mobile browser — just tap &ldquo;Add to Home
            Screen.&rdquo;
          </p>
        </>
      }
      imageSrc="/images/mobile.png"
      imageAlt="Aegis on a mobile device"
      imageWidth={535}
      imageHeight={969}
      imageClassName={mobile ? undefined : "max-w-[280px]"}
      imageFirst={false}
      mobile={mobile}
    />

    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 9. CHROME EXTENSION & OPENNESS                                */}
    {/* ============================================================ */}
    <section
      className={cn(
        "w-full max-w-[1080px] mx-auto",
        mobile ? "px-5 py-10" : "px-8 py-20"
      )}
    >
      <div
        className={cn(
          "grid gap-6",
          mobile ? "grid-cols-1" : "grid-cols-2"
        )}
      >
        {/* Chrome Extension */}
        <div
          className={cn(
            "bg-gradient-to-br from-cyan-500/[0.06] to-blue-600/[0.03] border border-cyan-500/[0.19] rounded-xl",
            mobile ? "p-6" : "p-8"
          )}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="text-cyan-400">
              <ChromeIcon s={28} />
            </div>
            <h3 className="text-h2 font-bold text-foreground m-0">
              Aegis Score for Chrome
            </h3>
          </div>
          <p className="m-0 text-muted-foreground text-body-sm leading-relaxed">
            One-click quality scores on any page — send articles to Aegis
            without leaving your browser.
          </p>
          <a
            href="https://chromewebstore.google.com/detail/aegis-score/pnnpkepiojfpkppjpoimolkamflhbjhh"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 bg-gradient-to-br from-cyan-500 to-blue-600 border-none rounded-md text-white text-body-sm font-bold no-underline font-sans shadow-glow-cyan transition-normal"
          >
            <ChromeIcon s={16} />
            Install Extension
          </a>
        </div>

        {/* Open Source */}
        <div
          className={cn(
            "bg-card border border-border rounded-xl",
            mobile ? "p-6" : "p-8"
          )}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="text-tertiary">
              <GitHubIcon s={28} />
            </div>
            <h3 className="text-h2 font-bold text-foreground m-0">
              Open Source &amp; Non-Custodial
            </h3>
          </div>
          <p className="m-0 text-muted-foreground text-body-sm leading-relaxed">
            Fully open source. Your data stays in your browser or your own
            Internet Computer — no accounts, no tracking.
          </p>
          <div className="flex gap-2 mt-5 flex-wrap">
            {["Open Source", "Self-Custodial", "No Tracking"].map((label) => (
              <span
                key={label}
                className="border border-emphasis rounded-full px-3 py-1 text-tiny font-semibold text-tertiary"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>

    <hr className="w-full max-w-[1080px] border-t border-border m-0" />

    {/* ============================================================ */}
    {/* 10. WHO IT'S FOR                                              */}
    {/* ============================================================ */}
    <section
      className={cn(
        "w-full max-w-[1080px] mx-auto text-center",
        mobile ? "px-5 py-10" : "px-8 py-20"
      )}
    >
      <h2
        className={cn(
          "font-[700] tracking-tight text-foreground m-0 mb-8",
          mobile ? "text-[20px]" : "text-[26px]"
        )}
      >
        Built for people who live on signal
      </h2>

      <div
        className={cn("grid gap-6", mobile ? "grid-cols-1" : "grid-cols-3")}
      >
        {PERSONAS.map((p) => (
          <div
            key={p.role}
            className={cn(
              "bg-card border border-border border-t-2 rounded-lg text-left",
              p.accent,
              mobile ? "p-5" : "p-6"
            )}
          >
            <div className="text-caption font-bold uppercase tracking-[1.5px] text-secondary-foreground mb-3">
              {p.role}
            </div>
            <p className="text-body-sm text-muted-foreground leading-relaxed italic m-0">
              {p.quote}
            </p>
          </div>
        ))}
      </div>
    </section>

    {/* ============================================================ */}
    {/* 11. CLOSING CTA                                               */}
    {/* ============================================================ */}
    <section
      className={cn(
        "w-full max-w-[1080px] mx-auto text-center",
        mobile ? "px-5 pt-10 pb-6" : "px-8 pt-20 pb-10"
      )}
    >
      <h2
        className={cn(
          "font-[700] tracking-tight text-foreground m-0",
          mobile ? "text-[22px]" : "text-[30px]"
        )}
      >
        Start collecting information for the next era
      </h2>

      <p
        className={cn(
          "text-muted-foreground leading-relaxed mt-4 mb-0 max-w-[520px] mx-auto",
          mobile ? "text-body-sm" : "text-body"
        )}
      >
        Stop scrolling engagement-optimized feeds — start reading with zero
        slop.
      </p>

      <button
        type="button"
        onClick={onTryDemo}
        className={cn(
          "mt-7 px-8 py-3 bg-gradient-to-br from-blue-600 to-cyan-500 border-none rounded-md text-white text-body font-bold cursor-pointer font-sans shadow-glow-cyan transition-normal",
          mobile && "w-full"
        )}
      >
        Try the Demo for Free
      </button>
    </section>

    {/* Footer */}
    <footer className="w-full text-center py-8 text-caption text-disabled">
      <div className="flex items-center justify-center gap-5 mb-4">
        {SOCIAL_LINKS.map(link => (
          <a key={link.key} href={link.href} target="_blank" rel="noopener noreferrer" title={link.title} className="text-disabled hover:text-primary transition-normal">
            <SocialIcon name={link.key} s={22} />
          </a>
        ))}
      </div>
      <span className="font-mono">Aegis v3.0</span>
      <span>
        {" "}
        &middot; Use your browser&rsquo;s translate feature to read in your
        language.
      </span>
    </footer>
  </div>
);
