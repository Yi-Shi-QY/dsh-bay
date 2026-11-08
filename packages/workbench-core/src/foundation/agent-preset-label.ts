/** Known built-in modes; custom preset IDs remain explicit rather than guessing a mode. */
export function workbenchAgentPresetLabel(id: string): string {
  switch (id) {
    case 'standard': return '标准模式'
    case 'ptc': return 'PTC 模式'
    case 'minimal': return '极简模式'
    case 'creator': return '创造模式'
    case 'workbench-creator': return 'Workbench 创作模式'
    case 'bay-agent': return 'Bay Agent 模式'
    default: return id
  }
}
