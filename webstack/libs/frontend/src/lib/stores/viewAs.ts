/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { create } from 'zustand';

// Previewing a room as some roles, or as a member, from the current user's browser only.
// Nobody else sees it, and nothing can be changed while it lasts.
export type ViewAs = { roomId: string; roles: string[]; userId?: string };

export const useViewAsStore = create<{ viewAs: ViewAs | null; setViewAs: (viewAs: ViewAs | null) => void }>()((set) => ({
  viewAs: null,
  setViewAs: (viewAs) => set({ viewAs }),
}));

export function previewing(): boolean {
  return useViewAsStore.getState().viewAs !== null;
}
