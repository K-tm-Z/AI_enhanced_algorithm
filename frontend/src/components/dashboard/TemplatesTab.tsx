import React from "react";
import type { BackendTemplateSummary } from "../../types/forms";
import { prettyLabel } from "../../utils/formHelpers";

type TemplatesTabProps = {
  templates: BackendTemplateSummary[];
  onUploadTemplate: () => void;
};

const TemplatesTab: React.FC<TemplatesTabProps> = ({ templates, onUploadTemplate }) => {
  return (
    <div className="tab-section fade-slide-in">
      <div className="section-heading-row">
        <div>
          <h2>Template library</h2>
          <p>Register new templates and inspect the currently available ones.</p>
        </div>
        <button className="modal-submit" onClick={onUploadTemplate}>
          Upload Template
        </button>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Display Name</th>
              <th>Form Type</th>
              <th>Version</th>
              <th>Reference Images</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={`${template.formType}-${template.version}`}>
                <td>{template.displayName || prettyLabel(template.formType)}</td>
                <td>{template.formType}</td>
                <td>v{template.version}</td>
                <td>{template.templateImageUrls?.length || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TemplatesTab;
