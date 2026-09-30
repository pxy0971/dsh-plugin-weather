/**
 * Minimal stand-in for `@deepseek-ai/dsh-tools`' `defineTool`.
 *
 * The bench needs the Host plugin's tool definition to be constructed, inspected,
 * and executed. The shipped `defineTool` validates the author-facing schema DSL and
 * returns a registry-ready definition; this stub keeps the parts the Host code
 * depends on — the `schema`/`render` output shape and a callable `execute` — while
 * asserting the two authoring rules that would otherwise only fail inside DSH:
 * a tools must have a name, and `output.schema` must be present.
 *
 * It deliberately does no JSON-Schema compilation: `lib/weather-core.js` owns the
 * data, and the real schema compilation is `dsh-tools`' own tested concern.
 */

/**
 * Build a registry-ready tool definition.
 * @param options - the author-facing definition.
 * @returns the definition with a normalised `output` object.
 */
export function defineTool(options) {
  if (options === null || typeof options !== 'object') throw new Error('defineTool: options must be an object')
  if (typeof options.name !== 'string' || options.name === '') throw new Error('defineTool: a non-empty name is required')
  if (typeof options.execute !== 'function') throw new Error(`defineTool(${options.name}): execute must be a function`)
  if (options.output === null || typeof options.output !== 'object') {
    throw new Error(`defineTool(${options.name}): output is required`)
  }
  if (options.output.schema === undefined) throw new Error(`defineTool(${options.name}): output.schema is required`)
  return {
    name: options.name,
    description: options.description ?? '',
    parameters: options.parameters ?? {},
    output: {
      schema: options.output.schema,
      render: typeof options.output.render === 'function' ? options.output.render : undefined,
    },
    execute: options.execute,
    timeoutMs: options.timeoutMs,
  }
}

export default { defineTool }
