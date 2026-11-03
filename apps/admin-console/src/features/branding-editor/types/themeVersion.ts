export interface ThemeVersion {
  id: string;
  version: number;
  state: 'published' | 'archived';
  created_at: string;
  published_at: string | null;
}

export interface ThemeVersions {
  items: ThemeVersion[];
}
