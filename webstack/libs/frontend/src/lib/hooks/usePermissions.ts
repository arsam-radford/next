/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// The current user's permissions, computed like the server does. Only for deciding what to show:
// the server checks every request itself.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';

import { Account, accountFor, AppAccess, boardPermissions, has, MemberAccess, roomPermissions, rank } from '@sage3/shared';
import { Board, memberId, Room, RoomMembers } from '@sage3/shared/types';

import { useUser } from '../providers';
import { useBoardStore, useConfigStore, useRoomStore, useViewAsStore } from '../stores';

export function useAccount(): Account {
  const { user } = useUser();
  const config = useConfigStore((state) => state.config);
  const role = user && config.admins?.includes(user.data.email) ? 'admin' : user?.data.userRole;
  return accountFor(user?._id ?? '', role, !!config.features?.restrictRoomCreation);
}

export function useRoom(roomId?: string): Room | undefined {
  const params = useParams();
  const id = roomId ?? params.roomId;
  return useRoomStore((state) => state.rooms.find((room) => room._id === id));
}

export function useMembership(roomId?: string): RoomMembers | undefined {
  const { user } = useUser();
  const room = useRoom(roomId);
  const id = room && user ? memberId(room._id, user._id) : '';
  return useRoomStore((state) => state.members.find((member) => member._id === id));
}

/**
 * Whose permissions to show in a room: the user's, or while previewing it, the previewed roles or member.
 */
export function usePerspective(roomId?: string): { account: Account; member?: MemberAccess } {
  const account = useAccount();
  const room = useRoom(roomId);
  const real = useMembership(room?._id);
  const viewAs = useViewAsStore((state) => state.viewAs);
  const members = useRoomStore((state) => state.members);
  if (!room || viewAs?.roomId !== room._id) return { account, member: real?.data };
  const previewed = viewAs.userId ? members.find((m) => m._id === memberId(room._id, viewAs.userId!))?.data : undefined;
  return {
    account: { userId: viewAs.userId ?? '', instanceAdmin: false, createRooms: false, readOnly: false },
    member: previewed ?? { roles: viewAs.roles, timeoutUntil: 0 },
  };
}

export function useRoomPermissions(roomId?: string): number {
  const room = useRoom(roomId);
  const { account, member } = usePerspective(room?._id);
  return room ? roomPermissions(room.data, member, account) : 0;
}

/**
 * Board permissions on a board, or on the board the page shows.
 */
export function useBoardPermissions(boardId?: string): number {
  const params = useParams();
  const id = boardId ?? params.boardId;
  const board = useBoardStore((state) => state.boards.find((b) => b._id === id));
  return useBoardPermissionsOf(board);
}

/**
 * Permissions on a board, or on one of its apps when given, which applies the app's own overrides.
 */
export function useBoardPermissionsOf(board: Board | undefined, app?: AppAccess): number {
  const room = useRoom(board?.data.roomId);
  const { account, member } = usePerspective(room?._id);
  const until = member?.timeoutUntil ?? 0;
  // Recompute when a timeout ends.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), until - now);
    return () => clearTimeout(timer);
  }, [until, now]);
  return board && room ? boardPermissions(room.data, board.data, member, account, now, app) : 0;
}

/**
 * Permissions on an app: its board's, adjusted by the app's own overrides.
 */
export function useAppPermissions(app: { data: { boardId: string } & AppAccess } | undefined): number {
  const board = useBoardStore((state) => state.boards.find((b) => b._id === app?.data.boardId));
  return useBoardPermissionsOf(board, app?.data);
}

/**
 * Permissions on any app of a board (the page's by default), for checking a selection of apps.
 */
export function useAppPermissionsFn(boardId?: string): (app: { data: AppAccess }) => number {
  const params = useParams();
  const id = boardId ?? params.boardId;
  const board = useBoardStore((state) => state.boards.find((b) => b._id === id));
  const room = useRoom(board?.data.roomId);
  const { account, member } = usePerspective(room?._id);
  return (app) => (board && room ? boardPermissions(room.data, board.data, member, account, Date.now(), app.data) : 0);
}

/**
 * Board permissions for any board of a room, for filtering lists.
 */
export function useBoardPermissionsIn(roomId?: string): (board: Board) => number {
  const room = useRoom(roomId);
  const { account, member } = usePerspective(room?._id);
  return (board) => (room ? boardPermissions(room.data, board.data, member, account, Date.now()) : 0);
}

/**
 * Whether the current user holds a permission on the board the page shows.
 */
export function useCan(permission: number, boardId?: string): boolean {
  return has(useBoardPermissions(boardId), permission);
}

export function useRank(roomId?: string): number {
  const room = useRoom(roomId);
  const { account, member } = usePerspective(room?._id);
  return room ? rank(room.data, member, account) : 0;
}
