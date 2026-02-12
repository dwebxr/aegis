import Link from "next/link";
import { colors, space, type as t, radii, shadows, transitions, fonts } from "@/styles/theme";

export default function BriefingNotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      background: colors.bg.root,
      color: colors.text.primary,
      fontFamily: fonts.sans,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: space[5],
    }}>
      <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke={colors.text.disabled} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: space[5] }}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>

      <h1 style={{
        fontSize: t.display.size,
        fontWeight: t.display.weight,
        color: colors.text.primary,
        margin: 0,
        marginBottom: space[3],
        textAlign: "center",
      }}>
        Briefing Not Found
      </h1>

      <p style={{
        fontSize: t.bodyLg.size,
        color: colors.text.muted,
        textAlign: "center",
        maxWidth: 400,
        lineHeight: t.bodyLg.lineHeight,
        marginBottom: space[8],
      }}>
        This briefing may have expired, been removed, or the link is invalid.
        Check the URL or try again later.
      </p>

      <Link
        href="/"
        style={{
          display: "inline-block",
          padding: `${space[3]}px ${space[8]}px`,
          background: `linear-gradient(135deg, ${colors.purple[600]}, ${colors.blue[600]})`,
          borderRadius: radii.md,
          color: "#fff",
          fontSize: t.body.size,
          fontWeight: 700,
          textDecoration: "none",
          boxShadow: shadows.md,
          transition: transitions.fast,
        }}
      >
        Try Aegis
      </Link>
    </div>
  );
}
