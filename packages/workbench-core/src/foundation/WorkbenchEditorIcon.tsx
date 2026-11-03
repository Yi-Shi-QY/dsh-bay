import { normalizeWorkbenchEditorIconName } from './catalog.ts'

/** One theme-inheriting line-icon set shared by frame and settings surfaces. */
export function WorkbenchEditorIcon({ name }: { name: string }) {
  const icon = normalizeWorkbenchEditorIconName(name) ?? 'extension'
  const common = {
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: false,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const

  switch (icon) {
    case 'plus-message':
      return <svg {...common}><path d="M6 5.5h12a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-3.5 3.5h-6l-5.5 3v-3H6A3.5 3.5 0 0 1 2.5 14V9A3.5 3.5 0 0 1 6 5.5Z" /><path d="M12 8.5v6M9 11.5h6" /></svg>
    case 'message':
      return <svg {...common}><path d="M6 5.5h12a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-3.5 3.5h-6l-5.5 3v-3H6A3.5 3.5 0 0 1 2.5 14V9A3.5 3.5 0 0 1 6 5.5Z" /><circle cx="8" cy="11.5" r=".75" fill="currentColor" stroke="none" /><circle cx="12" cy="11.5" r=".75" fill="currentColor" stroke="none" /><circle cx="16" cy="11.5" r=".75" fill="currentColor" stroke="none" /></svg>
    case 'trajectory':
      return <svg {...common}><path d="M5 5v14h14M5 9h6v5h7V7h-3" /><circle cx="5" cy="5" r="1.5" /><circle cx="11" cy="9" r="1.5" /><circle cx="18" cy="7" r="1.5" /><circle cx="18" cy="14" r="1.5" /></svg>
    case 'folder':
      return <svg {...common}><path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1.5" /><path d="M3 9h18l-1.6 9a2 2 0 0 1-2 1.5H5a2 2 0 0 1-2-2Z" /></svg>
    case 'terminal':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>
    case 'browser':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 8h18M6.5 6h.01" /><circle cx="12" cy="14" r="3.5" /><path d="M8.5 14h7M12 10.5c1 1 1.4 2.2 1.4 3.5S13 16.5 12 17.5" /></svg>
    case 'file-preview':
      return <svg {...common}><path d="M6 3.5h7l5 5V17a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6.5a3 3 0 0 1 3-3Z" /><path d="M13 3.5v5h5M6.5 12h3" /><circle cx="16" cy="15" r="2.5" /><path d="m17.8 16.8 1.7 1.7" /></svg>
    case 'changes':
      return <svg {...common}><path d="M7 4v15M17 5v15M7 7h7a3 3 0 0 1 0 6h-4" /><path d="m13 10-3 3 3 3M14 7l3-3 3 3M14 17l3 3 3-3" /></svg>
    case 'plan':
      return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m7 8 1.5 1.5L11 7M13.5 9H17M7 14l1.5 1.5L11 13M13.5 15H17" /></svg>
    case 'schedule':
      return <svg {...common}><rect x="3.5" y="5" width="17" height="16" rx="3" /><path d="M7.5 3v4M16.5 3v4M4 9.5h16" /><circle cx="12" cy="15" r="3.25" /><path d="M12 13v2l1.5 1" /></svg>
    case 'guide':
      return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 4H12v16H7.5A3.5 3.5 0 0 0 4 21ZM20 5.5A3.5 3.5 0 0 0 16.5 4H12v16h4.5a3.5 3.5 0 0 1 3.5 1Z" /><path d="M7 8h2M15 8h2M7 11h2M15 11h2" /></svg>
    case 'subagent':
      return <svg {...common}><circle cx="12" cy="5" r="2.5" /><circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M10.8 7.2 7.2 14.8M13.2 7.2l3.6 7.6M8.5 17h7" /><path d="M10 5h4" /></svg>
    case 'tool':
      return <svg {...common}><path d="M14.5 6.5a5 5 0 0 0-6.2 6.2L4 17a2.1 2.1 0 1 0 3 3l4.3-4.3a5 5 0 0 0 6.2-6.2l-3 3-3-3Z" /><path d="m15.5 5.5 3-2 2 2-2 3" /></svg>
    case 'extension':
      return <svg {...common}><path d="M9 3.5h3v2a2.5 2.5 0 1 0 5 0v-2h3.5V10h-2a2.5 2.5 0 1 0 0 5h2v5.5H14v-2a2.5 2.5 0 1 0-5 0v2H3.5V14h2a2.5 2.5 0 1 0 0-5h-2V5H9Z" /></svg>
    case 'panel':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M12 4v16M3 11h9M12 11h9" /></svg>
    default:
      return <svg {...common}><path d="M6 5.5h12a3.5 3.5 0 0 1 3.5 3.5v5a3.5 3.5 0 0 1-3.5 3.5h-6l-5.5 3v-3H6A3.5 3.5 0 0 1 2.5 14V9A3.5 3.5 0 0 1 6 5.5Z" /></svg>
  }
}
