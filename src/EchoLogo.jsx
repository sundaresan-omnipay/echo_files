import React from "react";

export default function EchoLogo({ size = 40, withText = false, dark = false }) {
  const id = React.useId();
  const from = dark ? "#8B72FF" : "#6C4DF6";
  const to   = dark ? "#3DD6E3" : "#1FB8C9";
  const ripple1 = dark ? 0.55 : 0.4;
  const ripple2 = dark ? 0.3  : 0.15;

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Echo"
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={id} x1="150" y1="150" x2="380" y2="380" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <g stroke={`url(#${id})`} strokeWidth="40" strokeLinecap="round" fill="none">
        <path d="M 348 278 A 92 92 0 1 0 326 337" />
        <path d="M 168 278 L 348 278" />
      </g>
      <path d="M 113 309 A 152 152 0 1 1 399 309"
        stroke={`url(#${id})`} strokeOpacity={ripple1} strokeWidth="28" strokeLinecap="round" fill="none" />
      <path d="M 57 316 A 204 204 0 1 1 455 316"
        stroke={`url(#${id})`} strokeOpacity={ripple2} strokeWidth="22" strokeLinecap="round" fill="none" />
    </svg>
  );

  if (!withText) return mark;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.18 }}>
      {mark}
      <span style={{
        fontFamily: "'Avenir Next','Segoe UI',Inter,system-ui,-apple-system,sans-serif",
        fontWeight: 600,
        fontSize: size * 0.62,
        letterSpacing: "-0.02em",
        color: dark ? "#f2f2f7" : "#1d1d2b",
        lineHeight: 1,
      }}>
        echo
      </span>
    </span>
  );
}
