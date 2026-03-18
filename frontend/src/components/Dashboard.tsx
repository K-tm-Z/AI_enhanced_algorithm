import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearToken } from "../lib/auth";
import { authFetch, getJson } from "../lib/api";
import type { BackendDraft, BackendTemplateDetail, BackendTemplateSummary, TabId } from "../types/forms";
import { flattenValidation } from "../utils/formHelpers";
import CreateTab from "./dashboard/CreateTab";
import TemplatesTab from "./dashboard/TemplatesTab";
import ReviewTab from "./dashboard/ReviewTab";
import BatchTab from "./dashboard/BatchTab";
import Sidebar from "./dashboard/Sidebar";
import TabNav from "./common/TabNav";
import TemplateWizardModal from "./modals/TemplateWizardModal";
import CreateDraftModal from "./modals/CreateDraftModal";
import DraftReviewModal from "./modals/DraftReviewModal";

const Dashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("create");
  const [templates, setTemplates] = useState<BackendTemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<BackendTemplateSummary | null>(null);
  const [selectedTemplateDetail, setSelectedTemplateDetail] = useState<BackendTemplateDetail | null>(null);
  const [currentDraft, setCurrentDraft] = useState<BackendDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCreateDraftModal, setShowCreateDraftModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [removingFormType, setRemovingFormType] = useState<string | null>(null);

  const loadTemplates = async () => {
    setBusy(true);
    setPageError(null);

    try {
      const result = await getJson<BackendTemplateSummary[]>("/api/forms");
      setTemplates(result);
      setSelectedTemplate((prev) => {
        if (!prev) return result[0] ?? null;
        const stillThere = result.some((t) => t.formType === prev.formType);
        return stillThere ? prev : result[0] ?? null;
      });
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    const fetchTemplateDetail = async () => {
      if (!selectedTemplate?.formType) return;

      try {
        const detail = await getJson<BackendTemplateDetail>(`/api/forms/${selectedTemplate.formType}`);
        setSelectedTemplateDetail(detail);
      } catch (err: unknown) {
        setSelectedTemplateDetail(null);
        setPageError(err instanceof Error ? err.message : "Failed to load template detail");
      }
    };

    void fetchTemplateDetail();
  }, [selectedTemplate?.formType]);

  useEffect(() => {
    const syncDraftTemplate = async () => {
      if (!currentDraft?.formType) return;
      if (selectedTemplateDetail?.formType === currentDraft.formType) return;

      try {
        const detail = await getJson<BackendTemplateDetail>(`/api/forms/${currentDraft.formType}`);
        setSelectedTemplateDetail(detail);
      } catch {
        // Intentionally ignore. Review modal can still rely on payload keys.
      }
    };

    void syncDraftTemplate();
  }, [currentDraft?.formType, selectedTemplateDetail?.formType]);

  const handleRemoveTemplate = async (formType: string) => {
    const label = templates.find((t) => t.formType === formType)?.displayName || formType;
    if (!window.confirm(`Remove template "${label}" from the workspace? You can upload it again later if needed.`)) {
      return;
    }
    setRemovingFormType(formType);
    setPageError(null);
    try {
      await authFetch(`/api/forms/templates/${encodeURIComponent(formType)}`, {
        method: "DELETE",
      });
      setStatusMessage(`Template removed: ${label}.`);
      await loadTemplates();
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed to remove template");
    } finally {
      setRemovingFormType(null);
    }
  };

  const handleSignOut = () => {
    clearToken?.();
    onLogout();
    navigate("/");
  };

  const validationSummary = useMemo(() => flattenValidation(currentDraft?.validation), [currentDraft?.validation]);

  const stats = useMemo(
    () => [
      { label: "Active templates", value: String(templates.length) },
      { label: "Current draft", value: currentDraft ? currentDraft.draftId.slice(0, 8) : "None" },
      { label: "Validation issues", value: String(validationSummary.errors.length) },
    ],
    [currentDraft, templates.length, validationSummary.errors.length],
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "create":
        return (
          <CreateTab
            templates={templates}
            selectedTemplate={selectedTemplate}
            selectedTemplateDetail={selectedTemplateDetail}
            onSelectTemplate={setSelectedTemplate}
            onGoToTemplates={() => setActiveTab("templates")}
            onCreateDraft={() => setShowCreateDraftModal(true)}
            onResetStatus={() => setStatusMessage(null)}
            onRemoveTemplate={handleRemoveTemplate}
            removingFormType={removingFormType}
          />
        );
      case "templates":
        return (
          <TemplatesTab
            templates={templates}
            onUploadTemplate={() => setShowTemplateModal(true)}
            onRemoveTemplate={handleRemoveTemplate}
            removingFormType={removingFormType}
          />
        );
      case "batch":
        return <BatchTab />;
      case "review":
        return (
          <ReviewTab
            currentDraft={currentDraft}
            errors={validationSummary.errors}
            warnings={validationSummary.warnings}
            onOpenEditor={() => setShowReviewModal(true)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <div className="header-kicker">Operations Console</div>
          <h1 className="app-title">Structured Document Automation</h1>
        </div>

        <button className="top-login-button" onClick={handleSignOut}>
          Sign Out
        </button>
      </header>

      <main className="column column-center">
        <section key={activeTab} className="glass-card tab-shell">
          <TabNav activeTab={activeTab} onChange={setActiveTab} />
          <div className="tab-panel">{renderTabContent()}</div>
        </section>
      </main>

      <Sidebar
        stats={stats}
        selectedTemplate={selectedTemplate}
        selectedTemplateDetail={selectedTemplateDetail}
        busy={busy}
        statusMessage={statusMessage}
        lastRunId={lastRunId}
        pageError={pageError}
      />

      <TemplateWizardModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onUploaded={() => {
          setStatusMessage("Template saved successfully.");
          void loadTemplates();
        }}
      />

      <CreateDraftModal
        isOpen={showCreateDraftModal}
        template={selectedTemplate}
        onClose={() => setShowCreateDraftModal(false)}
        onCreated={(draft) => {
          setCurrentDraft(draft);
          setActiveTab("review");
          setStatusMessage(`Draft ${draft.draftId.slice(0, 8)} created.`);
        }}
      />

      <DraftReviewModal
        isOpen={showReviewModal}
        draft={currentDraft}
        template={selectedTemplateDetail}
        onClose={() => setShowReviewModal(false)}
        onSaved={(draft) => {
          setCurrentDraft(draft);
          setStatusMessage(`Draft ${draft.draftId.slice(0, 8)} updated.`);
        }}
        onFinalized={(result) => {
          const runId =
            typeof result === "object" && result !== null && "run" in result
              ? ((result as { run?: { runId?: string } }).run?.runId ?? null)
              : null;
          setLastRunId(runId);
          setStatusMessage(runId ? `Draft finalized into run ${runId}.` : "Draft finalized.");
        }}
      />
    </div>
  );
};

export default Dashboard;
