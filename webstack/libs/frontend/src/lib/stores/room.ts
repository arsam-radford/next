/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Zustand
import { create } from 'zustand';
// Dev Tools
import { mountStoreDevtool } from 'simple-zustand-devtools';

// Application specific schema
import { Audit, Invite, Room, RoomMembers, RoomSchema } from '@sage3/shared/types';
import { Role } from '@sage3/shared';

// The observable websocket and HTTP
import { APIHttp, SocketAPI } from '../api';
import { useBoardStore } from './board';

interface RoomState {
  rooms: Room[];
  error: string | null;
  fetched: boolean;
  members: RoomMembers[];
  fetchRoom: (roomId: string) => Promise<Room | undefined>;
  // Join a room, with an invite code when it needs one. Resolves to an error message, if any.
  joinRoomMembership: (roomId: string, code?: string) => Promise<string | undefined>;
  leaveRoomMembership: (roomId: string) => Promise<void>;
  removeUserRoomMembership: (roomId: string, userId: string) => Promise<boolean>;
  // Moderation. Each resolves to an error message, if any.
  moderate: (action: 'add' | 'remove' | 'ban' | 'unban' | 'roles' | 'timeout', body: { roomId: string; userId: string; roles?: string[]; until?: number }) => Promise<string | undefined>;
  // Replace the roles, if they are still `before`. Resolves to an error message, if any.
  saveRoles: (roomId: string, roles: Role[], before: Role[]) => Promise<string | undefined>;
  // Invites and the audit log, fetched on demand by the room settings.
  createInvite: (roomId: string, roles: string[], options?: { code?: string; expiresAt?: number; maxUses?: number }) => Promise<Invite | string>;
  fetchInvites: (roomId: string) => Promise<Invite[]>;
  revokeInvite: (id: string) => Promise<string | undefined>;
  fetchAudit: (roomId: string) => Promise<Audit[]>;
  clearError: () => void;
  create: (newRoom: RoomSchema) => Promise<Room | undefined>;
  update: (id: string, updates: Partial<RoomSchema>) => Promise<void>;
  delete: (id: string) => Promise<void>;
  subscribeToAllRooms: () => Promise<void>;
}

/**
 * The RoomStore.
 */
const RoomStore = create<RoomState>()((set, get) => {
  let roomSub: (() => void) | null = null;
  let membersSub: (() => void) | null = null;

  // Subscribe to all the room members collection
  const subscribeToRoomMembers = async () => {
    const rooms = await APIHttp.GET<RoomMembers>('/roommembers');
    const members = rooms.data ? rooms.data : [];
    set({ members });
    // Unsubscribe old subscription
    if (membersSub) {
      membersSub();
      membersSub = null;
    }

    // Socket Subscribe Message
    const route = '/roommembers';
    // Socket Listenting to updates from server about the current members
    membersSub = await SocketAPI.subscribe<RoomMembers>(route, (message) => {
      switch (message.type) {
        case 'CREATE': {
          const docs = message.doc as RoomMembers[];
          // Members see every membership of their rooms, so one in a room with none known yet is the
          // user's own: they just joined or were added, and can now see that room's boards and roster.
          const joined = docs.some((doc) => !get().members.some((m) => m.data.roomId === doc.data.roomId));
          set({ members: [...get().members, ...docs] });
          if (joined) refetch();
          break;
        }
        case 'UPDATE': {
          const docs = message.doc as RoomMembers[];
          const members = [...get().members];
          // An update can be the first sight of a membership the user just became able to see.
          docs.forEach((doc) => {
            const idx = members.findIndex((el) => el._id === doc._id);
            if (idx > -1) members[idx] = doc;
            else members.push(doc);
          });
          set({ members });
          break;
        }
        case 'DELETE': {
          const docs = message.doc as RoomMembers[];
          const ids = docs.map((d) => d._id);
          const members = [...get().members];
          const remainingMembers = members.filter((a) => !ids.includes(a._id));
          set({ members: remainingMembers });
        }
      }
    });
  };

  const refetch = async () => {
    const [rooms, members] = await Promise.all([APIHttp.GET<Room>('/rooms'), APIHttp.GET<RoomMembers>('/roommembers')]);
    if (rooms.success && rooms.data) set({ rooms: rooms.data });
    if (members.success && members.data) set({ members: members.data });
    await useBoardStore.getState().refetch();
  };

  return {
    rooms: [],
    error: null,
    fetched: false,
    members: [],
    fetchRoom: async (roomId: string) => {
      const room = await APIHttp.GET<Room>(`/rooms/${roomId}`);
      if (room.success && room.data) {
        return room.data[0];
      } else {
        set({ error: room.message });
        return undefined;
      }
    },
    joinRoomMembership: async (roomId: string, code?: string) => {
      const response = await APIHttp.POST<any>(`/roommembers/join`, { roomId, code });
      if (!response.success) return response.message ?? 'Could not join the room.';
      // Members see the room and its roster only from now on, so fetch what was there before.
      await refetch();
      return undefined;
    },
    leaveRoomMembership: async (roomId: string) => {
      await APIHttp.POST<any>(`/roommembers/leave`, { roomId });
    },
    removeUserRoomMembership: async (roomId: string, userId: string) => {
      const response = await APIHttp.POST<any>(`/roommembers/remove`, { roomId, userId });
      return response.success;
    },
    saveRoles: async (roomId, roles, before) => {
      const response = await APIHttp.POST<any>(`/rooms/${roomId}/roles`, { roles, before });
      return response.success ? undefined : (response.message ?? 'Could not save the roles.');
    },
    createInvite: async (roomId, roles, options) => {
      const response = await APIHttp.POST<any>('/invites/create', { roomId, roles, ...options });
      return response.success && response.data ? (response.data[0] as Invite) : (response.message ?? 'Could not create the invite.');
    },
    fetchInvites: async (roomId) => {
      const response = await APIHttp.QUERY<Invite>('/invites', { roomId });
      return response.success && response.data ? response.data : [];
    },
    revokeInvite: async (id) => {
      const response = await APIHttp.DELETE(`/invites/${id}`);
      return response.success ? undefined : (response.message ?? 'Could not revoke the invite.');
    },
    fetchAudit: async (roomId) => {
      const response = await APIHttp.QUERY<Audit>('/audit', { roomId });
      return response.success && response.data ? response.data.sort((a, b) => b._createdAt - a._createdAt) : [];
    },
    moderate: async (action, body) => {
      const response = await APIHttp.POST<any>(`/roommembers/${action}`, body);
      return response.success ? undefined : (response.message ?? 'Not allowed.');
    },
    clearError: () => {
      set({ error: null });
    },
    create: async (newRoom: RoomSchema) => {
      const res = await SocketAPI.sendRESTMessage(`/rooms/`, 'POST', newRoom);
      if (!res.success) {
        set({ error: res.message });
        return undefined;
      } else {
        return res.data;
      }
    },
    update: async (id: string, updates: Partial<RoomSchema>) => {
      const res = await SocketAPI.sendRESTMessage(`/rooms/${id}`, 'PUT', updates);
      if (!res.success) {
        set({ error: res.message });
      }
    },
    delete: async (id: string) => {
      const res = await SocketAPI.sendRESTMessage(`/rooms/${id}`, 'DELETE');
      if (!res.success) {
        set({ error: res.message });
      }
      // TO DO Delete all boards belonging to the room
    },
    subscribeToAllRooms: async () => {
      // Sub to Members
      await subscribeToRoomMembers();

      set({ rooms: [], fetched: false });

      const rooms = await APIHttp.GET<Room>('/rooms');
      if (rooms.success) {
        set({ rooms: rooms.data, fetched: true });
      } else {
        set({ error: rooms.message });
        return;
      }
      // Unsubscribe old subscription
      if (roomSub) {
        roomSub();
        roomSub = null;
      }

      // Socket Subscribe Message
      const route = '/rooms';
      // Socket Listenting to updates from server about the current rooms
      roomSub = await SocketAPI.subscribe<Room>(route, (message) => {
        switch (message.type) {
          case 'CREATE': {
            const docs = message.doc as Room[];
            set({ rooms: [...get().rooms, ...docs] });
            break;
          }
          case 'UPDATE': {
            const docs = message.doc as Room[];
            const rooms = [...get().rooms];
            docs.forEach((doc) => {
              const idx = rooms.findIndex((el) => el._id === doc._id);
              if (idx > -1) rooms[idx] = doc;
              else rooms.push(doc);
            });
            set({ rooms });
            break;
          }
          case 'DELETE': {
            const docs = message.doc as Room[];
            const ids = docs.map((d) => d._id);
            const rooms = [...get().rooms];
            const remainingRooms = rooms.filter((a) => !ids.includes(a._id));
            set({ rooms: remainingRooms });
          }
        }
      });
    },
  };
});

// Export the Zustand store
export const useRoomStore = RoomStore;

// Add Dev tools
if (process.env.NODE_ENV === 'development') mountStoreDevtool('RoomStore', useRoomStore);
