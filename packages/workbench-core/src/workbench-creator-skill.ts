import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { SkillDefinition, SkillLookupOptions, SkillProvider, SkillRegistry } from '@deepseek-ai/dsh-skill'

export const WORKBENCH_EXTENSION_SKILL_NAME = 'workbench-extension-development'
export const CREATE_WORKBENCH_EXTENSION_SKILL_NAME = 'create-workbench-extension'
const skillDirectoryUrl = new URL('../presets/workbench-creator/skills/workbench-extension-development/', import.meta.url)
const skillFileUrl = new URL('SKILL.md', skillDirectoryUrl)
const skillFilePath = fileURLToPath(skillFileUrl)
const skillRootPath = fileURLToPath(skillDirectoryUrl)

const summary = Object.freeze({
  name: WORKBENCH_EXTENSION_SKILL_NAME,
  description: 'Create, validate, and package a DSH plugin that adds a Workbench inner page. Use when the requested result should be a reusable Workbench extension.',
  invocation: Object.freeze({ modelInvocable: true, userInvocable: false }),
  source: 'bundled',
  provider: 'workbench-core',
  rank: 600,
  locator: skillFilePath,
  path: skillFilePath,
  resourceBase: Object.freeze({ kind: 'directory' as const, path: skillRootPath }),
})

/**
 * Short human-facing entry for the Creator's `/` menu. The detailed skill
 * remains model-only so the catalog has one canonical development contract;
 * this alias is deliberately user-only and loads the same instructions when
 * the user explicitly starts the workflow.
 */
const shortcutSummary = Object.freeze({
  name: CREATE_WORKBENCH_EXTENSION_SKILL_NAME,
  description: 'Create a Workbench inner-page extension in the current workspace.',
  invocation: Object.freeze({ modelInvocable: false, userInvocable: true }),
  source: 'bundled',
  provider: 'workbench-core',
  rank: 600,
  locator: skillFilePath,
  path: skillFilePath,
  resourceBase: Object.freeze({ kind: 'directory' as const, path: skillRootPath }),
})

const summaries = Object.freeze([summary, shortcutSummary])

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '')
}

export function createWorkbenchCreatorSkillProvider(
  load = (signal?: AbortSignal) => readFile(skillFilePath, { encoding: 'utf8', signal }),
): SkillProvider {
  return {
    name: 'workbench-core',
    async list(_options: SkillLookupOptions) {
      return summaries
    },
    async get(selected, options) {
      const selectedSummary = summaries.find(candidate => candidate.name === selected.name && candidate.locator === selected.locator)
      if (selectedSummary === undefined) return undefined
      const content = await load(options.signal)
      const definition: SkillDefinition = {
        ...selectedSummary,
        content: stripFrontmatter(content),
      }
      return definition
    },
  }
}

export function installWorkbenchCreatorSkillProvider(
  registry: SkillRegistry | undefined,
): (() => void) | undefined {
  if (registry === undefined) return undefined
  return registry.registerProvider(() => createWorkbenchCreatorSkillProvider())
}
