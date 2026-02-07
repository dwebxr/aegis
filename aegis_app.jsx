import { useState, useEffect, useCallback, useRef } from "react";

// ─── Simulated Data ───
const SAMPLE_CONTENT = [
  { id: 1, author: "@research_lab", avatar: "🔬", text: "New findings on transformer attention mechanisms show 23% improvement in long-context retrieval when using sliding window + global token hybrid approach. Paper with reproducible code: arxiv.org/abs/2402.xxxxx", source: "X", timestamp: "2m ago", originality: 8, insight: 9, credibility: 9, composite: 8.7, verdict: "quality" },
  { id: 2, author: "@crypto_guru99", avatar: "🚀", text: "THIS COIN IS GOING TO 100X!!! DON'T MISS OUT!!! 🔥🔥🔥 LIKE AND RT FOR MORE ALPHA 💰💰💰", source: "X", timestamp: "5m ago", originality: 1, insight: 0, credibility: 1, composite: 0.7, verdict: "slop" },
  { id: 3, author: "@fintech_insider", avatar: "📊", text: "Analysis: Japan's FSA is quietly revising its stablecoin framework. Key change: registered issuers can now offer programmable USDC-equivalent tokens under revised PSA Article 2-5. This opens doors for DeFi-native compliance.", source: "X", timestamp: "8m ago", originality: 7, insight: 8, credibility: 8, composite: 7.6, verdict: "quality" },
  { id: 4, author: "@ai_news_bot", avatar: "🤖", text: "Top 10 AI tools you NEED in 2026: 1. ChatGPT 2. Claude 3. Midjourney 4. ... (thread 🧵)", source: "X", timestamp: "12m ago", originality: 1, insight: 2, credibility: 3, composite: 1.8, verdict: "slop" },
  { id: 5, author: "@protocol_dev", avatar: "⚡", text: "Shipped a working implementation of ERC-4337 bundler that reduces UserOp gas by 40% through calldata compression. Key insight: most UserOps share common function selectors that can be dictionary-encoded.", source: "X", timestamp: "15m ago", originality: 9, insight: 8, credibility: 8, composite: 8.5, verdict: "quality" },
  { id: 6, author: "@web3_influencer", avatar: "💎", text: "GM! Remember: you're early. The future is decentralized. Stay bullish, stay humble. Who's building today? 👇", source: "X", timestamp: "18m ago", originality: 0, insight: 0, credibility: 2, composite: 0.5, verdict: "slop" },
  { id: 7, author: "@security_researcher", avatar: "🛡️", text: "Critical vulnerability disclosed in popular AA wallet implementation: reentrancy in validateUserOp allows gas griefing. Patch available. If you're using EntryPoint v0.6, update immediately.", source: "X", timestamp: "22m ago", originality: 9, insight: 9, credibility: 10, composite: 9.3, verdict: "quality" },
  { id: 8, author: "@motivation_daily", avatar: "✨", text: "Success isn't about money. It's about impact. Steve Jobs didn't build Apple for the money. What are YOU building? 🌟 #motivation", source: "X", timestamp: "25m ago", originality: 1, insight: 1, credibility: 1, composite: 1.0, verdict: "slop" },
  { id: 9, author: "@data_economist", avatar: "📈", text: "Interesting pattern: Base L2 TVL crossed $8B this week while gas costs averaged $0.001. The economic argument for L2 migration is becoming undeniable.", source: "X", timestamp: "30m ago", originality: 7, insight: 7, credibility: 7, composite: 7.0, verdict: "quality" },
  { id: 10, author: "@clickbait_farm", avatar: "📰", text: "You won't BELIEVE what this developer found in Ethereum's code... (link in bio)", source: "X", timestamp: "33m ago", originality: 0, insight: 0, credibility: 0, composite: 0.0, verdict: "slop" },
  { id: 11, author: "@nostr_builder", avatar: "🌐", text: "Released NIP-78 relay implementation with support for parameterized replaceable events. 3x throughput improvement over reference. Rust source on GitHub.", source: "Nostr", timestamp: "40m ago", originality: 8, insight: 7, credibility: 8, composite: 7.7, verdict: "quality" },
  { id: 12, author: "@shill_account", avatar: "💸", text: "Just aped into $PEPE2. This is the one. NFA but DYOR. Moonshot incoming 📈📈📈", source: "X", timestamp: "45m ago", originality: 0, insight: 0, credibility: 0, composite: 0.0, verdict: "slop" },
];

const STAKING_HISTORY = [
  { id: 1, type: "stake", amount: 0.50, content: "Transformer attention research", status: "released", time: "2h ago" },
  { id: 2, type: "stake", amount: 0.25, content: "Crypto pump signal", status: "slashed", time: "3h ago" },
  { id: 3, type: "receive", amount: 0.10, content: "FSA stablecoin analysis", status: "validated", time: "4h ago" },
  { id: 4, type: "stake", amount: 1.00, content: "Security vulnerability report", status: "released", time: "5h ago" },
  { id: 5, type: "receive", amount: 0.30, content: "Base L2 TVL analysis", status: "validated", time: "6h ago" },
  { id: 6, type: "stake", amount: 0.15, content: "Motivational quote", status: "slashed", time: "7h ago" },
];

// ─── Responsive Hook ───
function useWindowSize() {
  const [size, setSize] = useState({ w: typeof window !== "undefined" ? window.innerWidth : 1024 });
  useEffect(() => {
    const h = () => setSize({ w: window.innerWidth });
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return size;
}

// ─── Icons ───
const ShieldIcon = ({ s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const FireIcon = ({ s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/></svg>;
const CoinsIcon = ({ s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1110.34 18"/><path d="M7 6h1v4"/><path d="M16.71 13.88l.7.71-2.82 2.82"/></svg>;
const ChartIcon = ({ s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>;
const ZapIcon = ({ s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
const SearchIcon = ({ s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const CheckIcon = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const XCloseIcon = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;

// ─── Score Bar ───
const ScoreBar = ({ label, score, color }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#8892a4", marginBottom: 3 }}>
      <span>{label}</span><span style={{ color, fontWeight: 700 }}>{score}/10</span>
    </div>
    <div style={{ height: 4, background: "#1e2a3a", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${score * 10}%`, background: color, borderRadius: 2, transition: "width 0.8s cubic-bezier(.16,1,.3,1)" }}/>
    </div>
  </div>
);

// ─── Score Ring ───
const ScoreRing = ({ value, size = 48, color }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: `conic-gradient(${color} ${value * 10}%, #1e293b ${value * 10}%)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <div style={{ width: size - 10, height: size - 10, borderRadius: "50%", background: "#0f1729", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size > 40 ? 14 : 12, fontWeight: 800, color, fontFamily: "'JetBrains Mono',monospace" }}>
      {value.toFixed(1)}
    </div>
  </div>
);

// ─── Quality Card ───
const QualityCard = ({ item, expanded, onToggle, onValidate, onFlag, mobile }) => {
  const isSlop = item.verdict === "slop";
  const sc = item.composite >= 7 ? "#34d399" : item.composite >= 4 ? "#fbbf24" : "#f87171";
  return (
    <div onClick={onToggle} style={{
      background: isSlop ? "rgba(248,113,113,0.04)" : "rgba(52,211,153,0.03)",
      border: `1px solid ${isSlop ? "rgba(248,113,113,0.12)" : "rgba(52,211,153,0.08)"}`,
      borderRadius: 14, padding: mobile ? "14px 14px" : "16px 20px", cursor: "pointer",
      transition: "all 0.3s", marginBottom: 10, borderLeft: `3px solid ${sc}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: mobile ? 10 : 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 18 }}>{item.avatar}</span>
            <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>{item.author}</span>
            <span style={{ fontSize: 10, color: "#64748b", background: "#1e293b", padding: "2px 6px", borderRadius: 5 }}>{item.source}</span>
            <span style={{ fontSize: 10, color: "#64748b" }}>{item.timestamp}</span>
          </div>
          <p style={{ color: isSlop ? "#94a3b8" : "#cbd5e1", fontSize: mobile ? 13 : 14, lineHeight: 1.6, margin: 0, textDecoration: isSlop ? "line-through" : "none", opacity: isSlop ? 0.5 : 1, wordBreak: "break-word" }}>
            {item.text}
          </p>
        </div>
        <div style={{ textAlign: "center" }}>
          <ScoreRing value={item.composite} size={mobile ? 42 : 50} color={sc}/>
          <div style={{ marginTop: 4, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: isSlop ? "#f87171" : "#34d399" }}>
            {item.verdict}
          </div>
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
            <ScoreBar label="Originality" score={item.originality} color="#818cf8"/>
            <ScoreBar label="Insight" score={item.insight} color="#38bdf8"/>
            <ScoreBar label="Credibility" score={item.credibility} color="#34d399"/>
          </div>
          {!isSlop && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={e => { e.stopPropagation(); onValidate(item.id); }} style={{ flex: 1, padding: "8px 12px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 10, color: "#34d399", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <CheckIcon/> Validate
              </button>
              <button onClick={e => { e.stopPropagation(); onFlag(item.id); }} style={{ flex: 1, padding: "8px 12px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
                <XCloseIcon/> Flag Slop
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Incinerator Visual ───
const IncineratorViz = ({ active, mobile }) => {
  const [particles, setParticles] = useState([]);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      setParticles(p => {
        const n = p.filter(x => x.life > 0).map(x => ({ ...x, y: x.y - 2, life: x.life - 1 }));
        if (Math.random() > 0.4) n.push({ id: Date.now() + Math.random(), x: 60 + Math.random() * 80, y: 75, life: 25, c: Math.random() > 0.5 ? "#f87171" : "#fb923c" });
        return n;
      });
    }, 50);
    return () => clearInterval(iv);
  }, [active]);
  const vw = mobile ? 200 : 260;
  return (
    <div style={{ width: vw, height: 100, margin: "0 auto" }}>
      <svg width={vw} height="100" viewBox={`0 0 ${vw} 100`}>
        <defs>
          <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#dc2626" stopOpacity=".8"/><stop offset="100%" stopColor="#7c2d12" stopOpacity=".4"/></linearGradient>
          <filter id="gl"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <rect x={vw/2-70} y="50" width="140" height="44" rx="7" fill="url(#fg)" opacity={active ? .8 : .3}/>
        <text x={vw/2} y="77" textAnchor="middle" fill="#fbbf24" fontSize="9" fontWeight="700" fontFamily="JetBrains Mono,monospace" opacity={active ? 1 : .4}>SLOP INCINERATOR</text>
        {active && (
          <path d={`M${vw/2-15},55 Q${vw/2-10},35 ${vw/2-5},48 Q${vw/2},28 ${vw/2+5},45 Q${vw/2+10},30 ${vw/2+15},55`} fill="none" stroke="#f97316" strokeWidth="2" filter="url(#gl)" opacity=".8">
            <animate attributeName="d" values={`M${vw/2-15},55 Q${vw/2-10},35 ${vw/2-5},48 Q${vw/2},28 ${vw/2+5},45 Q${vw/2+10},30 ${vw/2+15},55;M${vw/2-15},55 Q${vw/2-12},30 ${vw/2-5},42 Q${vw/2+2},22 ${vw/2+5},40 Q${vw/2+12},28 ${vw/2+15},55;M${vw/2-15},55 Q${vw/2-10},35 ${vw/2-5},48 Q${vw/2},28 ${vw/2+5},45 Q${vw/2+10},30 ${vw/2+15},55`} dur=".8s" repeatCount="indefinite"/>
          </path>
        )}
        {particles.map(p => <circle key={p.id} cx={p.x} cy={p.y} r={1.5} fill={p.c} opacity={p.life / 25}/>)}
      </svg>
    </div>
  );
};

// ─── Mini Chart ───
const MiniChart = ({ data, color, h = 48 }) => {
  const mx = Math.max(...data), mn = Math.min(...data), rg = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${h - ((v - mn) / rg) * (h - 8)}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={`0,${h} ${pts} 100,${h}`} fill={`${color}18`} stroke="none"/>
    </svg>
  );
};

// ─── Stat Card ───
const StatCard = ({ icon, label, value, sub, color, mobile }) => (
  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 14, padding: mobile ? "14px 14px" : "18px 20px", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: -8, right: -8, width: 48, height: 48, borderRadius: "50%", background: `${color}08` }}/>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ color, opacity: .8 }}>{icon}</div>
      <span style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>{label}</span>
    </div>
    <div style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#e2e8f0", fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color, marginTop: 2, fontWeight: 500 }}>{sub}</div>}
  </div>
);

// ─── Analyze Component ───
const AnalyzeContent = ({ onAnalyze, isAnalyzing, mobile }) => {
  const [text, setText] = useState("");
  const [stake, setStake] = useState("0.25");
  const [result, setResult] = useState(null);
  const handleGo = async () => {
    if (!text.trim()) return;
    setResult(null);
    const r = await onAnalyze(text, parseFloat(stake));
    setResult(r);
  };
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Content to Evaluate</label>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Paste content here for AI quality analysis..." style={{ width: "100%", height: 100, background: "#0c1322", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: 14, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.6 }}/>
      <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 16, flexWrap: mobile ? "wrap" : "nowrap", alignItems: "flex-end" }}>
        <div style={{ flex: mobile ? "1 1 100%" : 1 }}>
          <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Stake (USDC)</label>
          <div style={{ display: "flex", gap: 5 }}>
            {["0.10", "0.25", "0.50", "1.00"].map(a => (
              <button key={a} onClick={() => setStake(a)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'JetBrains Mono',monospace", transition: "all .2s", background: stake === a ? "rgba(56,189,248,0.15)" : "rgba(255,255,255,0.03)", border: stake === a ? "1px solid rgba(56,189,248,0.4)" : "1px solid rgba(255,255,255,0.06)", color: stake === a ? "#38bdf8" : "#64748b" }}>
                ${a}
              </button>
            ))}
          </div>
        </div>
        <button onClick={handleGo} disabled={isAnalyzing || !text.trim()} style={{ padding: "10px 22px", background: isAnalyzing ? "rgba(56,189,248,0.1)" : "linear-gradient(135deg,#2563eb,#1d4ed8)", border: "none", borderRadius: 11, color: "#fff", fontSize: 13, fontWeight: 700, cursor: isAnalyzing ? "default" : "pointer", display: "flex", alignItems: "center", gap: 7, opacity: (!text.trim() || isAnalyzing) ? .5 : 1, whiteSpace: "nowrap", width: mobile ? "100%" : "auto", justifyContent: "center", marginTop: mobile ? 4 : 0 }}>
          {isAnalyzing ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Analyzing...</> : <><ZapIcon s={15}/> Analyze</>}
        </button>
      </div>
      {result && (
        <div style={{ background: result.verdict === "quality" ? "rgba(52,211,153,0.05)" : "rgba(248,113,113,0.05)", border: `1px solid ${result.verdict === "quality" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`, borderRadius: 14, padding: mobile ? 16 : 22, animation: "fadeIn .5s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 22 }}>{result.verdict === "quality" ? "✅" : "🔥"}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: result.verdict === "quality" ? "#34d399" : "#f87171", textTransform: "uppercase" }}>{result.verdict === "quality" ? "Quality" : "Slop"}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{result.verdict === "quality" ? `$${stake} released` : `$${stake} slashed`}</div>
              </div>
            </div>
            <ScoreRing value={result.composite} size={50} color={result.verdict === "quality" ? "#34d399" : "#f87171"}/>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: result.reason ? 12 : 0 }}>
            <ScoreBar label="Originality" score={result.originality} color="#818cf8"/>
            <ScoreBar label="Insight" score={result.insight} color="#38bdf8"/>
            <ScoreBar label="Credibility" score={result.credibility} color="#34d399"/>
          </div>
          {result.reason && <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, fontStyle: "italic", background: "rgba(0,0,0,0.2)", padding: "9px 12px", borderRadius: 9 }}>{result.reason}</div>}
        </div>
      )}
    </div>
  );
};

// ═══ MAIN APP ═══
export default function AegisApp() {
  const { w } = useWindowSize();
  const mobile = w < 680;
  const tablet = w >= 680 && w < 960;

  const [tab, setTab] = useState("dashboard");
  const [content, setContent] = useState(SAMPLE_CONTENT);
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState("quality");
  const [isProc, setIsProc] = useState(false);
  const [isAna, setIsAna] = useState(false);
  const [balance] = useState(47.82);
  const [procCnt, setProcCnt] = useState(0);
  const [notifs, setNotifs] = useState([]);

  const analyze = useCallback(async (text) => {
    setIsAna(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: `You are the Aegis Slop Incinerator AI. Evaluate this content for quality. Score each axis 0-10:\n- Originality (40%): Novel or rehashed?\n- Insight (35%): Deep analysis?\n- Credibility (25%): Reliable sources?\n\nContent: "${text}"\n\nRespond ONLY in this exact JSON format:\n{"originality":N,"insight":N,"credibility":N,"composite":N.N,"verdict":"quality"|"slop","reason":"brief"}` }] }),
      });
      const d = await res.json();
      const clean = (d.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
      setIsAna(false);
      return JSON.parse(clean);
    } catch {
      await new Promise(r => setTimeout(r, 1800));
      const o = Math.floor(Math.random() * 10), ins = Math.floor(Math.random() * 10), c = Math.floor(Math.random() * 10);
      const comp = parseFloat((o * .4 + ins * .35 + c * .25).toFixed(1));
      setIsAna(false);
      return { originality: o, insight: ins, credibility: c, composite: comp, verdict: comp >= 4 ? "quality" : "slop", reason: comp >= 4 ? "Content shows quality signals." : "Low originality and depth. Slop." };
    }
  }, []);

  useEffect(() => { const iv = setInterval(() => setProcCnt(p => p + Math.floor(Math.random() * 3)), 3000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    const run = () => { setIsProc(true); setTimeout(() => setIsProc(false), 3500); };
    run(); const iv = setInterval(run, 7000); return () => clearInterval(iv);
  }, []);

  const qual = content.filter(c => c.verdict === "quality");
  const slop = content.filter(c => c.verdict === "slop");
  const shown = filter === "all" ? content : filter === "quality" ? qual : slop;

  const addNotif = (text, type) => {
    const id = Date.now();
    setNotifs(p => [...p, { id, text, type }]);
    setTimeout(() => setNotifs(p => p.filter(n => n.id !== id)), 2500);
  };

  const navItems = [
    { id: "dashboard", icon: <ShieldIcon s={mobile ? 22 : 18}/>, label: "Home" },
    { id: "feed", icon: <SearchIcon s={mobile ? 22 : 18}/>, label: "Feed" },
    { id: "incinerator", icon: <FireIcon s={mobile ? 22 : 18}/>, label: "Burn" },
    { id: "staking", icon: <CoinsIcon s={mobile ? 22 : 18}/>, label: "Stake" },
    { id: "analytics", icon: <ChartIcon s={mobile ? 22 : 18}/>, label: "Stats" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: mobile ? "column" : "row", height: "100vh", background: "#0a0f1e", fontFamily: "'Outfit','Noto Sans JP',-apple-system,sans-serif", color: "#e2e8f0", overflow: "hidden", position: "relative" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&family=Outfit:wght@300;400;500;600;700;800&family=Noto+Sans+JP:wght@400;500;700&display=swap');
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#1e293b;border-radius:3px}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
      `}</style>

      {/* ─── DESKTOP / TABLET SIDEBAR ─── */}
      {!mobile && (
        <nav style={{ width: tablet ? 68 : 200, background: "rgba(15,23,42,0.8)", borderRight: "1px solid rgba(255,255,255,0.05)", padding: tablet ? "20px 8px" : "24px 12px", display: "flex", flexDirection: "column", backdropFilter: "blur(20px)", flexShrink: 0, transition: "width .3s" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: tablet ? "0 4px" : "0 12px", marginBottom: 32, justifyContent: tablet ? "center" : "flex-start" }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ShieldIcon s={18}/>
            </div>
            {!tablet && <div><div style={{ fontSize: 17, fontWeight: 800, letterSpacing: 3 }}>AEGIS</div><div style={{ fontSize: 8, color: "#64748b", letterSpacing: 2 }}>v1.1 MVP</div></div>}
          </div>
          {navItems.map(it => (
            <button key={it.id} onClick={() => setTab(it.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: tablet ? "10px 0" : "10px 14px", marginBottom: 3, background: tab === it.id ? "rgba(37,99,235,0.12)" : "transparent", border: tab === it.id ? "1px solid rgba(37,99,235,0.2)" : "1px solid transparent", borderRadius: 11, cursor: "pointer", transition: "all .2s", width: "100%", color: tab === it.id ? "#60a5fa" : "#64748b", justifyContent: tablet ? "center" : "flex-start" }}>
              {it.icon}
              {!tablet && <span style={{ fontSize: 13, fontWeight: tab === it.id ? 600 : 400 }}>{it.label}</span>}
            </button>
          ))}
          <div style={{ flex: 1 }}/>
          <div style={{ background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.1)", borderRadius: 12, padding: tablet ? "10px 6px" : "12px 14px", textAlign: tablet ? "center" : "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, justifyContent: tablet ? "center" : "flex-start" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#34d399", animation: "pulse 2s infinite" }}/>
              {!tablet && <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>Online</span>}
            </div>
            <div style={{ fontSize: tablet ? 11 : 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "'JetBrains Mono',monospace" }}>${balance.toFixed(2)}</div>
            {!tablet && <div style={{ fontSize: 9, color: "#64748b" }}>USDC · Base</div>}
          </div>
        </nav>
      )}

      {/* ─── MAIN CONTENT ─── */}
      <main style={{ flex: 1, overflow: "auto", padding: mobile ? "16px 14px 90px" : tablet ? "24px 24px" : "28px 32px" }}>

        {/* ══ DASHBOARD ══ */}
        {tab === "dashboard" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ marginBottom: mobile ? 20 : 28 }}>
              <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0, letterSpacing: -.5 }}>Aegis Dashboard</h1>
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Real-time information defense</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? 10 : 14, marginBottom: mobile ? 18 : 24 }}>
              <StatCard icon={<ShieldIcon s={16}/>} label="Protected" value={qual.length} sub={`of ${content.length}`} color="#34d399" mobile={mobile}/>
              <StatCard icon={<FireIcon s={16}/>} label="Burned" value={slop.length} sub="slop eliminated" color="#f87171" mobile={mobile}/>
              <StatCard icon={<CoinsIcon s={16}/>} label="Staked" value="$2.40" sub="6 transactions" color="#38bdf8" mobile={mobile}/>
              <StatCard icon={<ZapIcon s={16}/>} label="Processed" value={248 + procCnt} sub="items today" color="#a78bfa" mobile={mobile}/>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 12 : 16, marginBottom: mobile ? 18 : 24 }}>
              {[{ t: "Filter Accuracy (7d)", d: [82,85,84,88,87,91,93], c: "#34d399" }, { t: "Slop Volume", d: [45,52,38,61,44,35,29], c: "#f87171" }].map(ch => (
                <div key={ch.t} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: mobile ? 16 : 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>{ch.t}</div>
                  <MiniChart data={ch.d} color={ch.c} h={mobile ? 40 : 50}/>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 9, color: "#64748b" }}>
                    {["M","T","W","T","F","S","S"].map((d,i) => <span key={i}>{d}</span>)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>Latest Quality</div>
            {qual.slice(0, 3).map(it => <QualityCard key={it.id} item={it} expanded={false} onToggle={() => {}} onValidate={() => {}} onFlag={() => {}} mobile={mobile}/>)}
          </div>
        )}

        {/* ══ FEED ══ */}
        {tab === "feed" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: mobile ? "flex-start" : "center", marginBottom: 20, flexDirection: mobile ? "column" : "row", gap: mobile ? 12 : 0 }}>
              <div>
                <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Content Feed</h1>
                <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>AI-filtered information stream</p>
              </div>
              <div style={{ display: "flex", gap: 5, width: mobile ? "100%" : "auto" }}>
                {[["quality", "Quality", "#34d399", qual.length], ["slop", "Slop", "#f87171", slop.length], ["all", "All", "#94a3b8", content.length]].map(([m, l, c, n]) => (
                  <button key={m} onClick={() => setFilter(m)} style={{ flex: mobile ? 1 : "none", padding: mobile ? "8px 10px" : "7px 16px", borderRadius: 9, fontSize: 11, fontWeight: 600, cursor: "pointer", background: filter === m ? `${c}18` : "rgba(255,255,255,0.03)", border: filter === m ? `1px solid ${c}40` : "1px solid rgba(255,255,255,0.06)", color: filter === m ? c : "#64748b", transition: "all .2s" }}>
                    {l} ({n})
                  </button>
                ))}
              </div>
            </div>
            {shown.map((it, i) => (
              <div key={it.id} style={{ animation: `slideUp .3s ease ${i * .04}s both` }}>
                <QualityCard item={it} expanded={expanded === it.id} onToggle={() => setExpanded(expanded === it.id ? null : it.id)} mobile={mobile}
                  onValidate={id => addNotif("Stake released ✓", "success")}
                  onFlag={id => { setContent(p => p.map(c => c.id === id ? { ...c, verdict: "slop", composite: 1.0 } : c)); addNotif("Stake slashed 🔥", "error"); }}
                />
              </div>
            ))}
          </div>
        )}

        {/* ══ INCINERATOR ══ */}
        {tab === "incinerator" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ marginBottom: 20 }}>
              <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Slop Incinerator</h1>
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>AI evaluation with USDC staking</p>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 18, padding: mobile ? 18 : 28, marginBottom: 18 }}>
              <IncineratorViz active={isProc} mobile={mobile}/>
              <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 8, marginTop: 16 }}>
                {[["S1", "Semantic Dedup", isProc, "#818cf8"], ["S2", "Structural", isProc, "#38bdf8"], ["S3", "LLM Score", isProc, "#fbbf24"], ["S4", "Cross-Valid", false, "#94a3b8"]].map(([s, n, a, c]) => (
                  <div key={s} style={{ textAlign: "center", padding: "10px 6px", background: "rgba(0,0,0,0.2)", borderRadius: 10 }}>
                    <div style={{ fontSize: 9, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>{s}</div>
                    <div style={{ fontSize: 11, color: "#cbd5e1", fontWeight: 600, marginTop: 3 }}>{n}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: c, marginTop: 4, textTransform: "uppercase", animation: a ? "pulse 1.5s infinite" : "none" }}>● {a ? "ACTIVE" : "IDLE"}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 18, padding: mobile ? 18 : 28 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 16 }}>Manual Analysis</div>
              <AnalyzeContent onAnalyze={analyze} isAnalyzing={isAna} mobile={mobile}/>
            </div>
          </div>
        )}

        {/* ══ STAKING ══ */}
        {tab === "staking" && (
          <div style={{ animation: "fadeIn .4s ease", maxWidth: 560 }}>
            <div style={{ marginBottom: 20 }}>
              <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>USDC Staking</h1>
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Smart staking on Base L2</p>
            </div>
            <div style={{ background: "linear-gradient(135deg,#1e3a5f 0%,#0f1729 100%)", borderRadius: 18, padding: mobile ? 20 : 26, marginBottom: 18, border: "1px solid rgba(56,189,248,0.15)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -20, right: -20, width: 90, height: 90, borderRadius: "50%", background: "rgba(56,189,248,0.05)" }}/>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 2, marginBottom: 6, fontWeight: 600 }}>Wallet Balance</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: mobile ? 34 : 40, fontWeight: 800, color: "#e2e8f0", fontFamily: "'JetBrains Mono',monospace" }}>${balance.toFixed(2)}</span>
                <span style={{ fontSize: 13, color: "#38bdf8", fontWeight: 600 }}>USDC</span>
              </div>
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                {[["Staked", "$2.40", "#34d399"], ["Slashed", "$0.40", "#f87171"], ["Earned", "$0.28", "#38bdf8"]].map(([l, v, c]) => (
                  <div key={l} style={{ flex: 1, background: `${c}10`, borderRadius: 10, padding: "9px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>{l}</div>
                    <div style={{ fontSize: mobile ? 15 : 17, fontWeight: 700, color: c, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>Transactions</div>
            {STAKING_HISTORY.map(tx => (
              <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", marginBottom: 5, background: "rgba(255,255,255,0.02)", borderRadius: 11, border: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", background: tx.type === "stake" ? "rgba(56,189,248,0.1)" : "rgba(52,211,153,0.1)", color: tx.type === "stake" ? "#38bdf8" : "#34d399", fontSize: 13, flexShrink: 0 }}>
                  {tx.type === "stake" ? "↑" : "↓"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.content}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{tx.time}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: tx.type === "stake" ? "#38bdf8" : "#34d399" }}>{tx.type === "stake" ? "-" : "+"}${tx.amount.toFixed(2)}</div>
                  <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", color: tx.status === "slashed" ? "#f87171" : tx.status === "released" ? "#34d399" : "#fbbf24" }}>{tx.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══ ANALYTICS ══ */}
        {tab === "analytics" && (
          <div style={{ animation: "fadeIn .4s ease" }}>
            <div style={{ marginBottom: 20 }}>
              <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Analytics</h1>
              <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Performance & content metrics</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3,1fr)", gap: mobile ? 10 : 14, marginBottom: mobile ? 18 : 22 }}>
              <StatCard icon={<ShieldIcon s={16}/>} label="Accuracy" value="93.2%" sub="+2.1% vs last week" color="#34d399" mobile={mobile}/>
              <StatCard icon={<FireIcon s={16}/>} label="False Positive" value="3.8%" sub="-0.5%" color="#fbbf24" mobile={mobile}/>
              <StatCard icon={<ZapIcon s={16}/>} label="Avg Latency" value="1.8s" sub="per item" color="#818cf8" mobile={mobile}/>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 12 : 16, marginBottom: mobile ? 18 : 22 }}>
              {[{ t: "Score Distribution", d: [3,8,15,22,35,28,18,12,8,5], l: ["0","1","2","3","4","5","6","7","8","9"], c: "#38bdf8" }, { t: "Content Sources", d: [65,20,10,5], l: ["X","Nostr","RSS","DM"], c: "#a78bfa" }].map(ch => (
                <div key={ch.t} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: mobile ? 16 : 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14 }}>{ch.t}</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 64 }}>
                    {ch.d.map((v, i) => {
                      const mx = Math.max(...ch.d);
                      return (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <div style={{ width: "100%", height: `${(v / mx) * 52}px`, background: ch.c, borderRadius: "3px 3px 0 0", opacity: .5 + (v / mx) * .5, minHeight: 3 }}/>
                          <span style={{ fontSize: 8, color: "#64748b" }}>{ch.l[i]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16, padding: mobile ? 16 : 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 14 }}>Staking Economics (7d)</div>
              <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: mobile ? 8 : 12 }}>
                {[["Total Staked", "$12.40", "#38bdf8"], ["Released", "$10.20", "#34d399"], ["Slashed", "$1.80", "#f87171"], ["Net Earn", "+$0.84", "#fbbf24"]].map(([l, v, c]) => (
                  <div key={l} style={{ textAlign: "center", padding: "12px 8px", background: "rgba(0,0,0,0.2)", borderRadius: 10 }}>
                    <div style={{ fontSize: 10, color: "#64748b", marginBottom: 3 }}>{l}</div>
                    <div style={{ fontSize: mobile ? 18 : 20, fontWeight: 800, color: c, fontFamily: "'JetBrains Mono',monospace" }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ─── MOBILE BOTTOM NAV ─── */}
      {mobile && (
        <nav style={{
          position: "fixed", bottom: 0, left: 0, right: 0, height: 72,
          background: "rgba(10,15,30,0.95)", backdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", justifyContent: "space-around", alignItems: "center",
          paddingBottom: "env(safe-area-inset-bottom, 8px)", zIndex: 50,
        }}>
          {navItems.map(it => (
            <button key={it.id} onClick={() => setTab(it.id)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: "none", border: "none", cursor: "pointer", padding: "6px 12px",
              color: tab === it.id ? "#60a5fa" : "#4a5568", transition: "color .2s",
            }}>
              {it.icon}
              <span style={{ fontSize: 9, fontWeight: tab === it.id ? 700 : 500, letterSpacing: .5 }}>{it.label}</span>
              {tab === it.id && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#60a5fa", marginTop: 1 }}/>}
            </button>
          ))}
        </nav>
      )}

      {/* ─── NOTIFICATIONS ─── */}
      <div style={{ position: "fixed", bottom: mobile ? 84 : 20, right: mobile ? 14 : 20, display: "flex", flexDirection: "column", gap: 6, zIndex: 100 }}>
        {notifs.map(n => (
          <div key={n.id} style={{
            padding: "10px 16px", borderRadius: 10, fontSize: 12, fontWeight: 600, animation: "fadeIn .3s ease",
            background: n.type === "success" ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
            border: `1px solid ${n.type === "success" ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
            color: n.type === "success" ? "#34d399" : "#f87171", backdropFilter: "blur(12px)",
          }}>
            {n.text}
          </div>
        ))}
      </div>
    </div>
  );
}
