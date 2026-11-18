import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Agent-scoped additions beside the official DSH Creator tools. */
export const name = 'workbench-creator-tools'
export const inject = ['tools', 'cordisInspect', 'systemPrompt'] as const

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'workbench:creator',
    order: 115,
    text: `Workbench Creator adds Workbench awareness to the official DSH Creator mode.
The official cordis inspection tools are read-only: use cordis_inspect_list/query to
discover exact APIs, then author a normal workspace Bundle/Client Plugin and install
it with the DSH Plugin Manager (plugin_manager, action: install_bundle). Do not edit a
Profile directly. The Dynamic Cordis runner is a separate process-local API for
programmatic consumers and UI controls; it is not exposed here as the durable Creator
Agent installation path and its definitions disappear on restart.
For a durable, installable inner-page extension, load workbench-extension-development.
Users can start this workflow from the Creator slash menu with
/create-workbench-extension; that user-only shortcut loads the same contract and
keeps the actual authoring, build, and install decisions in the Creator Agent.
Read the complete Workbench container inner-page extension specification shipped with
that Skill before writing code. Register only additive workbench.editor.root or
workbench.editor.session pages. Keep package.json.name, Cordis plugin name, Slot registrant, and
DSH moduleName identical; put declaration and extension identity in
the Slot inject() workbenchEditor metadata because arbitrary Slot options are dropped.
Keep manifest editorIds, runtime extension.editorIds, and actual Slot IDs identical and
unique. Treat module activation scope (root/session/area) separately from editor render
scope (root/session). Use the exact owner workspaceId/sessionId supplied by Core; never
guess the global current Session or create one merely by opening a page. Declare binding,
unbound, state maxBytes/restore/share, lifecycle and conversation resource policies.
In the 18.0 Workbench model an Area is a project-directory association and may contain
many independent Sessions; it is not a representative Session. Use the session-client
template variant for conversation-bound pages and binding.sharing=independent. Project
files, terminals and resources must use public DSH/Workbench adapters and portable state
must never contain absolute paths, native Workspace IDs from another machine or transcripts.
For offline Workbench sharing, keep extension distribution separate from the complete
Workbench package: set exportPolicy=embed, declare an exact runtimeFiles list and
portability handlers, pass static closure checks, then verify the extension artifact is
embedded in an offline-embedded package by digest. The complete package carries the
Workbench root, Area projects, Sessions, attachments, context, memory and task relations;
the extension artifact carries only its own runtime files and bounded state.
Core inventory mapping, compatibility checks and Workbench consent must pass before an
editor is considered available; an accepted build or Slot registration is not proof of
installation or activation.
Use the native DSH tools and skills for coding, composition, testing and packaging.
Build and test in a separate test Profile. Deliver a versioned candidate with evidence.
Do not install into the user's active Profile, add a page to the current Workbench or
publish it automatically. Layout inspection and a semantic plan do not apply a layout.
This version supplies no Workbench layout mutation command. Never infer bindings from
focus, position or the official main Session.`,
  })
  ctx.tools.register(defineTool({
    name: 'workbench_inspect',
    description: 'Read the current Workbench layout, exact Area bindings, editor availability and Settings revision. Read-only: no transcripts, credentials, raw module state or mutation handles. If the Workbench provider is absent, reconnect a Workbench page; never guess its layout.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('Workbench inspection requires an Agent-backed session')
      return await ctx.cordisInspect.query('client', 'WorkbenchCreator', 'inspect', undefined, exec.agent, exec.signal)
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: '查看当前工作台' }),
  }))
}
