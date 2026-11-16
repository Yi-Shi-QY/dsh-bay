/** Identifies which surface currently renders a Workbench and its authority. */
export type WorkbenchSurfaceContextV1 =
  | { readonly kind: 'desktop' }
  | { readonly kind: 'browser-owner'; readonly workbenchId: string }

export const DESKTOP_WORKBENCH_SURFACE_V1: WorkbenchSurfaceContextV1 = Object.freeze({ kind: 'desktop' })

/**
 * Shared-control surface identity. The legacy V1 shape remains exported for
 * extensions compiled against 18.1, while new collaborative rendering uses
 * an explicit Workbench and collaboration identity for every participant.
 */
export type WorkbenchSurfaceContextV2 =
  | {
      readonly kind: 'desktop'
      readonly workbenchId: string
      readonly collaborationId?: string
      readonly participantId?: string
    }
  | {
      readonly kind: 'browser-owner'
      readonly workbenchId: string
      readonly collaborationId?: string
      readonly participantId: string
    }
  | {
      readonly kind: 'lan-participant'
      readonly workbenchId: string
      readonly collaborationId: string
      readonly participantId: string
    }

export function isWorkbenchCollaborationSurface(context: WorkbenchSurfaceContextV1 | WorkbenchSurfaceContextV2): context is WorkbenchSurfaceContextV2 {
  return context.kind === 'lan-participant'
    || typeof (context as { workbenchId?: unknown }).workbenchId === 'string'
}
