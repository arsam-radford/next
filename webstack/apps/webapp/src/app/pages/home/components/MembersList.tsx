/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useState } from 'react';
import {
  useColorModeValue,
  IconButton,
  Box,
  Tooltip,
  useDisclosure,
  useToast,
  Input,
  InputGroup,
  InputLeftElement,
  VStack,
  Icon,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  Badge,
  HStack,
  Menu,
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuItem,
  MenuList,
  Select,
  TagCloseButton,
  TagLabel,
} from '@chakra-ui/react';

import { MdAdd, MdMoreHoriz, MdPerson, MdPersonAdd, MdPersonOff, MdSearch } from 'react-icons/md';

import { fuzzySearch, has, Permission, rankOfMember } from '@sage3/shared';
import { Room, RoomMembers, User } from '@sage3/shared/types';
import {
  ConfirmModal,
  InvitesPanel,
  RoleTag,
  roleColor,
  useHexColor,
  usePresenceStore,
  useRank,
  useRoomPermissions,
  useRoomStore,
  useUser,
  useUsersStore,
} from '@sage3/frontend';

type Sort = 'role' | 'name' | 'online' | 'joined';

export function MembersList(props: { room: Room }) {
  const [showOnline, setShowOnline] = useState(false);
  const [sort, setSort] = useState<Sort>('role');
  const [roleFilter, setRoleFilter] = useState('');

  const members = useRoomStore((state) => state.members).filter((m) => m.data.roomId === props.room._id);
  const users = useUsersStore((state) => state.users);
  const permissions = useRoomPermissions(props.room._id);
  const canInvite = has(permissions, Permission.ManageMembers);
  const [membersSearch, setMembersSearch] = useState<string>('');
  const invites = useDisclosure();
  const partialPrescences = usePresenceStore((state) => state.partialPrescences);
  // Style Scrollbar
  const scrollBarValue = useColorModeValue('gray.300', '#666666');
  const scrollBarColor = useHexColor(scrollBarValue);
  const searchPlaceholderColorValue = useColorModeValue('gray.400', 'gray.100');
  const searchPlaceholderColor = useHexColor(searchPlaceholderColorValue); const searchBarColorValue = useColorModeValue('gray.100', '#2c2c2c');
  const searchBarColor = useHexColor(searchBarColorValue);

  const isOnline = (userId: string) => partialPrescences.some((p) => p._id === userId);
  const rankOf = (m: RoomMembers) => rankOfMember(props.room.data, m.data.userId, m.data);
  const rows = members
    .map((member) => ({ member, user: users.find((u) => u._id === member.data.userId) }))
    .filter((r): r is { member: RoomMembers; user: User } => !!r.user)
    .filter((r) => !showOnline || isOnline(r.user._id))
    .filter((r) => !roleFilter || r.member.data.roles.includes(roleFilter))
    .filter((r) => fuzzySearch(r.user.data.name + ' ' + r.user.data.email, membersSearch));
  const byName = (a: { user: User }, b: { user: User }) => a.user.data.name.localeCompare(b.user.data.name);
  const compare: Record<Sort, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
    role: (a, b) => rankOf(b.member) - rankOf(a.member) || byName(a, b),
    name: byName,
    online: (a, b) => Number(isOnline(b.user._id)) - Number(isOnline(a.user._id)) || byName(a, b),
    joined: (a, b) => b.member._createdAt - a.member._createdAt,
  };
  rows.sort(compare[sort]);

  return (
    <Box display="flex" gap="8">
      <Box width="600px">
        <Box display="flex" justifyContent="start" alignItems="center" width="100%" gap="2" mb="3" px="2">
          {/* Search Input */}
          <InputGroup size="md" width="100%" my="1">
            <InputLeftElement pointerEvents="none">
              <MdSearch />
            </InputLeftElement>
            <Input placeholder="Search Members" value={membersSearch} roundedTop="2xl"
              _focusVisible={{ bg: searchBarColor, outline: 'none', transition: 'none' }}
              bg="inherit"
              roundedBottom="2xl" onChange={(e) => setMembersSearch(e.target.value)} _placeholder={{ opacity: 0.7, color: searchPlaceholderColor }} />
          </InputGroup>
          {/* Filter Yours */}
          <Tooltip label="Filter Online" aria-label="filter online users" placement="top" hasArrow>
            <IconButton
              size="sm"
              bg="none"
              aria-label="filter-yours"
              fontSize="xl"
              icon={showOnline ? <MdPerson fontSize="24px" /> : <MdPersonOff fontSize="24px" />}
              _hover={{ transform: 'scale(1.1)', bg: 'none' }}
              onClick={() => setShowOnline(!showOnline)}
            ></IconButton>
          </Tooltip>
          {canInvite && (
            <Button size="sm" leftIcon={<MdPersonAdd />} flexShrink={0} onClick={invites.onOpen}>
              Invite
            </Button>
          )}
        </Box>
        <HStack px="2" mb="3">
          <Select size="sm" aria-label="Sort members" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="role">Sort by role</option>
            <option value="name">Sort by name</option>
            <option value="online">Online first</option>
            <option value="joined">Recently joined</option>
          </Select>
          <Select size="sm" aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {props.room.data.roles.slice(1).map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </HStack>
        <Modal isOpen={invites.isOpen} onClose={invites.onClose} size="2xl" blockScrollOnMount={false}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Invite to {props.room.data.name}</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb="6">
              <InvitesPanel room={props.room} />
            </ModalBody>
          </ModalContent>
        </Modal>

        <VStack
          height="calc(100svh - 315px)"
          width="100%"
          gap="2"
          overflowY="auto"
          overflowX="hidden"
          px="2"
          userSelect={'none'}
          css={{
            '&::-webkit-scrollbar': {
              background: 'transparent',
              width: '5px',
            },
            '&::-webkit-scrollbar-thumb': {
              background: scrollBarColor,
              borderRadius: '48px',
            },
          }}
        >
          {rows.map((r) => (
            <MembersListItem key={r.user._id} user={r.user} member={r.member} room={props.room} online={isOnline(r.user._id)} />
          ))}
        </VStack>
      </Box>
      <Box flex="1"></Box>
    </Box>
  );
}

/**
 * One member: name in their highest role's color, their roles as tags, and what you may do to them in a menu.
 * Changing someone needs the matching permission, and only works on members below you in the role order.
 */
function MembersListItem(props: { user: User; member: RoomMembers; room: Room; online: boolean }) {
  const { user: me } = useUser();
  const permissions = useRoomPermissions(props.room._id);
  const myRank = useRank(props.room._id);
  const moderate = useRoomStore((state) => state.moderate);
  const toast = useToast();
  const roles = props.room.data.roles;
  const roomId = props.room._id;
  const userId = props.user._id;
  const rank = rankOfMember(props.room.data, userId, props.member.data);
  const below = rank < myRank;
  const owner = userId === props.room.data.ownerId;
  const highest = !owner && rank > 0 ? roles[rank] : undefined;
  const timedOut = props.member.data.timeoutUntil > Date.now();
  // Roles below yours, given to yourself or to members below you.
  const canSetRole = (index: number) => has(permissions, Permission.ManageRoles) && index < myRank && (below || userId === me?._id);
  const canModerate = has(permissions, Permission.ModerateMembers) && below;
  const canManage = has(permissions, Permission.ManageMembers) && below;

  const backgroundColorValue = useColorModeValue('#ffffff', `gray.800`);
  const backgroundColor = useHexColor(backgroundColorValue);
  const baseBorderColorValue = useColorModeValue('gray.200', 'gray.700');
  const baseBorderColor = useHexColor(baseBorderColorValue);
  const online = useHexColor(props.user.data.color);
  const offline = useHexColor('gray.700');
  const subTextValue = useColorModeValue('gray.700', 'gray.300');
  const subText = useHexColor(subTextValue);
  const color = props.online ? online : offline;

  const removeConfirm = useDisclosure();
  const banConfirm = useDisclosure();

  const report = (error: string | undefined, success: string) =>
    toast({ title: error ?? success, status: error ? 'error' : 'success', duration: 3000, isClosable: true });
  const setRoles = async (next: string[]) => report(await moderate('roles', { roomId, userId, roles: next }), 'Roles updated');
  const timeout = async (minutes: number) =>
    report(await moderate('timeout', { roomId, userId, until: minutes ? Date.now() + minutes * 60_000 : 0 }), minutes ? 'Timed out' : 'Timeout ended');
  const addable = roles.map((role, i) => ({ role, i })).filter(({ role, i }) => i > 0 && !props.member.data.roles.includes(role.id) && canSetRole(i));

  return (
    <>
      <ConfirmModal
        isOpen={removeConfirm.isOpen}
        onClose={removeConfirm.onClose}
        onConfirm={async () => report(await moderate('remove', { roomId, userId }), 'Member removed')}
        title="Remove Member"
        message={`Remove ${props.user.data.name} from ${props.room.data.name}? They can join again with an invite.`}
        cancelText="Cancel"
        confirmText="Remove"
        confirmColor="red"
      />
      <ConfirmModal
        isOpen={banConfirm.isOpen}
        onClose={banConfirm.onClose}
        onConfirm={async () => report(await moderate('ban', { roomId, userId }), 'Member banned')}
        title="Ban Member"
        message={`Ban ${props.user.data.name}? They are removed and cannot join again until unbanned.`}
        cancelText="Cancel"
        confirmText="Ban"
        confirmColor="red"
      />
      <Box
        background={backgroundColor}
        p="2"
        display="flex"
        justifyContent={'space-between'}
        alignItems={'center'}
        borderRadius="md"
        boxSizing="border-box"
        width="100%"
        minHeight="46px"
        border={`solid 1px ${props.online ? color : baseBorderColor}`}
        transition={'all 0.2s ease-in-out'}
      >
        <Box display="flex" alignItems={'center'} minWidth="0">
          <Box display="flex" alignItems={'center'} ml={0} mr={2}>
            <Icon as={MdPerson} fontSize="2xl" color={color} />
          </Box>
          <Box display="flex" flexDir="column" minWidth="0">
            <HStack spacing="2">
              <Box overflow="hidden" textOverflow={'ellipsis'} whiteSpace={'nowrap'} fontSize="sm" fontWeight={'bold'} color={highest ? roleColor(highest.color) : undefined}>
                {props.user.data.name}
              </Box>
              {owner && <Badge>Owner</Badge>}
              {timedOut && <Badge colorScheme="red">Timed out until {new Date(props.member.data.timeoutUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Badge>}
            </HStack>
            <Box overflow="hidden" textOverflow={'ellipsis'} whiteSpace={'nowrap'} fontSize="xs" color={subText}>
              {props.user.data.email}
            </Box>
            <HStack spacing="1" mt="1" wrap="wrap">
              {roles.map((role, i) =>
                i > 0 && props.member.data.roles.includes(role.id) ? (
                  <RoleTag key={role.id} color={role.color}>
                    <TagLabel>{role.name}</TagLabel>
                    {canSetRole(i) && (
                      <TagCloseButton aria-label={`Remove ${role.name}`} onClick={() => setRoles(props.member.data.roles.filter((r) => r !== role.id))} />
                    )}
                  </RoleTag>
                ) : null
              )}
              {addable.length > 0 && (
                <Menu isLazy>
                  <MenuButton as={IconButton} size="xs" height="20px" minWidth="20px" variant="ghost" icon={<MdAdd />} aria-label="Give a role" />
                  <MenuList fontSize="sm">
                    {addable.map(({ role }) => (
                      <MenuItem key={role.id} onClick={() => setRoles([...props.member.data.roles, role.id])}>
                        <RoleTag color={role.color}>{role.name}</RoleTag>
                      </MenuItem>
                    ))}
                  </MenuList>
                </Menu>
              )}
            </HStack>
          </Box>
        </Box>

        {(canModerate || canManage) && (
          <Menu isLazy placement="bottom-end">
            <MenuButton as={IconButton} size="sm" variant="ghost" fontSize="xl" icon={<MdMoreHoriz />} aria-label={`Manage ${props.user.data.name}`} />
            <MenuList fontSize="sm">
              {canModerate && (
                <MenuGroup title="Time out">
                  <MenuItem onClick={() => timeout(10)}>10 minutes</MenuItem>
                  <MenuItem onClick={() => timeout(60)}>1 hour</MenuItem>
                  <MenuItem onClick={() => timeout(1440)}>1 day</MenuItem>
                  {timedOut && <MenuItem onClick={() => timeout(0)}>End timeout</MenuItem>}
                </MenuGroup>
              )}
              {canModerate && canManage && <MenuDivider />}
              {canManage && <MenuItem onClick={removeConfirm.onOpen}>Remove from room</MenuItem>}
              {canManage && (
                <MenuItem color="red.400" onClick={banConfirm.onOpen}>
                  Ban
                </MenuItem>
              )}
            </MenuList>
          </Menu>
        )}
      </Box>
    </>
  );
}
