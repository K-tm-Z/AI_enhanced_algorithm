import React, { useEffect, useState } from "react";
import type { BackendTemplateDetail, BackendTemplateSummary } from "../../types/forms";
import { prettyLabel } from "../../utils/formHelpers";
import { toStorageUrl } from "../../utils/storageUrl";

type CreateTabProps = {
  templates: BackendTemplateSummary[];
  selectedTemplate: BackendTemplateSummary | null;
  selectedTemplateDetail: BackendTemplateDetail | null;
  onSelectTemplate: (template: BackendTemplateSummary) => void;
  onGoToTemplates: () => void;
  onCreateDraft: () => void;
  onResetStatus: () => void;
  onRemoveTemplate: (formType: string) => void;
  removingFormType: string | null;
};

const CreateTab: React.FC<CreateTabProps> = ({
  templates,
  selectedTemplate,
  selectedTemplateDetail,
  onSelectTemplate,
  onGoToTemplates,
  onCreateDraft,
  onResetStatus,
  onRemoveTemplate,
  removingFormType,
}) => {
  const previewUrls = (selectedTemplateDetail?.templateImageUrls ?? [])
    .map(toStorageUrl)
    .filter(Boolean);
  const [previewIndex, setPreviewIndex] = useState(0);
  useEffect(() => {
    setPreviewIndex(0);
  }, [selectedTemplate?.formType, previewUrls.length]);

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
          <button type="button" className="modal-submit" onClick={onGoToTemplates}>
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
                {template.templateImageUrls?.[0] ? (
                  <div className="template-card-thumb-wrap">
                    <img
                      className="template-card-thumb"
                      src={toStorageUrl(template.templateImageUrls[0])}
                      alt=""
                    />
                  </div>
                ) : (
                  <div className="template-card-meta">No preview image</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedTemplate && (
        <div className="selection-panel selection-panel-actions">
          <div>
            <div className="selection-title">
              {selectedTemplate.displayName || prettyLabel(selectedTemplate.formType)}
            </div>
            <div className="selection-subtitle">
              Version {selectedTemplate.version} · {selectedTemplate.formType}
            </div>
          </div>
          <div className="selection-panel-buttons">
            <button type="button" className="modal-submit" onClick={onCreateDraft}>
              Create Draft
            </button>
            <button
              type="button"
              className="button-danger-outline"
              disabled={removingFormType === selectedTemplate.formType}
              onClick={() => onRemoveTemplate(selectedTemplate.formType)}
            >
              {removingFormType === selectedTemplate.formType ? "Removing…" : "Remove template"}
            </button>
          </div>
        </div>
      )}

      {selectedTemplate && (
        <div className="form-preview">
          <h3>Form preview</h3>
          {previewUrls.length > 0 ? (
            <>
              <div className="form-preview-main">
                <img
                  src={previewUrls[Math.min(previewIndex, previewUrls.length - 1)]}
                  alt={`${selectedTemplate.displayName || selectedTemplate.formType} blank form`}
                  className="form-preview-image"
                />
              </div>
              {previewUrls.length > 1 && (
                <div className="form-preview-thumbs">
                  {previewUrls.map((url, i) => (
                    <button
                      key={url}
                      type="button"
                      className={`form-preview-thumb${i === previewIndex ? " form-preview-thumb-active" : ""}`}
                      onClick={() => setPreviewIndex(i)}
                    >
                      <img src={url} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="form-preview-empty">No reference images for this template.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default CreateTab;
