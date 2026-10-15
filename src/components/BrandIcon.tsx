import { BRAND_SVG } from "./brandIcons";

/**
 * The real logo of the service, on a light tile so dark marks (GitHub, Notion) stay visible in dark mode.
 * Email has no single owner, so it gets a plain envelope.
 */
export default function BrandIcon({ type, size = 40 }: { type: string; size?: number }) {
  const inner = Math.round(size * 0.58);
  const brand = BRAND_SVG[type];
  return (
    <span className="brand-tile" style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }} aria-hidden>
      {brand ? (
        <svg
          width={inner}
          height={inner}
          viewBox={`0 0 ${brand.w} ${brand.h}`}
          dangerouslySetInnerHTML={{ __html: brand.body }}
        />
      ) : (
        <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none" stroke="#1a2b22" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="m4 7.5 8 6 8-6" />
        </svg>
      )}
    </span>
  );
}
