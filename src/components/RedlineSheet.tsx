"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero: a small plan whose lines depend on each other. Raise the price and the lines built on
 * it go stale, one hop at a time. It plays once on its own, then it's yours.
 */
export default function RedlineSheet() {
  const [raised, setRaised] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => {
      if (!touched.current) setRaised(true);
    }, 1900);
    return () => clearTimeout(t);
  }, []);

  const toggle = () => {
    touched.current = true;
    setRaised((r) => !r);
  };

  return (
    <div>
      <div className={`sheet ${raised ? "raised" : ""}`}>
        <div className="title">Launch plan, Q4</div>

        <span className="ln" style={{ ["--i" as string]: 0 }}>
          <span className="tx">
            Acme quotes <span className="was">$100</span>
            <span className="now" aria-hidden={!raised}>$140</span> per unit for 1,000 units.
          </span>
        </span>
        <span className="ln d1 dep" style={{ ["--i" as string]: 1 }}>
          <span className="tx">Hardware will cost about $100,000.</span>
          <span className="note">stale</span>
        </span>
        <span className="ln d1 dep" style={{ ["--i" as string]: 1 }}>
          <span className="tx">The launch fits the $150,000 budget.</span>
          <span className="note">stale</span>
        </span>
        <span className="ln d2 dep" style={{ ["--i" as string]: 2 }}>
          <span className="tx">Choose Acme as the hardware vendor.</span>
          <span className="note">stale</span>
        </span>
        <span className="ln d3 dep" style={{ ["--i" as string]: 3 }}>
          <span className="tx">Purchase order sent to Acme on Oct 9.</span>
          <span className="stamp" aria-hidden={!raised}>
            SENT ON THE
            <br />
            OLD PRICE
          </span>
        </span>

        <div className="foot">
          <div className="summary" aria-live="polite">
            {raised ? (
              <>
                <b>Four lines</b> rest on the old price. <b>One</b> was already acted on.
              </>
            ) : (
              <>Every line agrees with the one it depends on.</>
            )}
          </div>
          <button className={`btn ${raised ? "" : "primary"}`} onClick={toggle} aria-pressed={raised}>
            {raised ? "Undo" : "Raise the price to $140"}
          </button>
        </div>
      </div>
      <p className="src" style={{ margin: "14px 0 0 8px", fontSize: 13, color: "var(--muted)" }}>
        Sample data. In your workspace, each line cites the message, ticket, email or page it came from.
      </p>
    </div>
  );
}
