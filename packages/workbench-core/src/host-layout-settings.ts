/** New Profiles start at Home; existing workbench records are preserved. */
import z from '@deepseek-ai/schemastery'

/** Settings namespace used by Workbench layout persistence. */
export const WORKBENCH_SETTINGS_NAMESPACE = 'workbench-layout'

const SessionMarkersSchema = z.dict(z.dict(z.object({
  label: z.string(),
  accentToken: z.string(),
  customized: z.boolean(),
}))).default({})

const DEFAULT_WORKBENCH_SETTINGS = {
  version: 4 as const,
  activeWorkbenchId: 'main',
  openWorkbenchIds: [],
  globalHiddenEditorIds: [],
  workbenches: {},
  layoutTemplates: {},
  invalidWorkbenches: {},
  sessionMarkers: {},
}

const WorkbenchSettingsV1Schema = z.object({
  version: z.const(1),
  layouts: z.dict(z.any()).default({}),
})

const WorkbenchSettingsV2Schema = z.object({
  version: z.const(2).default(2),
  layouts: z.dict(z.any()).default({}),
  invalidLayouts: z.dict(z.any()).default({}),
  sessionMarkers: SessionMarkersSchema,
}).default({
  version: 2,
  layouts: {},
  invalidLayouts: {},
  sessionMarkers: {},
})

const WorkbenchSettingsV4Schema = z.object({
  version: z.const(4).default(4),
  activeWorkbenchId: z.string().default('main'),
  openWorkbenchIds: z.array(z.string()).default([]),
  globalHiddenEditorIds: z.array(z.string()),
  editorMenu: z.any(),
  sidebarShortcuts: z.any(),
  // Strict record validation and lifecycle metadata migration live in the
  // client decoder; keep this Host envelope open for older V4 records.
  workbenches: z.dict(z.any()).default(DEFAULT_WORKBENCH_SETTINGS.workbenches),
  layoutTemplates: z.dict(z.object({
    templateId: z.string(),
    name: z.string(),
    document: z.any(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })).default({}),
  invalidWorkbenches: z.dict(z.any()).default({}),
  sessionMarkers: SessionMarkersSchema,
  // The client decoder performs strict normalization; the host keeps this
  // field open so older profiles can be read and upgraded atomically.
  interactionPolicy: z.any().default({}),
  backgroundAi: z.any().default({}),
  extensionConsents: z.dict(z.object({
    packageName: z.string(), moduleId: z.string(), apiVersion: z.const(1),
    editorIds: z.array(z.string()).max(32).default([]),
    contractFingerprint: z.string(), allowedAt: z.number(), allowed: z.boolean().default(true),
  })).default({}),
}).default(DEFAULT_WORKBENCH_SETTINGS)

const WorkbenchSettingsV3Schema = z.object({
  version: z.const(3),
  activeWorkbenchId: z.string(),
  workbenches: z.dict(z.object({
    workbenchId: z.string(), name: z.string(), document: z.any(), createdAt: z.number(), updatedAt: z.number(),
  })).default({}),
  layoutTemplates: z.dict(z.any()).default({}),
  invalidWorkbenches: z.dict(z.any()).default({}),
  sessionMarkers: SessionMarkersSchema,
})

/** Schema for legacy migration reads and all new v4 Workbench Settings writes. */
export const WorkbenchSettingsSchema = z.union([
  WorkbenchSettingsV4Schema,
  WorkbenchSettingsV3Schema,
  WorkbenchSettingsV2Schema,
  WorkbenchSettingsV1Schema,
]).default(DEFAULT_WORKBENCH_SETTINGS)
