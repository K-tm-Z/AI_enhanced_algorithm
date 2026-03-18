export type TabId = "create" | "templates" | "review";

export type JsonSchemaField = {
  type?: "string" | "number" | "integer" | "boolean" | "date";
  title?: string;
  enum?: string[];
};

export type JsonSchema = {
  properties?: Record<string, JsonSchemaField>;
  required?: string[];
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationState = {
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
};

export type BackendTemplateSummary = {
  formType: string;
  displayName?: string;
  version: number;
  templateImageUrls?: string[];
  createdAt?: string;
};

export type BackendTemplateDetail = BackendTemplateSummary & {
  jsonSchema?: JsonSchema;
  promptSpec?: {
    rules?: string[];
  };
};

export type BackendDraft = {
  draftId: string;
  formType: string;
  templateVersion: number;
  payload: Record<string, unknown>;
  validation?: ValidationState;
  transcript: string;
  status: string;
};

export type TemplateField = {
  key: string;
  type: "string" | "number" | "date";
  required?: boolean;
};
