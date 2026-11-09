/** Localized copy used by the Session binding chip and picker. */
export interface SessionBindingCopy {
  locale: 'zh-CN' | 'en-US'
  unavailableConversation: string
  newSession: string
  missing: string
  moved: string
  archived: string
  available: string
  running: string
  unavailable: string
  idle: string
  updatedUnknown: string
  updatedAt(value: Date): string
  bindLabel(marker: string, title: string): string
  bindingChange: string
  search: string
  searchPlaceholder: string
  editMarker: string
  shortLabel: string
  shortLabelPlaceholder: string
  chooseEmoji: string
  conversationColor: string
  color(index: number): string
  markerConflict(title: string): string
  markerLength: string
  markerControl: string
  markerEmpty: string
  saveMarker: string
  restoreMarker: string
  chooseConversation: string
  noMatches: string
  bound(marker: string, title: string): string
  opening(workspace: string, marker: string, title: string): string
}

const zhCN: SessionBindingCopy = {
  locale: 'zh-CN',
  unavailableConversation: '对话不可用',
  newSession: '新会话',
  missing: '缺失',
  moved: '对话已移出此项目',
  archived: '已归档',
  available: '可用',
  running: '运行中',
  unavailable: '不可用',
  idle: '空闲',
  updatedUnknown: '更新时间未知',
  updatedAt: value => `最近更新 ${new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(value)}`,
  bindLabel: (marker, title) => `选择此内页的对话 ${marker} · ${title}`,
  bindingChange: '此内页的来源对话已更换',
  search: '搜索对话',
  searchPlaceholder: '搜索对话、标签或 Session ID',
  editMarker: '设置对话标记与颜色',
  shortLabel: '短标签',
  shortLabelPlaceholder: '输入 1–3 个字符或 Emoji',
  chooseEmoji: '选择 Emoji',
  conversationColor: '对话颜色',
  color: index => `颜色 ${String(index)}`,
  markerConflict: title => `标签已被 ${title} 占用。`,
  markerLength: '短标签必须为 1–3 个字符。',
  markerControl: '短标签不能包含控制字符。',
  markerEmpty: '短标签不能为空。',
  saveMarker: '保存对话标记',
  restoreMarker: '恢复自动标记',
  chooseConversation: '选择此内页的对话',
  noMatches: '没有匹配的对话',
  bound: (marker, title) => `此内页显示 ${marker} · ${title}`,
  opening: (workspace, marker, title) => `正在打开 ${workspace} 中的 ${marker} · ${title}`,
}

const enUS: SessionBindingCopy = {
  locale: 'en-US',
  unavailableConversation: 'Conversation unavailable',
  newSession: 'New Session',
  missing: 'Missing',
  moved: 'Conversation moved out of this project',
  archived: 'Archived',
  available: 'Available',
  running: 'Running',
  unavailable: 'Unavailable',
  idle: 'Idle',
  updatedUnknown: 'Update time unavailable',
  updatedAt: value => `Last updated ${new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short', timeStyle: 'short',
  }).format(value)}`,
  bindLabel: (marker, title) => `Bound conversation ${marker} · ${title}`,
  bindingChange: 'Conversation source for this page changed',
  search: 'Search conversations',
  searchPlaceholder: 'Search conversations, labels, or Session ID',
  editMarker: 'Set conversation marker and color',
  shortLabel: 'Short label',
  shortLabelPlaceholder: 'Enter 1–3 characters or an emoji',
  chooseEmoji: 'Choose an emoji',
  conversationColor: 'Conversation color',
  color: index => `Color ${String(index)}`,
  markerConflict: title => `That label is already used by ${title}.`,
  markerLength: 'The short label must contain 1–3 characters.',
  markerControl: 'The short label cannot contain control characters.',
  markerEmpty: 'The short label cannot be empty.',
  saveMarker: 'Save conversation marker',
  restoreMarker: 'Restore automatic marker',
  chooseConversation: 'Choose a conversation for this page',
  noMatches: 'No matching conversations',
  bound: (marker, title) => `Bound to ${marker} · ${title}`,
  opening: (workspace, marker, title) => `Opening ${marker} · ${title} in ${workspace}`,
}

/** Resolve Session binding copy from the explicit document language.
 * @param language - BCP 47 language tag; Chinese remains the product default.
 * @returns localized strings and formatters for the binding surface.
 */
export function sessionBindingCopy(language = document.documentElement.lang): SessionBindingCopy {
  return language.toLocaleLowerCase('und').startsWith('en') ? enUS : zhCN
}
