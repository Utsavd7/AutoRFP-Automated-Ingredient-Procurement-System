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

export function useWorkspaceIdOptional() {
  return useContext(WorkspaceContext)?.workspaceId;
}
