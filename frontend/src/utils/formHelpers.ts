import type { JsonSchema, JsonSchemaField, TemplateField, ValidationIssue, ValidationState } from "../types/forms";

export function normalizeKey(value: string) {
  return (value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

export function makeSchemaFromFields(fields: TemplateField[]): JsonSchema {
  const properties: Record<string, JsonSchemaField> = {};
  const required: string[] = [];

  for (const field of fields) {
    const key = normalizeKey(field.key);
    if (!key) continue;

    properties[key] = {
      type: field.type === "date" ? "string" : field.type,
      title: field.key,
    };

    if (field.required) required.push(key);
  }

  return {
    properties,
    ...(required.length ? { required } : {}),
  };
}

export function flattenValidation(validation?: ValidationState) {
  return {
    errors: validation?.errors ?? [],
    warnings: validation?.warnings ?? [],
  };
}

export function getValidationMessage(
  issues: ValidationIssue[] | undefined,
  path: string,
): string | undefined {
  return issues?.find((issue) => issue.path === path)?.message;
}

export function prettyLabel(value: string) {
  return value
    .replace(/[_\-.]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
