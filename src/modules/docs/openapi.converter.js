// Converts a Zod schema into an OpenAPI 3.0-compatible schema object.
//
// Zod 4 ships a native `z.toJSONSchema()` helper. With `target: 'openApi3'` it
// drops the `$schema` keyword, but it still represents nullable fields as
// `anyOf: [{ ... }, { type: 'null' }]`, which is *not* valid OpenAPI 3.0
// (the spec uses `nullable: true` instead). This module post-processes the
// JSON Schema output so the result can be embedded directly in an OpenAPI 3.0
// document (components/schemas, requestBody, parameters, ...).
//
// `z.toJSONSchema()` also throws on schemas containing `.transform()` (the
// output type can't be represented in JSON Schema). We work around this by
// recursively stripping pipe-with-transform wrappers before conversion — the
// *input* shape is what matters for API documentation anyway.
import { z, toJSONSchema } from 'zod'

// True when a JSON Schema fragment represents the JSON `null` type.
const isNullSchema = (node) => node && typeof node === 'object' && node.type === 'null'

// `anyOf`/`oneOf` with a `null` member ⇒ collapse into a single nullable schema.
// Returns the rewritten schema, or `null` when no nullable union was found.
const collapseNullableUnion = (node) => {
  for (const key of ['anyOf', 'oneOf']) {
    const variants = node[key]
    if (!Array.isArray(variants)) continue

    const nullIndex = variants.findIndex(isNullSchema)
    if (nullIndex === -1) continue

    const remaining = variants.filter((_, i) => i !== nullIndex)

    // Only `null` was present — represent as a nullable empty schema.
    if (remaining.length === 0) {
      return { nullable: true }
    }

    // A single concrete variant — merge `nullable: true` onto it.
    if (remaining.length === 1) {
      const merged = { ...convertNode(remaining[0]), nullable: true }
      // Preserve description/example from the parent if present.
      if (node.description) merged.description = node.description
      if (node.example !== undefined) merged.example = node.example
      return merged
    }

    // Multiple concrete variants — keep the union but flag it nullable.
    return { [key]: remaining.map(convertNode), nullable: true }
  }
  return null
}

// Recursively normalise a JSON Schema node into OpenAPI 3.0 form.
function convertNode(node) {
  // Primitives & non-object leaves pass through untouched.
  if (!node || typeof node !== 'object') return node

  // `const` is legal in JSON Schema draft 2020-12 but not in OpenAPI 3.0 —
  // represent it as a single-value `enum`.
  if (node.const !== undefined) {
    return { ...convertNode(stripKey(node, 'const')), enum: [node.const] }
  }

  // Nullable unions (`anyOf`/`oneOf` containing `{ type: 'null' }`).
  const collapsed = collapseNullableUnion(node)
  if (collapsed) return collapsed

  const out = { ...node }

  // Strip JSON-Schema-only keywords that OpenAPI 3.0 does not understand.
  delete out.$schema

  // Recurse into every keyword that holds nested schemas.
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, convertNode(v)]),
    )
  }
  if (out.items) out.items = convertNode(out.items)
  if (out.additionalProperties && typeof out.additionalProperties === 'object') {
    out.additionalProperties = convertNode(out.additionalProperties)
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(out[key])) out[key] = out[key].map(convertNode)
  }
  if (out.not) out.not = convertNode(out.not)

  return out
}

const stripKey = (obj, key) => {
  const { [key]: _removed, ...rest } = obj
  return rest
}

// Recursively strip `.transform()` wrappers from a Zod schema so it can be
// serialised to JSON Schema. A `.transform()` creates a `pipe` node whose
// `def.out` is a `transform` — we replace the whole pipe with its `def.in`
// (the source schema). We also recurse into objects, arrays, and
// optional/nullable/default wrappers so nested transforms are handled.
const stripTransforms = (schema) => {
  const def = schema?.def
  if (!def) return schema

  // pipe with a transform output → use the input side (the pre-transform shape)
  if (def.type === 'pipe' && def.out?.def?.type === 'transform') {
    return stripTransforms(def.in)
  }

  // object → rebuild with stripped properties
  if (def.type === 'object' && def.shape) {
    const newShape = {}
    for (const [k, v] of Object.entries(def.shape)) {
      newShape[k] = stripTransforms(v)
    }
    return z.object(newShape)
  }

  // optional / nullable / default → unwrap, strip, rewrap
  if (def.innerType) {
    const stripped = stripTransforms(def.innerType)
    if (def.type === 'optional') return stripped.optional()
    if (def.type === 'nullable') return stripped.nullable()
    if (def.type === 'default') return stripped.default(def.defaultValue)
  }

  // array → strip element
  if (def.element) {
    return z.array(stripTransforms(def.element))
  }

  // pipe without transform (e.g. .pipe(z.string())) → strip both sides
  if (def.type === 'pipe') {
    return stripTransforms(def.in)
  }

  return schema
}

// Public entry point — convert a Zod schema to an OpenAPI 3.0 schema object.
export const zodToOpenApi = (schema) => {
  const clean = stripTransforms(schema)
  const jsonSchema = toJSONSchema(clean, { target: 'openApi3' })
  return convertNode(jsonSchema)
}
