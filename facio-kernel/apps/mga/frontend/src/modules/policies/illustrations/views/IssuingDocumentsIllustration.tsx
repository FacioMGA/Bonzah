import React from 'react';

/**
 * Minimalistic, luxurious "Document factory" animation.
 * Inline SVG with subtle SMIL motion (no external assets).
 */
export function IssuingDocumentsIllustration(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 640 360"
      role="img"
      aria-label="Document factory animation"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F1F5F9" />
        </linearGradient>

        <linearGradient id="paperEdge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E2E8F0" />
          <stop offset="1" stopColor="#94A3B8" />
        </linearGradient>

        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FDE68A" />
          <stop offset="0.34" stopColor="#F8C24D" />
          <stop offset="0.62" stopColor="#B7791F" />
          <stop offset="1" stopColor="#FDE68A" />
        </linearGradient>

        <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0F172A" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#0F172A" stopOpacity="0.10" />
          <stop offset="1" stopColor="#0F172A" stopOpacity="0.16" />
        </linearGradient>

        <radialGradient id="glow" cx="50%" cy="50%" r="55%">
          <stop offset="0" stopColor="#FDE68A" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="#FDE68A" stopOpacity="0.08" />
          <stop offset="1" stopColor="#FDE68A" stopOpacity="0" />
        </radialGradient>

        <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="10" stdDeviation="10" floodColor="#000" floodOpacity="0.25" />
        </filter>

        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Paper-white canvas + gold halo */}
      <rect x="0" y="0" width="640" height="360" rx="28" fill="#FFFFFF" />
      <rect x="0" y="0" width="640" height="360" rx="28" fill="url(#glow)" />

      {/* Micro grain (very subtle) */}
      <g opacity="0.06" filter="url(#soft)">
        {Array.from({ length: 70 }).map((_, i) => {
          const x = (i * 41) % 640;
          const y = (i * 23) % 360;
          const w = 1 + ((i * 11) % 3);
          return <rect key={i} x={x} y={y} width={w} height="1" fill="#0F172A" opacity="0.55" />;
        })}
      </g>

      {/* Conveyor base */}
      <g opacity="0.9">
        <rect x="120" y="262" width="400" height="28" rx="14" fill="#0F172A" opacity="0.08" />
        <rect x="130" y="268" width="380" height="16" rx="8" fill="#0F172A" opacity="0.06" />
        {/* moving "cogs" */}
        <g opacity="0.24">
          <circle cx="170" cy="276" r="5" fill="#0F172A" />
          <circle cx="470" cy="276" r="5" fill="#0F172A" />
        </g>
      </g>

      {/* Moving document on conveyor */}
      <g filter="url(#shadow)">
        <g>
          <animateTransform attributeName="transform" type="translate" values="-10 0; 10 0; -10 0" dur="2.8s" repeatCount="indefinite" />

          <path
            d="M220 88h210a18 18 0 0 1 18 18v170a18 18 0 0 1-18 18H220a18 18 0 0 1-18-18V106a18 18 0 0 1 18-18Z"
            fill="url(#paper)"
          />
          <path
            d="M220 88h210a18 18 0 0 1 18 18v170a18 18 0 0 1-18 18H220a18 18 0 0 1-18-18V106a18 18 0 0 1 18-18Z"
            fill="none"
            stroke="url(#paperEdge)"
            strokeOpacity="0.9"
          />

          {/* Header */}
          <rect x="242" y="112" width="166" height="14" rx="7" fill="url(#gold)" opacity="0.75" />
          <rect x="242" y="136" width="120" height="9" rx="4.5" fill="url(#ink)" />

          {/* Lines */}
          <g opacity="0.55">
            <rect x="242" y="160" width="188" height="8" rx="4" fill="url(#ink)" />
            <rect x="242" y="178" width="176" height="8" rx="4" fill="url(#ink)" />
            <rect x="242" y="196" width="194" height="8" rx="4" fill="url(#ink)" />
            <rect x="242" y="214" width="158" height="8" rx="4" fill="url(#ink)" />
          </g>

          {/* Signature (drawn) */}
          <path
            d="M250 246c18-10 28 14 44 0c14-12 22 10 44 0"
            fill="none"
            stroke="#0F172A"
            strokeOpacity="0.35"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="120"
            strokeDashoffset="120"
          >
            <animate attributeName="stroke-dashoffset" values="120; 0; 0; 120" dur="3.2s" repeatCount="indefinite" />
          </path>
        </g>
      </g>

      {/* "Quantum seal" stamper */}
      <g transform="translate(430,146)">
        <g>
          <animateTransform attributeName="transform" type="translate" values="0 -6; 0 2; 0 -6" dur="1.6s" repeatCount="indefinite" />
          {/* Arm */}
          <rect x="-10" y="-54" width="20" height="62" rx="10" fill="#0F172A" opacity="0.10" />
          {/* Head */}
          <rect x="-36" y="0" width="72" height="40" rx="20" fill="#0F172A" opacity="0.08" />
          <rect x="-30" y="6" width="60" height="28" rx="14" fill="#0F172A" opacity="0.06" />
          {/* Seal */}
          <circle cx="0" cy="20" r="12" fill="url(#gold)" opacity="0.95" />
          <circle cx="0" cy="20" r="12" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" />
        </g>
        {/* Contact ripple */}
        <circle cx="0" cy="68" r="10" fill="none" stroke="url(#gold)" strokeOpacity="0.35" strokeWidth="2">
          <animate attributeName="r" values="8; 18; 8" dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.35; 0.05; 0.35" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* Micro sparks */}
      <g opacity="0.55">
        <g>
          <animate attributeName="opacity" values="0.15;0.55;0.15" dur="2.4s" repeatCount="indefinite" />
          <path d="M120 98l10 6-10 6-10-6 10-6Z" fill="#FDE68A" />
          <path d="M528 110l9 5-9 5-9-5 9-5Z" fill="#FDE68A" />
        </g>
        <g opacity="0.45">
          <animate attributeName="opacity" values="0.05;0.45;0.05" dur="3s" repeatCount="indefinite" />
          <path d="M546 152l6 10-6 10-6-10 6-10Z" fill="#0F172A" />
        </g>
      </g>
    </svg>
  );
}
