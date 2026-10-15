/**
 * One generic example of the core idea, in no particular tool: someone says something, the old fact is
 * replaced, and what rested on it is flagged.
 */
export default function SourceDemo() {
  return (
    <div className="flow-demo" aria-label="Example: a change anywhere in company data becomes a replaced fact">
      <div className="row-in">
        <div className="who">dana<span>a message in your company data</span></div>
        Heads up, Acme now quotes $140/unit for 1,000 units. Same terms otherwise.
      </div>
      <div className="claim">
        <div className="k">Replaces</div>
        Acme quotes <span className="st">$100</span> <span className="mk">$140</span> per unit for 1,000 units.
        <div className="quote">“Acme now quotes $140/unit for 1,000 units”</div>
      </div>
      <div className="claim">
        <div className="k">Flagged as stale</div>
        Hardware cost, budget fit, vendor choice, and a purchase order that was already sent.
      </div>
    </div>
  );
}
