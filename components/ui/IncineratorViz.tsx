"use client";
import React, { useState, useEffect } from "react";

interface Particle {
  id: number;
  x: number;
  y: number;
  life: number;
  c: string;
}

interface IncineratorVizProps {
  active: boolean;
  mobile?: boolean;
}

export const IncineratorViz: React.FC<IncineratorVizProps> = ({ active, mobile }) => {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      setParticles(p => {
        const n = p.filter(x => x.life > 0).map(x => ({ ...x, y: x.y - 2, life: x.life - 1 }));
        if (Math.random() > 0.4) {
          n.push({ id: Date.now() + Math.random(), x: 60 + Math.random() * 80, y: 75, life: 25, c: Math.random() > 0.5 ? "#f87171" : "#fb923c" });
        }
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
          <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dc2626" stopOpacity=".8" />
            <stop offset="100%" stopColor="#7c2d12" stopOpacity=".4" />
          </linearGradient>
          <filter id="gl">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect x={vw / 2 - 70} y="50" width="140" height="44" rx="7" fill="url(#fg)" opacity={active ? 0.8 : 0.3} />
        <text x={vw / 2} y="77" textAnchor="middle" fill="#fbbf24" fontSize="9" fontWeight="700" fontFamily="JetBrains Mono,monospace" opacity={active ? 1 : 0.4}>
          SLOP INCINERATOR
        </text>
        {active && (
          <path
            d={`M${vw / 2 - 15},55 Q${vw / 2 - 10},35 ${vw / 2 - 5},48 Q${vw / 2},28 ${vw / 2 + 5},45 Q${vw / 2 + 10},30 ${vw / 2 + 15},55`}
            fill="none" stroke="#f97316" strokeWidth="2" filter="url(#gl)" opacity=".8"
          >
            <animate
              attributeName="d"
              values={`M${vw / 2 - 15},55 Q${vw / 2 - 10},35 ${vw / 2 - 5},48 Q${vw / 2},28 ${vw / 2 + 5},45 Q${vw / 2 + 10},30 ${vw / 2 + 15},55;M${vw / 2 - 15},55 Q${vw / 2 - 12},30 ${vw / 2 - 5},42 Q${vw / 2 + 2},22 ${vw / 2 + 5},40 Q${vw / 2 + 12},28 ${vw / 2 + 15},55;M${vw / 2 - 15},55 Q${vw / 2 - 10},35 ${vw / 2 - 5},48 Q${vw / 2},28 ${vw / 2 + 5},45 Q${vw / 2 + 10},30 ${vw / 2 + 15},55`}
              dur=".8s" repeatCount="indefinite"
            />
          </path>
        )}
        {particles.map(p => <circle key={p.id} cx={p.x} cy={p.y} r={1.5} fill={p.c} opacity={p.life / 25} />)}
      </svg>
    </div>
  );
};
