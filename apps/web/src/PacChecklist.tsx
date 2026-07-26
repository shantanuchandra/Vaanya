import { useState } from "react";
import { AlertCircle, Check, ChevronDown, Link2, Sparkles } from "lucide-react";
import type {
  ChecklistLibraryVersion,
  ChecklistSuggestion,
  EvaluatedChecklist
} from "@vaanaya/contracts";

type Props = {
  checklist: EvaluatedChecklist;
  suggestions: ChecklistSuggestion[];
  checklistLibrary?: Pick<
    ChecklistLibraryVersion,
    "normalizedProcedure" | "version" | "source"
  > | undefined;
  selectedItemId: string | null;
  onSelectItem(itemId: string): void;
  onApproveSuggestion(suggestionId: string): void;
  onRejectSuggestion(suggestionId: string): void;
  onPublishSuggestions(): void;
};

const statusLabels = {
  answered: "Answered",
  uncertain: "Needs confirmation",
  missing: "Not answered",
  deferred: "Deferred by clinician",
  clinician_required: "Clinician entry required",
  not_applicable: "Not applicable"
} as const;

export function PacChecklist({
  checklist,
  suggestions,
  checklistLibrary,
  selectedItemId,
  onSelectItem,
  onApproveSuggestion,
  onRejectSuggestion,
  onPublishSuggestions
}: Props) {
  const firstBlocking =
    checklist.items.find(item => item.id === selectedItemId)?.categoryId ??
    checklist.categories.find(category => category.blockingGapCount > 0)?.id ??
    checklist.categories[0]?.id ??
    null;
  const [openCategory, setOpenCategory] = useState<string | null>(firstBlocking);
  const pending = suggestions.filter(
    suggestion => suggestion.approvalState === "pending_clinician_review"
  );
  const approved = suggestions.filter(
    suggestion => suggestion.approvalState === "approved"
  );
  const notApplicable = checklist.items.filter(item => !item.applicable);

  return (
    <div className="pac-checklist">
      <div className="checklist-validation-badge">
        <AlertCircle size={15} />
        {checklist.validationLabel}
      </div>
      {checklist.genericProcedureCoverage ? (
        <p className="generic-coverage-note">
          Generic procedure coverage is active. Suggested additions require
          clinician review.
        </p>
      ) : null}
      {checklistLibrary ? (
        <p className="library-version-note">
          Using organization checklist v{checklistLibrary.version} ·{" "}
          {checklistLibrary.normalizedProcedure}
        </p>
      ) : null}

      <div className="pac-category-list">
        {checklist.categories.map(category => {
          const expanded = openCategory === category.id;
          const applicableItems = category.items.filter(item => item.applicable);
          return (
            <section className="pac-category" key={category.id}>
              <button
                type="button"
                className="pac-category-trigger"
                aria-expanded={expanded}
                aria-controls={`pac-category-${category.id}`}
                onClick={() =>
                  setOpenCategory(current =>
                    current === category.id ? null : category.id
                  )
                }
              >
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.description}</small>
                </span>
                <span className="category-counts">
                  {category.answeredCount} of {category.applicableCount} answered
                  {category.clinicianRequiredCount > 0 ? (
                    <span>
                      {category.clinicianRequiredCount} clinician required
                    </span>
                  ) : null}
                  {category.blockingGapCount > 0 ? (
                    <b>{category.blockingGapCount} gap{category.blockingGapCount === 1 ? "" : "s"}</b>
                  ) : (
                    <b className="is-complete">Complete</b>
                  )}
                </span>
                <ChevronDown
                  size={17}
                  className={expanded ? "is-open" : ""}
                  aria-hidden="true"
                />
              </button>
              {expanded ? (
                <div
                  className="pac-category-content"
                  id={`pac-category-${category.id}`}
                >
                  {applicableItems.map(item => (
                    <button
                      type="button"
                      className={`pac-checklist-item ${
                        selectedItemId === item.id ? "is-selected" : ""
                      } status-${item.status}`}
                      key={item.id}
                      onClick={() => onSelectItem(item.id)}
                      aria-label={
                        item.sourceTurnIds.length > 0
                          ? `View source for ${item.label}, ${statusLabels[item.status]}`
                          : undefined
                      }
                    >
                      <span className="checklist-state-mark" aria-hidden="true">
                        {item.status === "answered" ||
                        item.status === "deferred" ? (
                          <Check size={15} />
                        ) : (
                          <AlertCircle size={15} />
                        )}
                      </span>
                      <span className="checklist-item-copy">
                        <strong>{item.label}</strong>
                        <small>{item.rationale}</small>
                        {item.value ? <span>{item.value}</span> : null}
                      </span>
                      <span className="checklist-item-meta">
                        {statusLabels[item.status]}
                        {item.sourceTurnIds.length > 0 ? (
                          <small>
                            <Link2 size={12} /> {item.sourceTurnIds.join(", ")}
                          </small>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {notApplicable.length > 0 ? (
        <details className="not-applicable-items">
          <summary>Not applicable ({notApplicable.length})</summary>
          <ul>
            {notApplicable.map(item => (
              <li key={item.id}>{item.label}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {suggestions.length > 0 ? (
        <section
          className="ai-checklist-suggestions"
          aria-label="AI-suggested questions"
        >
          <div className="suggestion-heading">
            <Sparkles size={16} />
            <div>
              <strong>AI-suggested questions</strong>
              <small>
                Optional and excluded from completeness until a clinician
                approves them.
              </small>
            </div>
          </div>
          {suggestions.map(suggestion => (
            <article className="checklist-suggestion" key={suggestion.id}>
              <div>
                <strong>{suggestion.question}</strong>
                <p>{suggestion.rationale}</p>
                <small>{suggestion.approvalState.replaceAll("_", " ")}</small>
              </div>
              {suggestion.approvalState === "pending_clinician_review" ? (
                <div className="suggestion-actions">
                  <button
                    type="button"
                    onClick={() => onApproveSuggestion(suggestion.id)}
                    aria-label={`Approve question: ${suggestion.question}`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onRejectSuggestion(suggestion.id)}
                    aria-label={`Reject question: ${suggestion.question}`}
                  >
                    Reject
                  </button>
                </div>
              ) : null}
            </article>
          ))}
          {pending.length === 0 && approved.length > 0 && !checklistLibrary ? (
            <button
              type="button"
              className="publish-checklist-button"
              onClick={onPublishSuggestions}
            >
              Publish to organization checklist library
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
