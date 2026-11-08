/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// App actions: named interactions the server runs, so people with Interact With Apps can use an app
// without being able to rewrite it. An action returns the top-level state fields it changes,
// and throws to refuse.

import type { AppName, AppStateMap } from './types';
import { chatActions } from './apps/Chat/actions';
import { pollActions } from './apps/Poll/actions';

export type AppAction<S> = (state: S, args: Record<string, unknown>, userId: string) => Partial<S>;

export const appActions: { [K in AppName]?: Record<string, AppAction<AppStateMap[K]>> } = {
  Chat: chatActions,
  Poll: pollActions,
};
