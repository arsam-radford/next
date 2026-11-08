/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { schema, type state } from './index';

// Interactions the server runs for Chat. Posting needs Chat rather than Edit Apps, and appends to what is there.
export const chatActions = {
  // Add messages under the poster's own id, with the AI history that goes with them.
  post(current: state, args: Record<string, unknown>, userId: string): Partial<state> {
    const messages = schema.shape.messages.parse(args.messages).map((message) => ({ ...message, userId }));
    const previousQ = schema.shape.previousQ.parse(args.previousQ ?? []);
    const previousA = schema.shape.previousA.parse(args.previousA ?? []);
    return {
      messages: [...current.messages, ...messages],
      previousQ: [...current.previousQ, ...previousQ],
      previousA: [...current.previousA, ...previousA],
    };
  },
};
