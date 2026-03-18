import React from "react";
import type { TabId } from "../../types/forms";

const TABS: { id: TabId; label: string; glyph: string }[] = [
  { id: "create", label: "Create", glyph: "◎" },
  { id: "templates", label: "Templates", glyph: "▤" },
  { id: "review", label: "Review", glyph: "✦" },
];

type TabNavProps = {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
};

const TabNav: React.FC<TabNavProps> = ({ activeTab, onChange }) => {
  return (
    <>
      <div className="tabs tabs-inline">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button${tab.id === activeTab ? " tab-button-active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <footer className="tab-footer">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-icon${tab.id === activeTab ? " tab-icon-active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            <span className="tab-icon-glyph">{tab.glyph}</span>
            <span className="tab-icon-label">{tab.label}</span>
          </button>
        ))}
      </footer>
    </>
  );
};

export default TabNav;
