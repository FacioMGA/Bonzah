import { Button } from '@/src/shared/ui';

export type BinderTabKey =
  | 'overview'
  | 'agreement'
  | 'authority'
  | 'financials-reporting'
  | 'parties-documents'
  | 'usage';

export const BINDER_TABS: Array<{ key: BinderTabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'agreement', label: 'Agreement' },
  { key: 'authority', label: 'Authority' },
  { key: 'financials-reporting', label: 'Financials & Reporting' },
  { key: 'parties-documents', label: 'Parties & Documents' },
  { key: 'usage', label: 'Usage' },
];

export function BinderTabs({
  activeTab,
  onChange,
}: {
  activeTab: BinderTabKey;
  onChange: (tab: BinderTabKey) => void;
}) {
  return (
    <div className="ui-tabsbar">
      {BINDER_TABS.map((tab) => (
        <Button
          key={tab.key}
          type="button"
          variant="tab"
          size="tab"
          onClick={() => onChange(tab.key)}
          className={`ui-tab ${activeTab === tab.key ? 'ui-tab-active' : 'ui-tab-inactive'}`}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}
