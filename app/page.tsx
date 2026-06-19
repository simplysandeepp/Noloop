export default function Home() {
  return (
    <main className="page">
      <section className="hero">
        <span className="badge">NoLoop</span>
        <h1>
          Health claims, <span className="accent">adjudicated autonomously.</span>
        </h1>
        <p className="sub">
          One platform bridging hospitals, insurers, and patients — cutting
          turnaround time, catching fraud, and making every claim transparent.
        </p>

        <div className="pillars">
          <div className="pillar">
            <h3>Hospitals</h3>
            <p>Submit claims and track them in real time.</p>
          </div>
          <div className="pillar">
            <h3>Insurers</h3>
            <p>Autonomous adjudication with explainable decisions.</p>
          </div>
          <div className="pillar">
            <h3>Patients</h3>
            <p>Full transparency on every claim, in plain language.</p>
          </div>
        </div>

        {/* Meaning-colors: green = approved, red = denied, amber = in review */}
        <div className="legend">
          <span className="chip">
            <span className="dot approve" /> Approved
          </span>
          <span className="chip">
            <span className="dot deny" /> Denied
          </span>
          <span className="chip">
            <span className="dot review" /> In review
          </span>
        </div>
      </section>
    </main>
  );
}
