/** Core's curated presentation of the one supported Suite contract. No archive code is evaluated. */
export const WORKBENCH_CONVERSATION_PAGE_METADATA = [
  { id: 'workbench.conversation.start', label: '新建对话', scope: 'root',
    description: '选择工作区、Agent、模型与权限，开始独立对话。', preview: 'start' },
  { id: 'workbench.conversation', label: '对话', scope: 'session',
    description: '当前容器绑定的对话、消息与输入。', preview: 'conversation' },
  { id: 'workbench.agent-trajectory', label: 'Agent 轨迹', scope: 'session',
    description: '当前容器绑定会话的执行步骤与工具记录。', preview: 'trajectory' },
] as const
