import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  ShieldAlert,
  Stethoscope
} from "lucide-react";
import {
  getGoldenCases,
  saveGoldenCaseReview,
  type GoldenCase,
  type GoldenCaseReview
} from "./api";

const verdictCopy: Record<GoldenCaseReview["verdict"], string> = {
  approved: "Clinically appropriate",
  needs_revision: "Needs revision",
  unsafe: "Unsafe output"
};

export function ReviewPage() {
  const [cases, setCases] = useState<GoldenCase[]>([]);
  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] =
    useState<GoldenCaseReview["verdict"] | null>(null);
  const [notes, setNotes] = useState("");
  const [confidence, setConfidence] = useState(4);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getGoldenCases()
      .then(result => {
        setCases(result.cases);
        const firstOpen = result.cases.findIndex(item => !item.review);
        setIndex(firstOpen < 0 ? 0 : firstOpen);
      })
      .catch(error =>
        setNotice(error instanceof Error ? error.message : "Review unavailable.")
      );
  }, []);

  const current = cases[index];
  const completed = useMemo(
    () => cases.filter(item => item.review).length,
    [cases]
  );

  useEffect(() => {
    setVerdict(current?.review?.verdict ?? null);
    setNotes(current?.review?.notes ?? "");
    setConfidence(current?.review?.confidence ?? 4);
  }, [current?.caseId]);

  async function saveAndAdvance() {
    if (!current || !verdict) return;
    setBusy(true);
    setNotice(null);
    try {
      const review = await saveGoldenCaseReview(current.caseId, {
        verdict,
        notes,
        confidence
      });
      setCases(items =>
        items.map(item =>
          item.caseId === current.caseId ? { ...item, review } : item
        )
      );
      setNotice(`Review saved at ${new Date(review.reviewedAt).toLocaleTimeString()}.`);
      if (index < cases.length - 1) setIndex(value => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Review save failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!current) {
    return (
      <main className="review-loading">
        <Stethoscope size={22} />
        <p>{notice ?? "Loading clinician validation cases…"}</p>
      </main>
    );
  }

  return (
    <div className="review-shell">
      <header className="review-topbar">
        <a href="/" className="brand">
          <span className="brand-mark">V</span>
          <span><strong>Vaanaya</strong><small>Clinical validation</small></span>
        </a>
        <div className="review-progress">
          <span>{completed}/{cases.length} signed off</span>
          <div><i style={{ width: `${(completed / cases.length) * 100}%` }} /></div>
        </div>
      </header>

      <main className="review-main">
        <section className="review-intro">
          <div>
            <span className="section-label">Anesthesiologist review · synthetic case</span>
            <h1>Would you trust this draft?</h1>
          </div>
          <p>
            Validate the documentation behavior—not a diagnosis. Your verdict
            and correction notes are stored as clinical review evidence.
          </p>
        </section>

        <div className="review-grid">
          <aside className="case-index" aria-label="Golden cases">
            {cases.map((item, itemIndex) => (
              <button
                key={item.caseId}
                className={itemIndex === index ? "active" : ""}
                onClick={() => setIndex(itemIndex)}
              >
                <span>{String(itemIndex + 1).padStart(2, "0")}</span>
                <i className={item.review?.verdict ?? "open"} />
                <strong>{item.caseId}</strong>
              </button>
            ))}
          </aside>

          <section className="review-case">
            <div className="review-case-heading">
              <div>
                <span>{current.caseId} · {current.difficulty} · {current.language.path}</span>
                <h2>{current.title}</h2>
              </div>
              <span className="synthetic-tag">Synthetic</span>
            </div>

            <div className="evidence-stitch">
              <section>
                <span className="stitch-marker">1</span>
                <div>
                  <h3>What was said</h3>
                  {current.conversation.map(turn => (
                    <blockquote key={turn.turnId} lang={turn.language}>
                      <span>{turn.speaker} · {Math.round(turn.confidence * 100)}%</span>
                      “{turn.text}”
                    </blockquote>
                  ))}
                </div>
              </section>
              <section>
                <span className="stitch-marker">2</span>
                <div>
                  <h3>Expected documentation behavior</h3>
                  {Object.entries(current.expectedPac).map(([field, output]) => (
                    <article className="expected-output" key={field}>
                      <div>
                        <strong>{field.replaceAll("_", " ")}</strong>
                        <span className={output.state}>{output.state}</span>
                      </div>
                      <p>{output.value}</p>
                      <small>Source: {output.sourceTurnIds.join(", ")}</small>
                    </article>
                  ))}
                  {current.requiredClarifications.map(item => (
                    <p className="clarification" key={item.intent}>
                      <CircleAlert size={15} /> {item.prompt}
                    </p>
                  ))}
                </div>
              </section>
              <section>
                <span className="stitch-marker">3</span>
                <div className="verdict-panel">
                  <h3>Your clinical verdict</h3>
                  <div className="verdict-options">
                    {([
                      ["approved", CheckCircle2],
                      ["needs_revision", CircleAlert],
                      ["unsafe", ShieldAlert]
                    ] as const).map(([value, Icon]) => (
                      <button
                        key={value}
                        className={verdict === value ? `selected ${value}` : ""}
                        onClick={() => setVerdict(value)}
                      >
                        <Icon size={17} /> {verdictCopy[value]}
                      </button>
                    ))}
                  </div>
                  <label>
                    Clinical correction notes
                    <textarea
                      rows={4}
                      value={notes}
                      onChange={event => setNotes(event.target.value)}
                      placeholder="What should change, and why?"
                    />
                  </label>
                  <label>
                    Confidence in this verdict: <strong>{confidence}/5</strong>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={confidence}
                      onChange={event => setConfidence(Number(event.target.value))}
                    />
                  </label>
                  <details>
                    <summary>Safety boundaries checked</summary>
                    <ul>
                      {current.prohibitedInferences.map(item => (
                        <li key={item}>{item.replaceAll("_", " ")}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              </section>
            </div>

            <footer className="review-actions">
              <button
                onClick={() => setIndex(value => Math.max(0, value - 1))}
                disabled={index === 0}
              >
                <ArrowLeft size={16} /> Previous
              </button>
              <span role="status">{notice}</span>
              <button
                className="save-review"
                onClick={saveAndAdvance}
                disabled={!verdict || busy}
              >
                {busy ? "Saving…" : "Save & next case"} <ArrowRight size={16} />
              </button>
            </footer>
          </section>
        </div>
      </main>
    </div>
  );
}
