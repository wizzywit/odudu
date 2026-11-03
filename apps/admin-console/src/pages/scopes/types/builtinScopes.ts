export interface BuiltinScope {
  name: string;
  present: boolean;
}

export interface BuiltinScopes {
  items: BuiltinScope[];
}

export interface RestoredScopes {
  created: string[];
}
