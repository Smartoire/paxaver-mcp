/**
 * Output coercion driven by a tool's outputSchema.
 *
 * The backend stores flags as SQLite integers, so a field the schema declares
 * as boolean can arrive as 0 or 1. Such values are converted to booleans
 * wherever the schema says `boolean`, so the result validates against the
 * schema the tool advertises.
 */

interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, unknown>;
  items?: unknown;
}

function declaresBoolean(schema: SchemaNode): boolean {
  return Array.isArray(schema.type) ? schema.type.includes('boolean') : schema.type === 'boolean';
}

export function coerceBooleans(value: unknown, schema: SchemaNode | undefined): unknown {
  if (!schema || value === null || value === undefined) return value;
  if (declaresBoolean(schema) && (value === 0 || value === 1)) return value === 1;
  if (Array.isArray(value)) {
    return schema.items ? value.map((item) => coerceBooleans(item, schema.items as SchemaNode)) : value;
  }
  if (typeof value === 'object' && schema.properties) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in out) out[key] = coerceBooleans(out[key], sub as SchemaNode);
    }
    return out;
  }
  return value;
}
