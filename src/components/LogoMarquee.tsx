import { DARK_LOGOS, MARQUEE_LOGOS } from "./marqueeLogos";

/** Email has no single owner, so it is drawn rather than borrowed (see public/logos.svg). */
const ITEMS = [MARQUEE_LOGOS[0], { id: "email", name: "Email" }, ...MARQUEE_LOGOS.slice(1)];

/**
 * A slow, endless strip of logos, nothing else. They live in one cached sprite (public/logos.svg) and are
 * drawn with <use>, so the page carries only names. Pauses on hover; still and wrapped for people who
 * prefer reduced motion. The second copy is hidden from assistive tech.
 */
export default function LogoMarquee() {
  const Logo = ({ l, dup = false }: { l: { id: string; name: string }; dup?: boolean }) => (
    <li className={`mq-logo ${DARK_LOGOS.has(l.id) ? "ink" : ""}`} title={l.name} aria-hidden={dup || undefined}>
      <svg width="34" height="34" role="img" aria-label={dup ? undefined : l.name}>
        <use href={`/logos.svg#mq-${l.id}`} />
      </svg>
    </li>
  );
  return (
    <section className="marquee" aria-label="Works with">
      <b className="mq-label">Works with</b>
      <div className="mq-view">
        <ul className="mq-track">
          {ITEMS.map((l) => <Logo key={l.id} l={l} />)}
          {ITEMS.map((l) => <Logo key={`d-${l.id}`} l={l} dup />)}
        </ul>
      </div>
    </section>
  );
}
