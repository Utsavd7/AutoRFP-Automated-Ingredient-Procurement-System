'use client';

import { createContext, useContext } from 'react';

const WorkspaceContext = createContext<{ workspaceId: string } | null>(null);

export function WorkspaceProvider({
  children,
  workspaceId,
}: {
  children: React.ReactNode;
  workspaceId: string;
}) {
  return (
    <WorkspaceContext.Provider value={{ workspaceId }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceId() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('Workspace context is unavailable.');
  return context.workspaceId;
}

export function useWorkspaceIdOptional() {
  return useContext(WorkspaceContext)?.workspaceId;
}
