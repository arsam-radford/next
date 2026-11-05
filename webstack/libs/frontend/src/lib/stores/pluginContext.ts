import { create } from 'zustand';
import type { PluginContext } from '@sage3/sageplugin';

export type PluginDocumentContext = NonNullable<PluginContext['document']>;

interface PluginContextState {
  readonly boardId: string | null;
  readonly appOrder: readonly string[];
  readonly setAppOrder: (boardId: string | null, appOrder: readonly string[]) => void;
  // The user's permissions on a board, as permission names, for plugins to adapt to.
  readonly permissions: { readonly boardId: string | null; readonly names: readonly string[] };
  readonly setPermissions: (boardId: string | null, names: readonly string[]) => void;
  readonly documents: readonly { readonly appId: string; readonly document: PluginDocumentContext }[];
  readonly setDocument: (appId: string, document: PluginDocumentContext) => void;
  readonly removeDocument: (appId: string) => void;
}

// Browser-local passage selection is never persisted into shared app state.
export const usePluginContextStore = create<PluginContextState>()((set) => ({
  boardId: null,
  appOrder: [],
  setAppOrder: (boardId, appOrder) => set({ boardId, appOrder }),
  permissions: { boardId: null, names: [] },
  setPermissions: (boardId, names) => set({ permissions: { boardId, names } }),

  documents: [],

  setDocument: (appId, document) =>
    set((state) => ({
      documents: [...state.documents.filter((entry) => entry.appId !== appId), { appId, document }],
    })),

  removeDocument: (appId) =>
    set((state) => ({
      documents: state.documents.filter((entry) => entry.appId !== appId),
    })),
}));
