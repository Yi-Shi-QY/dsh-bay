/**
 * Host-side composition of a manually assembled agent.
 *
 * Rows cover the controlled `standard` / `minimal` preset subset supported by
 * DSH 0.2.2-rc.2 (`@deepseek-ai/dsh-web-app/presets/*.patch.yml`). Core owns
 * this list; it does not claim to mirror every official preset block and never
 * copies YAML from another preset because those rows carry `!!js` expressions.
 * Platform conditions stay loader expressions.
 */

import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { presetIdFor, type WorkbenchAgentDefinitionV1 } from './agent-assembly-model.ts'

type PresetRow = PresetDefinition['plugins'][number]

const js = (expression: string) => ({ __jsExpr: expression })
const row = (id: string, name: string, config?: unknown, disabled?: { __jsExpr: string }): PresetRow =>
  ({ id, name, ...(config === undefined ? {} : { config }), ...(disabled === undefined ? {} : { disabled }) }) as PresetRow

const compaction = (): PresetRow => ({
  id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true }, config: [
    row('compaction-basic', '@deepseek-ai/dsh-compaction-basic'),
    row('command-compact', '@deepseek-ai/dsh-command-compact'),
  ],
}) as PresetRow

function persona(definition: WorkbenchAgentDefinitionV1): PresetRow {
  const extra = definition.instructions?.trim()
  if (definition.basePreset === 'minimal') {
    const prefix = ['You are a helpful assistant for one DSH Bay workbench.', extra].filter(Boolean).join('\n\n')
    return row('persona', '@deepseek-ai/dsh-persona', { prefix, complete: true, includeRuntimeContext: false })
  }
  const prefix = ['You are a coding agent powered by the {{model}} model.', extra].filter(Boolean).join('\n\n')
  return row('persona', '@deepseek-ai/dsh-persona', { prefix })
}

export function composeAgentPlugins(definition: WorkbenchAgentDefinitionV1): readonly PresetRow[] {
  const has = (id: string) => definition.basePreset === 'standard' && definition.blocks.includes(id)
  const rows: PresetRow[] = [persona(definition)]
  if (definition.basePreset === 'minimal') {
    rows.push(row('tool-fs', '@deepseek-ai/dsh-tool-fs', { read: false, readImage: true, write: false, edit: false }))
    rows.push(compaction())
    return rows
  }
  if (has('agent-instructions')) rows.push(row('agent-instructions', '@deepseek-ai/dsh-agent-instructions', { maxBytes: 65536 }))
  rows.push(row('time-context', '@deepseek-ai/dsh-time-context'))
  if (has('tool-shell')) {
    rows.push(row('tool-bash', '@deepseek-ai/dsh-tool-bash', undefined, js("process.platform === 'win32'")))
    rows.push(row('tool-pwsh', '@deepseek-ai/dsh-tool-pwsh', undefined, js("process.platform !== 'win32'")))
  }
  if (has('tool-fs')) {
    rows.push(row('tool-fs', '@deepseek-ai/dsh-tool-fs', { applyPatch: false }))
    rows.push(row('tool-fs-search', '@deepseek-ai/dsh-tool-fs-search', { sampleOverCapGlobResults: false }))
  }
  if (has('skill')) {
    rows.push(row('skill-filesystem', '@deepseek-ai/dsh-skill-filesystem'))
    rows.push(row('tool-skill', '@deepseek-ai/dsh-tool-skill'))
  }
  rows.push(compaction())
  if (has('agent-loop')) {
    rows.push(row('tool-ask-user', '@deepseek-ai/dsh-tool-ask-user'))
    rows.push(row('tool-todo', '@deepseek-ai/dsh-tool-todo', { allowParallelInProgress: true }))
  }
  if (has('tool-web')) rows.push(row('tool-web', '@deepseek-ai/dsh-tool-web', { fetch: true, searchTimeoutMs: 60000 }))
  return rows
}

/** Preset registered in memory. The id carries the revision. */
export function composeAgentPreset(workbenchId: string, definition: WorkbenchAgentDefinitionV1): PresetDefinition {
  return {
    id: presetIdFor(workbenchId, definition),
    name: definition.name,
    description: definition.description,
    order: 180,
    plugins: composeAgentPlugins(definition),
  }
}
