import Link from "next/link";

export default function BriefingNotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col items-center justify-center p-5">
      <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-5 text-[var(--color-text-disabled)]">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>

      <h1 className="text-display font-bold text-foreground m-0 mb-3 text-center">
        Briefing Not Found
      </h1>

      <p className="text-body-lg text-muted-foreground text-center max-w-[400px] leading-relaxed mb-8">
        This briefing may have expired, been removed, or the link is invalid.
        Check the URL or try again later.
      </p>

      <Link
        href="/"
        className="inline-block px-8 py-3 bg-gradient-to-br from-purple-600 to-blue-600 rounded-md text-white text-body font-bold no-underline shadow-md transition-fast"
      >
        Try Aegis
      </Link>
    </div>
  );
}
