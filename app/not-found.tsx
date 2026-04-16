import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col items-center justify-center p-5">
      <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-5 text-[var(--color-text-disabled)]">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>

      <h1 className="text-display font-bold text-foreground m-0 mb-3 text-center">
        Page Not Found
      </h1>

      <p className="text-body-lg text-muted-foreground text-center max-w-[400px] leading-relaxed mb-8">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>

      <Link
        href="/"
        className="inline-block px-8 py-3 bg-gradient-to-br from-purple-600 to-blue-600 rounded-md text-white text-body font-bold no-underline shadow-md transition-fast"
      >
        Go home
      </Link>
    </div>
  );
}
