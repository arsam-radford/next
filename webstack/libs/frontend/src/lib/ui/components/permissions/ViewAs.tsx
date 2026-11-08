/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// "View as": see a room as some roles, or as a member, would. Only in this browser, and read-only.

import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Portal,
  Select,
  Text,
  Tooltip,
  useDisclosure,
  VStack,
} from '@chakra-ui/react';
import { MdVisibility } from 'react-icons/md';

import { has, Permission } from '@sage3/shared';
import { memberId } from '@sage3/shared/types';

import { useBoardPermissions, useRoom, useRoomPermissions } from '../../../hooks';
import { useRoomStore, useUsersStore, useViewAsStore } from '../../../stores';
import { RoleTag } from './RoleColor';

/**
 * A toolbar button that starts previewing the room as roles or a member. For people who manage roles or boards.
 */
export function ViewAsButton(props: { roomId: string }) {
  const room = useRoom(props.roomId);
  const permissions = useRoomPermissions(props.roomId);
  const members = useRoomStore((state) => state.members);
  const users = useUsersStore((state) => state.users);
  const setViewAs = useViewAsStore((state) => state.setViewAs);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [roles, setRoles] = useState<string[]>([]);
  const [userId, setUserId] = useState('');
  if (!room || !(has(permissions, Permission.ManageRoles) || has(permissions, Permission.ManageBoards))) return null;

  const start = () => {
    setViewAs({ roomId: props.roomId, roles, userId: userId || undefined });
    onClose();
  };

  return (
    <>
      <Tooltip label="View as role">
        <IconButton size="sm" icon={<MdVisibility />} fontSize="lg" aria-label="View as role" onClick={onOpen} />
      </Tooltip>
      <Modal isOpen={isOpen} onClose={onClose} blockScrollOnMount={false}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>View As</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text fontSize="sm" color="gray.500" mb="3">
              See this room as these roles would. Everyone has @everyone. Only you see the preview, and you cannot change anything until
              you exit it.
            </Text>
            <VStack align="start" spacing="1" mb="4">
              {room.data.roles.slice(1).map((role) => (
                <Checkbox
                  key={role.id}
                  isChecked={roles.includes(role.id)}
                  isDisabled={!!userId}
                  onChange={(e) => setRoles(e.target.checked ? [...roles, role.id] : roles.filter((r) => r !== role.id))}
                >
                  {role.name}
                </Checkbox>
              ))}
            </VStack>
            <Text fontSize="sm" mb="1">
              Or as a member, with their roles and personal overrides:
            </Text>
            <Select size="sm" placeholder="Choose a member" value={userId} onChange={(e) => setUserId(e.target.value)}>
              {members
                .filter((m) => m.data.roomId === props.roomId)
                .map((m) => (
                  <option key={m._id} value={m.data.userId}>
                    {users.find((u) => u._id === m.data.userId)?.data.name ?? m.data.userId}
                  </option>
                ))}
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button colorScheme="green" onClick={start}>
              Start Preview
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

/**
 * While previewing, a banner saying as whom, with the way out. On a board the previewed roles cannot see, it says so.
 */
export function ViewAsBanner() {
  const viewAs = useViewAsStore((state) => state.viewAs);
  const setViewAs = useViewAsStore((state) => state.setViewAs);
  const room = useRoom(viewAs?.roomId);
  const users = useUsersStore((state) => state.users);
  const members = useRoomStore((state) => state.members);
  const boardPermissions = useBoardPermissions();
  if (!viewAs || !room) return null;

  const member = viewAs.userId ? members.find((m) => m._id === memberId(room._id, viewAs.userId!)) : undefined;
  const roleIds = member ? member.data.roles : viewAs.roles;
  const roles = room.data.roles.filter((r) => r.id === 'everyone' || roleIds.includes(r.id));
  const who = viewAs.userId ? (users.find((u) => u._id === viewAs.userId)?.data.name ?? 'a member') : undefined;

  // A portal keeps the banner on top of the page, whichever toolbar mounts it.
  return (
    <Portal>
      <Box position="fixed" top="0" left="50%" transform="translateX(-50%)" zIndex={2000} bg="purple.600" color="white" px="4" py="2" borderBottomRadius="md" boxShadow="lg">
        <HStack spacing="2" whiteSpace="nowrap">
          <Text fontWeight="bold">Viewing {room.data.name} as{who ? ` ${who}:` : ':'}</Text>
          {roles.map((r) => (
            <RoleTag key={r.id} color={r.color}>
              {r.name}
            </RoleTag>
          ))}
          <Text fontSize="sm">Read-only preview</Text>
          <Button size="xs" colorScheme="whiteAlpha" onClick={() => setViewAs(null)}>
            Exit
          </Button>
        </HStack>
      </Box>
      {boardPermissions === 0 && window.location.hash.startsWith(`#/board/${room._id}/`) && (
        <Box position="fixed" inset="0" zIndex={1999} bg="blackAlpha.700" display="flex" alignItems="center" justifyContent="center" pointerEvents="none">
          <Text color="white" fontSize="xl" fontWeight="bold">
            These roles cannot see this board.
          </Text>
        </Box>
      )}
    </Portal>
  );
}
