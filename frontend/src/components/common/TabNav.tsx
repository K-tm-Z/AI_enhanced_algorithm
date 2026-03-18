import React from "react";
import type { TabId } from "../../types/forms";

const TABS: { id: TabId; label: string }[] = [
  { id: "create", label: "Create" },
  { id: "batch", label: "Batch" },
  { id: "review", label: "Review" },
  { id: "templates", label: "Templates" },
];

type TabNavProps = {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
};

const TabNav: React.FC<TabNavProps> = ({ activeTab, onChange }) => {
  return (
    <div className="tabs tabs-inline tabs-single-row">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-button${tab.id === activeTab ? " tab-button-active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default TabNav;
