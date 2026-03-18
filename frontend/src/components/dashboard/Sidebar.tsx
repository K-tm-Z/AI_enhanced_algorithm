import React from "react";
import type { BackendTemplateDetail, BackendTemplateSummary } from "../../types/forms";
import { prettyLabel } from "../../utils/formHelpers";
import { toStorageUrl } from "../../utils/storageUrl";

type SidebarProps = {
  stats: { label: string; value: string }[];
  selectedTemplate: BackendTemplateSummary | null;
  selectedTemplateDetail: BackendTemplateDetail | null;
  busy: boolean;
  statusMessage: string | null;
  lastRunId: string | null;
  pageError: string | null;
};

const Sidebar: React.FC<SidebarProps> = ({
  stats,
  selectedTemplate,
  selectedTemplateDetail,
  busy,
  statusMessage,
  lastRunId,
  pageError,
}) => {
  return (
    <aside className="column column-right">
      <div className="widget widget-highlight">
        <div className="widget-header">
          <span>Workspace Status</span>
          <span className="widget-tag">Live</span>
        </div>
        <div className="stats-row stats-row-vertical">
          {stats.map((stat) => (
            <div className="stat-card" key={stat.label}>
              <span className="stat-label">{stat.label}</span>
              <span className="stat-value">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="widget">
        <div className="widget-header">
          <span>Selected Template</span>
          <span className="widget-tag">Context</span>
        </div>
        <p className="widget-body">
          {selectedTemplate
            ? `${selectedTemplate.displayName || prettyLabel(selectedTemplate.formType)} · version ${selectedTemplate.version}`
            : "No template selected."}
        </p>
        {selectedTemplateDetail?.templateImageUrls?.[0] ? (
          <div className="sidebar-template-preview">
            <img
              src={toStorageUrl(selectedTemplateDetail.templateImageUrls[0])}
              alt="Selected form template"
            />
          </div>
        ) : null}
      </div>

      <div className="widget">
        <div className="widget-header">
          <span>Activity</span>
          <span className="widget-tag">System</span>
        </div>
        <p className="widget-body">{busy ? "Loading workspace data..." : statusMessage || "Ready."}</p>
        {lastRunId && <p className="widget-footnote">Last finalized run: {lastRunId}</p>}
        {pageError && <div className="error-text">{pageError}</div>}
      </div>
    </aside>
  );
};

export default Sidebar;
