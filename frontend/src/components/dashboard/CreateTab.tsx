import React from "react";
import type { BackendTemplateDetail, BackendTemplateSummary } from "../../types/forms";
import { prettyLabel } from "../../utils/formHelpers";

type CreateTabProps = {
  templates: BackendTemplateSummary[];
  selectedTemplate: BackendTemplateSummary | null;
  selectedTemplateDetail: BackendTemplateDetail | null;
  onSelectTemplate: (template: BackendTemplateSummary) => void;
  onGoToTemplates: () => void;
  onCreateDraft: () => void;
  onResetStatus: () => void;
};

const CreateTab: React.FC<CreateTabProps> = ({
  templates,
  selectedTemplate,
  selectedTemplateDetail,
  onSelectTemplate,
  onGoToTemplates,
  onCreateDraft,
  onResetStatus,
}) => {
  return (
    <div className="tab-section fade-slide-in">
      <div className="section-heading-row">
        <div>
          <h2>Document workspace</h2>
          <p>Select a template and create a draft from transcript input.</p>
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="empty-state">
          <h3>No templates available</h3>
          <p>Upload a template first to enable draft creation.</p>
          <button className="modal-submit" onClick={onGoToTemplates}>
            Go to Templates
          </button>
        </div>
      ) : (
        <div className="template-list">
          {templates.map((template) => {
            const selected = selectedTemplate?.formType === template.formType;
            return (
              <button
                type="button"
                key={`${template.formType}-${template.version}`}
                className={`template-card${selected ? " template-card-active" : ""}`}
                onClick={() => {
                  onSelectTemplate(template);
                  onResetStatus();
                }}
              >
                <div className="template-card-top">
                  <div>
                    <div className="template-card-title">
                      {template.displayName || prettyLabel(template.formType)}
                    </div>
                    <div className="template-card-sub">{template.formType}</div>
                  </div>
                  <span className="widget-tag">v{template.version}</span>
                </div>
                <div className="template-card-meta">
                  {(template.templateImageUrls?.length || 0) > 0
                    ? `${template.templateImageUrls?.length} reference image(s)`
                    : "Schema-driven template"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedTemplate && (
        <div className="selection-panel">
          <div>
            <div className="selection-title">
              {selectedTemplate.displayName || prettyLabel(selectedTemplate.formType)}
            </div>
            <div className="selection-subtitle">
              Version {selectedTemplate.version} · {selectedTemplate.formType}
            </div>
          </div>
          <button className="modal-submit" onClick={onCreateDraft}>
            Create Draft
          </button>
        </div>
      )}

      {selectedTemplateDetail?.jsonSchema?.properties && (
        <div className="schema-preview">
          <h3>Schema Preview</h3>
          <div className="field-chip-list">
            {Object.entries(selectedTemplateDetail.jsonSchema.properties).map(([key, value]) => (
              <span key={key} className="field-chip">
                {value.title || prettyLabel(key)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateTab;
