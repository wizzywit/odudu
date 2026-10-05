import type { ReactNode } from 'react';
import {
  Tabs as AriaTabs,
  Tab,
  TabList,
  TabPanel,
  VisuallyHidden,
  type Key,
} from 'react-aria-components';
import styles from '#/shared/view/Tabs/Tabs.module.css';

export interface TabItem {
  id: string;
  label: string;
  dirty?: boolean;
  panel: ReactNode;
}

export function Tabs({
  label,
  tabs,
  selectedKey,
  onSelectionChange,
}: {
  label: string;
  tabs: readonly TabItem[];
  selectedKey?: string;
  onSelectionChange?: (id: string) => void;
}) {
  const report = (key: Key): void => {
    onSelectionChange?.(String(key));
  };
  return (
    <AriaTabs
      className={styles.tabs ?? ''}
      onSelectionChange={report}
      {...(selectedKey === undefined ? {} : { selectedKey })}
    >
      <TabList aria-label={label} className={styles.list ?? ''}>
        {tabs.map((tab) => (
          <Tab key={tab.id} id={tab.id} className={styles.tab ?? ''}>
            {tab.label}
            {tab.dirty === true ? (
              <>
                <span className={styles.dirty} aria-hidden="true" />
                <VisuallyHidden elementType="span">, unsaved changes</VisuallyHidden>
              </>
            ) : null}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel key={tab.id} id={tab.id} className={styles.panel ?? ''}>
          {tab.panel}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
