/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Room settings for people who run a class: roles, groups, invites, bans and the audit log. Members are managed on the home page.

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  NumberInput,
  NumberInputField,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  useToast,
  VStack,
} from '@chakra-ui/react';
import { MdArrowDownward, MdArrowUpward, MdDelete } from 'react-icons/md';

import { EVERYONE, genId, has, Permission, Role, RoomTemplate } from '@sage3/shared';
import { Audit, Invite, Room } from '@sage3/shared/types';

import { APIHttp } from '../../../api';
import { useAccount, useRank, useRoomPermissions } from '../../../hooks';
import { useUser } from '../../../providers';
import { useRoomStore, useUsersStore } from '../../../stores';
import { assignGroups, createGroups, dissolveGroups, spinOffGroupRooms } from '../../../utils';
import { PermissionChecks } from './PermissionList';
import { RoleColorPicker } from './RoleColor';

type Props = { isOpen: boolean; onClose: () => void; room: Room };

// Whether someone has any tab of the dialog to use. Offer the dialog only then.
export function useCanOpenRoomSettings(room: Room | undefined): boolean {
  const permissions = useRoomPermissions(room?._id);
  const account = useAccount();
  if (!room) return false;
  return (
    has(permissions, Permission.ManageRoles) ||
    has(permissions, Permission.ManageMembers) ||
    has(permissions, Permission.ViewAuditLog) ||
    account.instanceAdmin ||
    account.userId === room.data.ownerId
  );
}

export function RoomSettingsModal(props: Props) {
  const permissions = useRoomPermissions(props.room._id);
  const account = useAccount();
  const canSaveTemplate = account.instanceAdmin || account.userId === props.room.data.ownerId;
  // Only the tabs this person can use, so the dialog never opens on one they cannot.
  const tabs = [
    { title: 'Roles', allowed: has(permissions, Permission.ManageRoles), panel: <RolesTab room={props.room} /> },
    { title: 'Groups', allowed: has(permissions, Permission.ManageRoles), panel: <GroupsTab room={props.room} /> },
    { title: 'Invites', allowed: has(permissions, Permission.ManageMembers), panel: <InvitesPanel room={props.room} /> },
    { title: 'Bans', allowed: has(permissions, Permission.ManageMembers), panel: <BansTab room={props.room} /> },
    { title: 'Audit Log', allowed: has(permissions, Permission.ViewAuditLog), panel: <AuditTab room={props.room} /> },
    { title: 'Templates', allowed: canSaveTemplate, panel: <TemplatesTab room={props.room} /> },
  ].filter((tab) => tab.allowed);
  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} size="4xl" scrollBehavior="inside" blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{props.room.data.name}: Roles and Members</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb="6">
          <Tabs isLazy>
            <TabList>
              {tabs.map((tab) => (
                <Tab key={tab.title}>{tab.title}</Tab>
              ))}
            </TabList>
            <TabPanels>
              {tabs.map((tab) => (
                <TabPanel key={tab.title}>{tab.panel}</TabPanel>
              ))}
            </TabPanels>
          </Tabs>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

// Show an error message, or a success message when there is none.
function useReport() {
  const toast = useToast();
  return (error: string | undefined, success: string) =>
    toast({ title: error ?? success, status: error ? 'error' : 'success', duration: 3000, isClosable: true });
}

function TemplatesTab(props: { room: Room }) {
  const account = useAccount();
  const report = useReport();
  const [name, setName] = useState(props.room.data.name);
  const [description, setDescription] = useState(props.room.data.description);
  const [includeBoards, setIncludeBoards] = useState(false);
  const [joinRoles, setJoinRoles] = useState<string[]>([]);
  const [templates, setTemplates] = useState<RoomTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const roles = props.room.data.roles.filter((role) => role.id !== EVERYONE);

  const load = async () => {
    setLoading(true);
    try {
      const result = await fetch('/api/rooms/templates', { credentials: 'include' });
      const response: { success: boolean; message?: string; data?: RoomTemplate[] } = await result.json();
      if (response.success && response.data) setTemplates(response.data);
      else setError(response.message || 'Could not load templates.');
    } catch {
      setError('Could not load templates.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const change = async (action: 'save' | 'publication' | 'delete', template?: RoomTemplate) => {
    if (submitting.current) return;
    if (action === 'save' && !name.trim()) {
      setError('Enter a template name.');
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const response = action === 'save'
        ? await APIHttp.POST<any>(`/rooms/${props.room._id}/templates`, {
            name: name.trim(),
            description,
            includeBoards,
            joinRoles: joinRoles.filter((id) => roles.some((role) => role.id === id)),
          })
        : action === 'publication' && template
          ? await APIHttp.POST<any>(`/rooms/templates/${template.id}/publication`, { published: !template.published })
          : await APIHttp.DELETE(`/rooms/templates/${template?.id}`);
      if (!response.success) {
        setError(response.message || 'Could not update the template.');
        return;
      }
      report(undefined, action === 'save' ? 'Private template saved' : action === 'delete' ? 'Template deleted' : template?.published ? 'Template is now private' : 'Template published');
      await load();
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const managed = templates.filter((template) => template.ownerId && (account.instanceAdmin || template.ownerId === account.userId));
  return (
    <VStack align="stretch" spacing="3">
      {error && <Alert status="error"><AlertIcon />{error}</Alert>}
      <Text fontWeight="bold">Save this room as a private template</Text>
      <Text fontSize="sm">
        Saves roles and room privacy, optionally with empty boards and their role overrides.
        Members, board content and member-specific overrides are never copied.
        New rooms are independent copies, not linked to the template or this room.
      </Text>
      <FormControl isRequired isDisabled={pending}>
        <FormLabel>Template name</FormLabel>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </FormControl>
      <FormControl isDisabled={pending}>
        <FormLabel>Description</FormLabel>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormControl>
      <Checkbox isChecked={includeBoards} isDisabled={pending} onChange={(e) => setIncludeBoards(e.target.checked)}>
        Include empty boards and their role overrides
      </Checkbox>
      <Box>
        <Text fontWeight="medium" mb="1">Default join roles</Text>
        <Text fontSize="sm" mb="2">Choose the roles granted by a new room's first invite. With none selected, members receive only @everyone.</Text>
        <VStack align="start">
          {roles.map((role) => (
            <Checkbox
              key={role.id}
              isChecked={joinRoles.includes(role.id)}
              isDisabled={pending}
              onChange={(e) => setJoinRoles(e.target.checked ? [...joinRoles, role.id] : joinRoles.filter((id) => id !== role.id))}
            >
              {role.name}
            </Checkbox>
          ))}
        </VStack>
      </Box>
      <Button alignSelf="start" colorScheme="green" isDisabled={!name.trim() || loading} isLoading={pending} onClick={() => change('save')}>
        Save Private Template
      </Button>
      <HStack justify="space-between" mt="3">
        <Text fontWeight="bold">{account.instanceAdmin ? 'Manage saved templates' : 'Your saved templates'}</Text>
        <Button size="sm" variant="ghost" isDisabled={pending || loading} onClick={() => { setError(''); void load(); }}>Refresh</Button>
      </HStack>
      <Text fontSize="sm">
        Private templates are available to their owner. Instance administrators can publish them for everyone.
        Unpublishing or deleting a template does not change rooms already created from it.
      </Text>
      {loading && <Text fontSize="sm">Loading templates…</Text>}
      {!loading && managed.length === 0 && <Text fontSize="sm">No saved templates.</Text>}
      {managed.map((template) => (
        <Box key={template.id} borderWidth="1px" borderRadius="md" p="3">
          <HStack justify="space-between" align="start">
            <Box>
              <Text fontWeight="bold">{template.name} <Badge colorScheme={template.published ? 'green' : 'gray'}>{template.published ? 'Published' : 'Private'}</Badge></Text>
              <Text fontSize="sm">{template.description}</Text>
              <Text fontSize="xs" color="gray.500">{template.ownerId === account.userId ? 'Your template' : `Owner: ${template.ownerId}`}</Text>
            </Box>
            <HStack>
              {account.instanceAdmin && (
                <Button size="sm" isDisabled={pending || loading} onClick={() => change('publication', template)}>
                  {template.published ? 'Unpublish' : 'Publish'}
                </Button>
              )}
              <Button size="sm" colorScheme="red" isDisabled={pending || loading} onClick={() => change('delete', template)}>Delete</Button>
            </HStack>
          </HStack>
        </Box>
      ))}
    </VStack>
  );
}

function RolesTab(props: { room: Room }) {
  const permissions = useRoomPermissions(props.room._id);
  const myRank = useRank(props.room._id);
  const report = useReport();
  const saveRoles = useRoomStore((state) => state.saveRoles);
  // The roles the edit started from. Saving fails if someone else changed them meanwhile.
  const [base, setBase] = useState<Role[]>(props.room.data.roles);
  const [roles, setRoles] = useState<Role[]>(props.room.data.roles);
  const reset = () => {
    setBase(props.room.data.roles);
    setRoles(props.room.data.roles);
  };
  // Follow changes made elsewhere, unless there are unsaved edits.
  useEffect(() => {
    if (roles === base) reset();
  }, [props.room.data.roles]);

  const editable = (index: number) => index < myRank;
  const change = (index: number, role: Role) => setRoles(roles.map((r, i) => (i === index ? role : r)));
  const move = (index: number, by: number) => {
    const next = [...roles];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setRoles(next);
  };
  const add = () => {
    const role: Role = { id: genId(), name: 'New Role', color: 'blue', permissions: 0, group: false };
    setRoles([roles[0], role, ...roles.slice(1)]);
  };
  const save = async () => {
    const error = await saveRoles(props.room._id, roles, base);
    report(error, 'Roles saved');
    if (!error) setBase(roles);
  };

  // Highest first, like the role order reads.
  const order = roles.map((_role, i) => i).reverse();
  return (
    <VStack align="stretch" spacing="3">
      <Text fontSize="sm" color="gray.500">
        Higher roles can manage lower ones. Members get every permission their roles give, on top of @everyone. You can only change roles
        below your own, and only with permissions you have.
      </Text>
      {order.map((i) => {
        const role = roles[i];
        const canEdit = editable(i);
        return (
          <Box key={role.id} borderWidth="1px" borderRadius="md" p="3" opacity={canEdit ? 1 : 0.6}>
            <HStack>
              <Input size="sm" value={role.name} isDisabled={!canEdit || role.id === EVERYONE} onChange={(e) => change(i, { ...role, name: e.target.value })} />
              <RoleColorPicker value={role.color} isDisabled={!canEdit} onChange={(color) => change(i, { ...role, color })} />
              <Checkbox size="sm" isChecked={role.group} isDisabled={!canEdit || role.id === EVERYONE} onChange={(e) => change(i, { ...role, group: e.target.checked })}>
                Group
              </Checkbox>
              <IconButton aria-label="Move up" size="sm" icon={<MdArrowUpward />} isDisabled={!canEdit || i === 0 || !editable(i + 1)} onClick={() => move(i, 1)} />
              <IconButton aria-label="Move down" size="sm" icon={<MdArrowDownward />} isDisabled={!canEdit || i <= 1} onClick={() => move(i, -1)} />
              <IconButton
                aria-label="Delete role"
                size="sm"
                colorScheme="red"
                icon={<MdDelete />}
                isDisabled={!canEdit || i === 0}
                onClick={() => setRoles(roles.filter((_r, j) => j !== i))}
              />
            </HStack>
            <PermissionChecks
              value={role.permissions}
              editable={canEdit ? permissions : 0}
              inherited={i === 0 ? 0 : roles[0].permissions}
              onChange={(value) => change(i, { ...role, permissions: value })}
            />
          </Box>
        );
      })}
      <HStack>
        <Button size="sm" onClick={add} isDisabled={myRank < 1}>
          Add Role
        </Button>
        <Button size="sm" colorScheme="green" onClick={save}>
          Save Roles
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Discard Changes
        </Button>
      </HStack>
    </VStack>
  );
}

function GroupsTab(props: { room: Room }) {
  const { user } = useUser();
  const members = useRoomStore((state) => state.members);
  const report = useReport();
  const [count, setCount] = useState(4);
  const [withBoards, setWithBoards] = useState(true);
  const [busy, setBusy] = useState(false);
  const groups = props.room.data.roles.filter((role) => role.group);
  const run = async (work: () => Promise<string | undefined>, success: string) => {
    setBusy(true);
    report(await work(), success);
    setBusy(false);
  };

  return (
    <VStack align="stretch" spacing="3">
      <Text fontSize="sm" color="gray.500">
        A group is a role marked as a group. A group board is only visible to its group and to staff.
      </Text>
      {groups.map((group) => (
        <HStack key={group.id} justify="space-between" borderWidth="1px" borderRadius="md" p="2">
          <Text fontWeight="bold">{group.name}</Text>
          <Text fontSize="sm">
            {members.filter((m) => m.data.roomId === props.room._id && m.data.roles.includes(group.id)).length} members
          </Text>
        </HStack>
      ))}
      <HStack>
        <NumberInput size="sm" width="80px" min={1} max={50} value={count} onChange={(_s, n) => setCount(n || 1)}>
          <NumberInputField />
        </NumberInput>
        <Checkbox isChecked={withBoards} onChange={(e) => setWithBoards(e.target.checked)}>
          With a board each
        </Checkbox>
        <Button size="sm" isLoading={busy} onClick={() => run(() => createGroups(props.room, count, withBoards, user?._id ?? ''), 'Groups created')}>
          Create Groups
        </Button>
      </HStack>
      <HStack>
        <Button size="sm" isLoading={busy} isDisabled={!groups.length} onClick={() => run(() => assignGroups(props.room, members), 'Students assigned')}>
          Assign Students Randomly
        </Button>
        <Button
          size="sm"
          isLoading={busy}
          isDisabled={!groups.length}
          onClick={() => run(() => spinOffGroupRooms(props.room, members, ''), 'A room was created for each group')}
        >
          Spin Off Group Rooms
        </Button>
        <Button size="sm" colorScheme="red" isLoading={busy} isDisabled={!groups.length} onClick={() => run(() => dissolveGroups(props.room), 'Groups dissolved')}>
          Dissolve Groups
        </Button>
      </HStack>
    </VStack>
  );
}

// Also opened from the Members list on the home page.
export function InvitesPanel(props: { room: Room }) {
  const myRank = useRank(props.room._id);
  const fetchInvites = useRoomStore((state) => state.fetchInvites);
  const createInvite = useRoomStore((state) => state.createInvite);
  const revokeInvite = useRoomStore((state) => state.revokeInvite);
  const report = useReport();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [roles, setRoles] = useState<string[]>(props.room.data.roles.some((r) => r.id === 'student') ? ['student'] : []);
  const [maxUses, setMaxUses] = useState(0);
  const [hours, setHours] = useState(0);
  const refresh = () => fetchInvites(props.room._id).then(setInvites);
  useEffect(() => {
    refresh();
  }, [props.room._id]);

  const create = async () => {
    const result = await createInvite(props.room._id, roles, { maxUses, expiresAt: hours ? Date.now() + hours * 3600_000 : 0 });
    report(typeof result === 'string' ? result : undefined, typeof result === 'string' ? '' : `Invite code: ${result.data.code}`);
    refresh();
  };
  const roleName = (id: string) => props.room.data.roles.find((r) => r.id === id)?.name ?? id;

  return (
    <VStack align="stretch" spacing="3">
      {invites.map((invite) => (
        <HStack key={invite._id} justify="space-between" borderWidth="1px" borderRadius="md" p="2">
          <Box>
            <Text fontFamily="mono" fontWeight="bold">
              {invite.data.code}
            </Text>
            <Text fontSize="xs" color="gray.500">
              {invite.data.roles.map(roleName).join(', ') || 'No roles'} · used {invite.data.uses}
              {invite.data.maxUses ? ` of ${invite.data.maxUses}` : ''} times
              {invite.data.expiresAt ? ` · expires ${new Date(invite.data.expiresAt).toLocaleString()}` : ''}
            </Text>
          </Box>
          <HStack>
            <Button size="xs" onClick={() => navigator.clipboard.writeText(invite.data.code)}>
              Copy
            </Button>
            <Button
              size="xs"
              colorScheme="red"
              onClick={async () => {
                report(await revokeInvite(invite._id), 'Invite revoked');
                refresh();
              }}
            >
              Revoke
            </Button>
          </HStack>
        </HStack>
      ))}
      <Text fontWeight="bold">New Invite</Text>
      <HStack wrap="wrap">
        {props.room.data.roles.slice(1).map((role, i) => (
          <Checkbox
            key={role.id}
            size="sm"
            isDisabled={i + 1 >= myRank}
            isChecked={roles.includes(role.id)}
            onChange={(e) => setRoles(e.target.checked ? [...roles, role.id] : roles.filter((r) => r !== role.id))}
          >
            {role.name}
          </Checkbox>
        ))}
      </HStack>
      <HStack>
        <Text fontSize="sm">Uses (0 = unlimited)</Text>
        <NumberInput size="sm" width="80px" min={0} value={maxUses} onChange={(_s, n) => setMaxUses(n || 0)}>
          <NumberInputField />
        </NumberInput>
        <Text fontSize="sm">Expires in hours (0 = never)</Text>
        <NumberInput size="sm" width="80px" min={0} value={hours} onChange={(_s, n) => setHours(n || 0)}>
          <NumberInputField />
        </NumberInput>
        <Button size="sm" colorScheme="green" onClick={create}>
          Create Invite
        </Button>
      </HStack>
    </VStack>
  );
}

function BansTab(props: { room: Room }) {
  const users = useUsersStore((state) => state.users);
  const moderate = useRoomStore((state) => state.moderate);
  const report = useReport();
  if (props.room.data.bans.length === 0) return <Text color="gray.500">Nobody is banned.</Text>;
  return (
    <VStack align="stretch" spacing="2">
      {props.room.data.bans.map((userId) => (
        <HStack key={userId} justify="space-between" borderWidth="1px" borderRadius="md" p="2">
          <Text>{users.find((u) => u._id === userId)?.data.name ?? userId}</Text>
          <Button size="xs" onClick={async () => report(await moderate('unban', { roomId: props.room._id, userId }), 'Unbanned')}>
            Unban
          </Button>
        </HStack>
      ))}
    </VStack>
  );
}

function AuditTab(props: { room: Room }) {
  const users = useUsersStore((state) => state.users);
  const fetchAudit = useRoomStore((state) => state.fetchAudit);
  const [entries, setEntries] = useState<Audit[]>([]);
  useEffect(() => {
    fetchAudit(props.room._id).then(setEntries);
  }, [props.room._id]);
  const name = (id: string) => users.find((u) => u._id === id)?.data.name ?? id;

  return (
    <VStack align="stretch" spacing="1">
      {entries.length === 0 && <Text color="gray.500">Nothing recorded yet.</Text>}
      {entries.map((entry) => (
        <HStack key={entry._id} fontSize="sm" align="start">
          <Text color="gray.500" minWidth="150px">
            {new Date(entry._createdAt).toLocaleString()}
          </Text>
          <Text>
            <b>{name(entry._createdBy)}</b> {entry.data.asInstanceAdmin && <Badge colorScheme="purple">Instance admin</Badge>} {entry.data.summary}
            {entry.data.action.startsWith('member.') && ` (${name(entry.data.target)})`}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}
