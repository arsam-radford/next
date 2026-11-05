/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Read-only and "who can change this" for single apps: presets in the app menus, and a grid of an app's own rules per role.

import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Grid,
  HStack,
  MenuGroup,
  MenuItem,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
  useToast,
} from '@chakra-ui/react';

import { MdCheck, MdVisibility, MdVisibilityOff } from 'react-icons/md';

import { App } from '@sage3/applications/schema';
import { Account, ALL, APP_PERMISSIONS, applyAppOverrides, boardBase, EVERYONE, Override, Permission as P, Role } from '@sage3/shared';

import { useRoom, useRoomPermissions } from '../../../hooks';
import { useAppStore, useBoardStore } from '../../../stores';
import { find, setOverride } from './PermissionList';

type Preset = 'everyone' | 'readonly' | 'default';

/**
 * The overrides of a preset. "readonly": only staff, the roles that can manage boards, may use or change the app; everyone else looks.
 */
export function appPreset(preset: Preset, roles: Role[]): Override[] {
  if (preset === 'default') return [];
  if (preset === 'everyone') return [{ kind: 'role', target: EVERYONE, allow: P.InteractWithApps | P.EditOwnApps | P.EditOthersApps, deny: 0 }];
  const staff = roles.slice(1).filter((r) => r.permissions & (P.ManageBoards | P.Administrator));
  return [
    { kind: 'role', target: EVERYONE, allow: 0, deny: APP_PERMISSIONS },
    ...staff.map((r) => ({ kind: 'role' as const, target: r.id, allow: APP_PERMISSIONS, deny: 0 })),
  ];
}

// Read-only: @everyone may not use or change the app, whatever else its rules say.
export const isReadOnly = (app: App) =>
  (app.data.overrides ?? []).some((o) => o.kind === 'role' && o.target === EVERYONE && (o.deny & APP_PERMISSIONS) === APP_PERMISSIONS);

const isPreset = (app: App, preset: Preset, roles: Role[]) =>
  JSON.stringify((app.data.overrides ?? []).filter((o) => o.kind === 'role')) === JSON.stringify(appPreset(preset, roles));

// Applies a preset to the given apps, for people who can manage boards; undefined for everyone else.
function usePresets(apps: App[]) {
  const room = useRoom(apps[0]?.data.roomId);
  const permissions = useRoomPermissions(apps[0]?.data.roomId);
  const save = useAppStore((state) => state.saveAppOverrides);
  const toast = useToast();
  if (!room || !(permissions & P.ManageBoards) || apps.length === 0) return undefined;
  const roles = room.data.roles;
  const apply = async (preset: Preset) => {
    for (const app of apps) {
      const error = await save(app._id, appPreset(preset, roles), app.data.overrides ?? []);
      if (error) {
        toast({ title: error, status: 'error', duration: 3000, isClosable: true });
        return;
      }
    }
    toast({ title: 'Permissions saved', status: 'success', duration: 2000 });
  };
  return { apply, active: (preset: Preset) => apps.every((app) => isPreset(app, preset, roles)) };
}

/**
 * Turn read-only on or off for the given apps: everyone but staff can only look at a read-only app. Goes right under Pin.
 */
export function AppReadOnlyMenuItem(props: { apps: App[] }) {
  const presets = usePresets(props.apps);
  if (!presets) return null;
  const readOnly = props.apps.every(isReadOnly);
  return (
    <MenuItem
      icon={readOnly ? <MdVisibilityOff size="16px" /> : <MdVisibility size="16px" />}
      onClick={() => presets.apply(readOnly ? 'default' : 'readonly')}
      py="1px"
      m="0"
    >
      {readOnly ? 'Turn Off Read-only' : 'Make Read-only'}
    </MenuItem>
  );
}

/**
 * Who can change the given apps, with the current choice checked.
 */
export function AppPermissionsMenuItems(props: { apps: App[]; onAdvanced?: () => void }) {
  const presets = usePresets(props.apps);
  if (!presets) return null;
  const mark = (on: boolean) => (on ? <MdCheck size="16px" /> : <Box width="16px" />);
  return (
    <MenuGroup title="Who can change this">
      <MenuItem icon={mark(presets.active('everyone'))} onClick={() => presets.apply('everyone')}>
        Everyone can edit
      </MenuItem>
      <MenuItem icon={mark(presets.active('default'))} onClick={() => presets.apply('default')}>
        Use the board's permissions
      </MenuItem>
      {props.onAdvanced && (
        <MenuItem icon={mark(!presets.active('everyone') && !presets.active('default') && !presets.active('readonly'))} onClick={props.onAdvanced}>
          Advanced…
        </MenuItem>
      )}
    </MenuGroup>
  );
}

// The grid's actions, each setting the own and others' permission together: an app has one creator.
const actions: { title: string; bits: number; others: number }[] = [
  { title: 'Use', bits: P.InteractWithApps, others: P.InteractWithApps },
  { title: 'Edit', bits: P.EditOwnApps | P.EditOthersApps, others: P.EditOthersApps },
  { title: 'Move', bits: P.ArrangeOwnApps | P.ArrangeOthersApps, others: P.ArrangeOthersApps },
  { title: 'Delete', bits: P.DeleteOwnApps | P.DeleteOthersApps, others: P.DeleteOthersApps },
];
const nobody: Account = { userId: '', instanceAdmin: false, createRooms: false, readOnly: false };

/**
 * Who can use, edit, move and delete one app, per role: each cell shows the result for someone with that role
 * (who did not create the app) and whether the board or this app decides it. Clicking a cell cycles
 * follow the board, allow, deny.
 */
export function AppPermissionsModal(props: { isOpen: boolean; onClose: () => void; app: App }) {
  const room = useRoom(props.app.data.roomId);
  const board = useBoardStore((state) => state.boards.find((b) => b._id === props.app.data.boardId));
  const permissions = useRoomPermissions(props.app.data.roomId);
  const save = useAppStore((state) => state.saveAppOverrides);
  const toast = useToast();
  const current = props.app.data.overrides ?? [];
  // The overrides the edit started from, and the edit (roles only). Changes made elsewhere replace the edit only while it is unchanged.
  const [base, setBase] = useState<Override[]>(current);
  const [overrides, setOverrides] = useState<Override[]>(current.filter((o) => o.kind === 'role'));
  const [edited, setEdited] = useState(false);
  const reset = () => {
    setBase(current);
    setOverrides(current.filter((o) => o.kind === 'role'));
    setEdited(false);
  };
  useEffect(() => {
    if (!edited) reset();
  }, [props.app.data.overrides]);
  if (!room || !board) return null;
  const roles = room.data.roles;
  const editable = permissions & APP_PERMISSIONS;
  const change = (next: Override[]) => {
    setOverrides(next);
    setEdited(true);
  };

  const cell = (role: Role, action: (typeof actions)[number]) => {
    const member = { roles: role.id === EVERYONE ? [] : [role.id], timeoutUntil: 0 };
    const onBoard = boardBase(room.data, board.data, member, nobody);
    const admin = onBoard === ALL;
    const result = admin ? ALL : applyAppOverrides(onBoard, { overrides }, member.roles);
    // Editing an app includes using it.
    const yes = (result & action.others) !== 0 || (action.title === 'Use' && (result & P.EditOthersApps) !== 0);
    const own = find(overrides, 'role', role.id);
    const everyone = find(overrides, 'role', EVERYONE);
    const fromApp = ((own.allow | own.deny | everyone.allow | everyone.deny) & action.bits) !== 0;
    const state = own.allow & action.bits ? 'allow' : own.deny & action.bits ? 'deny' : 'follow';
    const next = state === 'follow' ? 'allow' : state === 'allow' ? 'deny' : 'follow';
    const cycle = () =>
      change(
        setOverride(
          overrides,
          'role',
          role.id,
          next === 'allow' ? own.allow | action.bits : own.allow & ~action.bits,
          next === 'deny' ? own.deny | action.bits : own.deny & ~action.bits
        )
      );
    const source = admin ? 'administrator' : fromApp ? 'this app' : 'board';
    return (
      <Button
        key={action.title}
        size="sm"
        height="44px"
        flexDirection="column"
        variant={fromApp ? 'solid' : 'outline'}
        colorScheme={yes ? 'green' : 'red'}
        isDisabled={admin || (editable & action.bits) !== action.bits}
        onClick={cycle}
        aria-label={`${role.name}: ${action.title} ${yes ? 'allowed' : 'not allowed'}, set by ${source}. Click to change.`}
      >
        <Text fontSize="md">{yes ? '✓' : '✗'}</Text>
        <Text fontSize="2xs" fontWeight={fromApp ? 'bold' : 'normal'}>
          {source}
        </Text>
      </Button>
    );
  };

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} size="3xl" scrollBehavior="inside" blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          Who can change this {props.app.data.type}
          {props.app.data.title && (
            <Text fontSize="sm" fontWeight="normal" color="gray.500">
              {props.app.data.title}
            </Text>
          )}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody pb="6">
          <Text fontSize="sm" color="gray.500" mb="3">
            What someone with each role can do with this app, if they did not create it. "board" means the board decides; click a cell to
            allow or deny it for this app only. Nobody loses sight of the app. Owners and Administrators are never restricted.
          </Text>
          <HStack mb="3" wrap="wrap">
            <Button size="xs" leftIcon={<MdVisibility />} onClick={() => change(appPreset('readonly', roles))}>
              Read-only (only staff can use or change it)
            </Button>
            <Button size="xs" onClick={() => change(appPreset('everyone', roles))}>
              Everyone can edit
            </Button>
            <Button size="xs" onClick={() => change([])}>
              Use the board's permissions
            </Button>
          </HStack>
          <Grid templateColumns="minmax(120px, 1fr) repeat(4, 90px)" gap="2" alignItems="center">
            <Box />
            {actions.map((a) => (
              <Text key={a.title} fontSize="sm" fontWeight="bold" textAlign="center">
                {a.title}
              </Text>
            ))}
            {roles.map((role) => [
              <Text key={role.id} fontSize="sm">
                {role.name}
              </Text>,
              ...actions.map((a) => cell(role, a)),
            ])}
          </Grid>
          <HStack mt="4">
            <Button
              colorScheme="green"
              size="sm"
              isDisabled={!edited && JSON.stringify(overrides) === JSON.stringify(base)}
              onClick={async () => {
                const next = overrides.filter((o) => o.allow || o.deny);
                const error = await save(props.app._id, next, base);
                if (error) {
                  toast({ title: error, status: 'error', duration: 3000, isClosable: true });
                  return;
                }
                setBase(next);
                setOverrides(next);
                setEdited(false);
                toast({ title: 'Permissions saved', status: 'success', duration: 2000 });
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              Discard Changes
            </Button>
          </HStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
