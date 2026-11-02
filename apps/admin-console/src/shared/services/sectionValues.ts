export interface DescriptionValues extends Readonly<Record<string, unknown>> {
  description: string;
}

export interface DefaultValues extends Readonly<Record<string, unknown>> {
  default_for_new_subjects: boolean;
}

export interface RoleValues extends Readonly<Record<string, unknown>> {
  role_ids: readonly string[];
}
