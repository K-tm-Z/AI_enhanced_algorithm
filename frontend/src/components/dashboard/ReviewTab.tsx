import React from "react";
import type { BackendDraft, ValidationIssue } from "../../types/forms";

type ReviewTabProps = {
  currentDraft: BackendDraft | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  onOpenEditor: () => void;
};

const ReviewTab: React.FC<ReviewTabProps> = ({ currentDraft, errors, warnings, onOpenEditor }) => {
  if (!currentDraft) {
    return (
      <div className="tab-section fade-slide-in">
        <h2>Draft review</h2>
        <p>No draft is loaded yet. Create a draft from the Create tab first.</p>
      </div>
    );
  }

  return (
    <div className="tab-section fade-slide-in">
      <div className="section-heading-row">
        <div>
          <h2>Draft review</h2>
          <p>Inspect the extracted payload, resolve validation issues, and finalize when ready.</p>
        </div>
        <button className="modal-submit" onClick={onOpenEditor}>
          Open Editor
        </button>
      </div>

      <div className="review-grid">
        <div className="review-card">
          <div className="review-card-title">Draft Summary</div>
          <dl className="summary-list">
            <div>
              <dt>Draft ID</dt>
              <dd>{currentDraft.draftId}</dd>
            </div>
            <div>
              <dt>Form Type</dt>
              <dd>{currentDraft.formType}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{currentDraft.status}</dd>
            </div>
            <div>
              <dt>Template Version</dt>
              <dd>{currentDraft.templateVersion}</dd>
            </div>
          </dl>
        </div>

        <div className="review-card">
          <div className="review-card-title">Validation</div>
          <div className="issue-stack">
            {errors.length === 0 && warnings.length === 0 && (
              <div className="issue-line issue-line-clean">No validation issues.</div>
            )}

            {errors.map((issue, index) => (
              <div key={`error-${index}`} className="issue-line issue-line-error">
                <strong>{issue.path}</strong>: {issue.message}
              </div>
            ))}

            {warnings.map((issue, index) => (
              <div key={`warning-${index}`} className="issue-line issue-line-warning">
                <strong>{issue.path}</strong>: {issue.message}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="payload-preview">
        <div className="review-card-title">Payload Preview</div>
        <pre>{JSON.stringify(currentDraft.payload, null, 2)}</pre>
      </div>
    </div>
  );
};

export default ReviewTab;
