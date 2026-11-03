import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillRegistry } from '@deepseek-ai/dsh-skill'

export const WORKBENCH_EXTENSION_SKILL_NAME = 'workbench-extension-development'
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

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '')
}

export function createWorkbenchCreatorSkillProvider(
  load = (signal?: AbortSignal) => readFile(skillFilePath, { encoding: 'utf8', signal }),
): SkillProvider {
  const candidate: SkillCandidate = summary
  return {
    name: 'workbench-core',
    async list(_options: SkillLookupOptions) {
      return [candidate]
    },
    async get(selected, options) {
      if (selected.name !== summary.name || selected.locator !== summary.locator) return undefined
      const content = await load(options.signal)
      const definition: SkillDefinition = {
        ...summary,
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
