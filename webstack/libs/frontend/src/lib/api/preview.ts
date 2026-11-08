/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { previewing } from '../stores/viewAs';

// While previewing a room as a role, nothing may be changed. The user's own presence and account
// still update, so they keep appearing as themselves.
export function blockedByPreview(route: string): boolean {
  return previewing() && !/^\/(presence|users)(\/|$)/.test(route);
}

export const previewRefusal = { success: false, message: 'Exit "view as" to make changes.' };
