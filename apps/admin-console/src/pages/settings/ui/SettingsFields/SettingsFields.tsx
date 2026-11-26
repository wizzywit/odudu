import { Fragment } from 'react';
import type { ControlView } from '#/pages/settings/services/controls';
import type { SectionPlan } from '#/pages/settings/services/sectionPlan';
import type { SettingValue } from '#/pages/settings/services/values';
import { useSettingsFields } from '#/pages/settings/use-cases/useSettingsFields';
import type { SettingsSave } from '#/pages/settings/use-cases/useSettingsSection';
import { ChecklistField } from '#/shared/ui/ChecklistField';
import {
  NumberWithUnitField,
  SelectField,
  TextField,
  ToggleField,
  UrlField,
} from '#/shared/ui/Field';
import { FieldGrid, GridCell } from '#/shared/ui/FieldGrid';
import { More } from '#/shared/ui/More';
import styles from '#/pages/settings/ui/SettingsFields/SettingsFields.module.css';

function Control({
  view,
  change,
}: {
  view: ControlView;
  change: (name: string, next: SettingValue) => void;
}) {
  const shared = {
    label: view.label,
    description: view.description,
    error: view.error,
    changed: view.changed,
    isDisabled: view.isDisabled,
  };
  switch (view.control) {
    case 'toggle':
      return (
        <ToggleField
          {...shared}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'text':
      return (
        <TextField
          {...shared}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'url':
      return (
        <UrlField
          {...shared}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'number':
      return (
        <NumberWithUnitField
          {...shared}
          unit={view.unit}
          picker={view.picker}
          echo={false}
          {...(view.min === undefined ? {} : { minValue: view.min })}
          {...(view.max === undefined ? {} : { maxValue: view.max })}
          {...(view.rangeMessage === undefined ? {} : { rangeMessage: view.rangeMessage })}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'choice':
      return (
        <SelectField
          {...shared}
          options={view.options}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
    case 'set':
      return (
        <ChecklistField
          {...shared}
          options={view.options}
          value={view.value}
          onChange={(next) => {
            change(view.name, next);
          }}
        />
      );
  }
}

// The controls of one section, laid out in its titled groups.
export function SettingsFields({
  plan,
  save,
  fixed,
}: {
  plan: Pick<SectionPlan, 'section'>;
  save: SettingsSave;
  fixed: Readonly<Record<string, string>>;
}) {
  const { groups, moreLabel, change } = useSettingsFields(plan.section, save, fixed);
  return (
    <>
      {groups.map((group, at) => {
        const grid = (
          <FieldGrid>
            {group.controls.map((view) => (
              <GridCell key={view.name} {...view.cell}>
                <Control view={view} change={change} />
                {view.more === undefined ? null : <More label={moreLabel}>{view.more}</More>}
              </GridCell>
            ))}
          </FieldGrid>
        );
        return group.title === undefined ? (
          <Fragment key={at}>{grid}</Fragment>
        ) : (
          <fieldset key={at} className={styles.group}>
            <legend className={styles.legend}>{group.title}</legend>
            {grid}
          </fieldset>
        );
      })}
    </>
  );
}
