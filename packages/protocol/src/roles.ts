/** Roles persisted to the database. */
export const storedChatRoles = ['user', 'assistant', 'tool', 'error'] as const;
export type StoredChatRole = (typeof storedChatRoles)[number];

/** Roles shown in the client (includes ephemeral streaming blocks). */
export const uiChatRoles = [...storedChatRoles, 'thought'] as const;
export type UiChatRole = (typeof uiChatRoles)[number];

export const toolStatuses = ['pending', 'success', 'failed'] as const;
export type ToolStatus = (typeof toolStatuses)[number];
