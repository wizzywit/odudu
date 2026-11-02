import { TextAreaField } from '#/shared/ui/Field';

// A record's description, edited as one section's field.
export function DescriptionField({
  save,
  rule,
  limit,
}: {
  save: {
    values: { description: string };
    fieldErrors: { description?: string | undefined };
    changed: readonly string[];
    edit: (field: 'description', value: string) => void;
  };
  // What the field says it is for, under its label.
  rule: string;
  // The most it may hold, counted as it is written.
  limit?: number;
}) {
  return (
    <TextAreaField
      label="Description"
      description={rule}
      {...(limit === undefined ? {} : { limit })}
      value={save.values.description}
      error={save.fieldErrors.description}
      changed={save.changed.includes('description')}
      onChange={(value) => {
        save.edit('description', value);
      }}
    />
  );
}
