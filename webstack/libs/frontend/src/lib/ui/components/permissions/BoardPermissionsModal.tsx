/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// A board's overrides, and the one-click moderation actions, which are overrides too.

import { useEffect, useState } from 'react';
import {
  Button,
  Divider,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
  useToast,
  VStack,
  Wrap,
} from '@chakra-ui/react';
import { MdDelete } from 'react-icons/md';

import { BOARD_PERMISSIONS, EVERYONE, has, Override, Permission, APP_PERMISSIONS } from '@sage3/shared';
import { Board } from '@sage3/shared/types';

import { useRoom, useRoomPermissions } from '../../../hooks';
import { useAppStore, useBoardStore } from '../../../stores';
import { find, OverridesList, setOverride } from './PermissionList';

const P = Permission;

// Locking a board stops changing apps, but still lets people use them (vote, interact with plugins).
const LOCK = P.CreateApps | (APP_PERMISSIONS & ~P.InteractWithApps);

export function BoardPermissionsModal(props: { isOpen: boolean; onClose: () => void; board: Board }) {
  const room = useRoom(props.board.data.roomId);
  const permissions = useRoomPermissions(props.board.data.roomId);
  const boards = useBoardStore((state) => state.boards);
  const currentBoard = boards.find((board) => board._id === props.board._id) ?? props.board;
  const apps = useAppStore((state) => state.apps);
  const updateApps = useAppStore((state) => state.updateBatch);
  const toast = useToast();
  // The overrides the edit started from, and the edit. Changes made elsewhere replace the edit only while it is unchanged.
  const [base, setBase] = useState<Override[]>(currentBoard.data.overrides);
  const [overrides, setOverrides] = useState<Override[]>(currentBoard.data.overrides);
  const [presetName, setPresetName] = useState('');
  const [pending, setPending] = useState('');
  const [presetError, setPresetError] = useState('');
  const savePreset = useBoardStore((state) => state.savePermissionPreset);
  const applyPreset = useBoardStore((state) => state.applyPermissionPreset);
  const deletePreset = useBoardStore((state) => state.deletePermissionPreset);
  const reset = () => {
    setBase(currentBoard.data.overrides);
    setOverrides(currentBoard.data.overrides);
  };
  useEffect(() => {
    if (overrides === base) reset();
  }, [currentBoard.data.overrides]);
  useEffect(() => {
    reset();
    setPresetName('');
    setPresetError('');
  }, [props.board._id]);

  const changePreset = async (action: string, request: () => Promise<string | undefined>, onSuccess: () => void) => {
    setPending(action);
    setPresetError('');
    try {
      const error = await request();
      if (error) setPresetError(error);
      else onSuccess();
    } catch {
      setPresetError('Could not update the preset. Reload the board before trying again.');
    } finally {
      setPending('');
    }
  };

  // The bound the server applies: the board permissions of the room's roles.
  const editable = permissions & BOARD_PERMISSIONS;

  const saveOverrides = useBoardStore((state) => state.saveOverrides);
  // Saving fails, rather than overwriting, if someone else changed the board's permissions meanwhile.
  const save = async (board: Board, next: Override[], before = board.data.overrides) => {
    const error = await saveOverrides(board._id, next, before);
    if (error) toast({ title: error, status: 'error', duration: 3000, isClosable: true });
    return !error;
  };

  // Quick actions toggle bits in the @everyone override.
  const everyone = find(overrides, 'role', EVERYONE);
  const toggleEveryone = (bits: number, on: boolean) =>
    setOverrides(setOverride(overrides, 'role', EVERYONE, everyone.allow & ~bits, on ? everyone.deny | bits : everyone.deny & ~bits));
  const locked = (everyone.deny & (LOCK)) === (LOCK);
  const hidden = (everyone.deny & P.ViewBoard) !== 0;
  const student = room?.data.roles.find((r) => r.id === 'student');
  const studentOverride = find(overrides, 'role', 'student');
  const aiOn = (studentOverride.allow & P.UseAI) !== 0;

  const freezeAll = async (on: boolean) => {
    for (const board of boards.filter((b) => b.data.roomId === props.board.data.roomId)) {
      const e = find(board.data.overrides, 'role', EVERYONE);
      const bits = LOCK;
      if (!(await save(board, setOverride(board.data.overrides, 'role', EVERYONE, e.allow & ~bits, on ? e.deny | bits : e.deny & ~bits)))) return;
    }
    toast({ title: on ? 'All boards frozen' : 'All boards unfrozen', status: 'success', duration: 2000 });
  };
  const pinAll = () =>
    updateApps(apps.filter((app) => app.data.boardId === props.board._id && !app.data.pinned).map((app) => ({ id: app._id, updates: { pinned: true } })));


  return (
    <Modal isOpen={props.isOpen} onClose={() => { if (!pending) props.onClose(); }} size="3xl" scrollBehavior="inside" blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{props.board.data.name}: Permissions</ModalHeader>
        <ModalCloseButton isDisabled={!!pending} />
        <ModalBody pb="6">
          <fieldset disabled={!!pending} style={{ border: 0, padding: 0, minWidth: 0 }}>
          <Text fontWeight="bold" mb="2">Saved Presets</Text>
          <Text fontSize="sm" mb="3">
            Save the edits below as a named preset without applying them. Applying a preset immediately replaces this board's permissions and any unsaved edits below. Other boards are unchanged.
          </Text>
          <HStack mb="3">
            <Input aria-label="Preset name" placeholder="For example, Normal or Exam" size="sm" value={presetName} onChange={(event) => setPresetName(event.target.value)} />
            <Button
              size="sm"
              flexShrink={0}
              isDisabled={!presetName.trim() || !has(permissions, P.ManageBoards)}
              isLoading={pending === 'save'}
              onClick={() => changePreset('save', () => savePreset(currentBoard._id, presetName, overrides.filter((o) => o.allow || o.deny), base), () => {
                setPresetName('');
                toast({ title: 'Preset saved; board permissions unchanged', status: 'success', duration: 3000 });
              })}
            >
              Save Edits as Preset
            </Button>
          </HStack>
          <VStack align="stretch" spacing="2" mb="3">
            {(currentBoard.data.permissionPresets ?? []).map((preset) => (
              <HStack key={preset.id} justify="space-between">
                <Text overflowWrap="anywhere">{preset.name}</Text>
                <HStack>
                  <Button
                    size="sm"
                    aria-label={`Apply preset ${preset.name}`}
                    isDisabled={!has(permissions, P.ManageBoards)}
                    isLoading={pending === `apply:${preset.id}`}
                    onClick={() => changePreset(`apply:${preset.id}`, () => applyPreset(currentBoard._id, preset, base), () => {
                      setBase(preset.overrides);
                      setOverrides(preset.overrides);
                      toast({ title: `Applied preset ${preset.name}`, status: 'success', duration: 2000 });
                    })}
                  >
                    Apply
                  </Button>
                  <IconButton
                    size="sm"
                    aria-label={`Delete preset ${preset.name}`}
                    icon={<MdDelete />}
                    isDisabled={!has(permissions, P.ManageBoards)}
                    isLoading={pending === `delete:${preset.id}`}
                    onClick={() => changePreset(`delete:${preset.id}`, () => deletePreset(currentBoard._id, preset), () => {
                      toast({ title: `Deleted preset ${preset.name}`, status: 'success', duration: 2000 });
                    })}
                  />
                </HStack>
              </HStack>
            ))}
          </VStack>
          {presetError && <Text role="alert" color="red.500" mb="3">{presetError}</Text>}
          <Divider mb="4" />
          <Text fontWeight="bold" mb="2">
            Quick Actions
          </Text>
          <Wrap mb="2">
            <Button size="sm" onClick={() => toggleEveryone(LOCK, !locked)}>
              {locked ? 'Unlock Board' : 'Lock Board'}
            </Button>
            <Button size="sm" onClick={() => toggleEveryone(P.ViewBoard, !hidden)}>
              {hidden ? 'Show Board' : 'Hide Board'}
            </Button>
            {student && (
              <Button
                size="sm"
                isDisabled={!has(editable, P.UseAI)}
                onClick={() => setOverrides(setOverride(overrides, 'role', 'student', aiOn ? studentOverride.allow & ~P.UseAI : studentOverride.allow | P.UseAI, studentOverride.deny & ~P.UseAI))}
              >
                {aiOn ? 'Turn AI Off for Students' : 'Turn AI On for Students'}
              </Button>
            )}
            <Button size="sm" onClick={pinAll}>
              Pin All Apps
            </Button>
            <Button size="sm" onClick={() => freezeAll(true)}>
              Freeze All Boards
            </Button>
            <Button size="sm" onClick={() => freezeAll(false)}>
              Unfreeze All Boards
            </Button>
          </Wrap>
          <Text fontSize="xs" color="gray.500" mb="4">
            Lock, hide and AI apply when you save. Freezing and pinning apply right away. Owners and Administrators are never restricted.
          </Text>
          <Divider mb="4" />

          <VStack align="stretch" spacing="4">
            <OverridesList roomId={props.board.data.roomId} overrides={overrides} onChange={setOverrides} editable={editable} />
            <HStack>
              <Button
                colorScheme="green"
                size="sm"
                onClick={async () => {
                  const next = overrides.filter((o) => o.allow || o.deny);
                  if (await save(currentBoard, next, base)) {
                    setBase(next);
                    setOverrides(next);
                    toast({ title: 'Permissions saved', status: 'success', duration: 2000 });
                  }
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                Discard Changes
              </Button>
            </HStack>
          </VStack>
          </fieldset>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
