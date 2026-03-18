import React from "react";
import type { BackendTemplateSummary } from "../../types/forms";
import { prettyLabel } from "../../utils/formHelpers";
import { toStorageUrl } from "../../utils/storageUrl";

type TemplatesTabProps = {
  templates: BackendTemplateSummary[];
  onUploadTemplate: () => void;
  onRemoveTemplate: (formType: string) => void;
  removingFormType: string | null;
};

const TemplatesTab: React.FC<TemplatesTabProps> = ({
  templates,
  onUploadTemplate,
  onRemoveTemplate,
  removingFormType,
}) => {
  return (
    <div className="tab-section fade-slide-in">
      <div className="section-heading-row">
        <div>
          <h2>Template library</h2>
          <p>Add templates with the guided wizard (blank PDF or photo + field names), or remove old ones.</p>
        </div>
        <button type="button" className="modal-submit" onClick={onUploadTemplate}>
          New template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state">
          <p>No templates yet. Upload a blank form image and field list to get started.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Preview</th>
                <th>Display Name</th>
                <th>Form Type</th>
                <th>Version</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const thumb = template.templateImageUrls?.[0];
                return (
                  <tr key={`${template.formType}-${template.version}`}>
                    <td className="data-table-thumb-cell">
                      {thumb ? (
                        <img
                          className="data-table-thumb"
                          src={toStorageUrl(thumb)}
                          alt=""
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>{template.displayName || prettyLabel(template.formType)}</td>
                    <td>{template.formType}</td>
                    <td>v{template.version}</td>
                    <td>
                      <button
                        type="button"
                        className="button-danger-outline button-compact"
                        disabled={removingFormType === template.formType}
                        onClick={() => onRemoveTemplate(template.formType)}
                      >
                        {removingFormType === template.formType ? "…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TemplatesTab;
