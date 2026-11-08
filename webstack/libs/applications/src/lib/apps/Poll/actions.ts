/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import type { state } from './index';

// Interactions the server runs for Poll. Voting needs Interact With Apps, not Edit Apps.
export const pollActions = {
  // Vote for an option, or take the vote back. One vote per person per option.
  vote(current: state, args: Record<string, unknown>, userId: string): Partial<state> {
    const poll = current.poll;
    if (!poll || !poll.options.some((option) => option.id === args.optionId)) throw new Error('Option does not exist.');
    const options = poll.options.map((option) => {
      if (option.id !== args.optionId) return option;
      const voters = option.voters ?? [];
      return voters.includes(userId)
        ? { ...option, votes: option.votes - 1, voters: voters.filter((id) => id !== userId) }
        : { ...option, votes: option.votes + 1, voters: [...voters, userId] };
    });
    return { poll: { ...poll, options } };
  },
};
