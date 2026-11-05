/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useEffect, useState, useRef } from 'react';
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  InputGroup,
  InputLeftElement,
  Input,
  useToast,
  Button,
  Checkbox,
  Select,
  Text,
  Box,
  Alert,
  AlertIcon,
  FormControl,
  FormLabel,
} from '@chakra-ui/react';

import { MdPerson } from 'react-icons/md';

import { Room, RoomSchema } from '@sage3/shared/types';
import { isAlphanumericWithSpacesAndForeign, randomSAGEColor, RoomTemplate, roomTemplates, SAGEColors } from '@sage3/shared';

import { useAccount } from '../../../hooks';
import { useRoomStore } from '../../../stores';
import { ColorPicker } from '../general';

interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const NAME_MAX = 50;
const DESC_MAX = 150;

// Rooms start without a template: the open room, where everyone collaborates.
const noTemplate = roomTemplates.find((t) => t.id === 'open')!;

export function CreateRoomModal(props: CreateRoomModalProps): JSX.Element {

  const toast = useToast();

  const account = useAccount();
  const rooms = useRoomStore((state) => state.rooms);

  const [name, setName] = useState<RoomSchema['name']>('');
  const [description, setDescription] = useState<RoomSchema['description']>('');
  const [isListed, setIsListed] = useState(false); // default is not listed
  const [templates, setTemplates] = useState<RoomTemplate[]>(roomTemplates);
  const [templateId, setTemplateId] = useState(noTemplate.id);
  const template = templates.find((t) => t.id === templateId) ?? noTemplate;
  const [isProtected, setProtected] = useState(template.isPrivate);
  const [color, setColor] = useState('red' as SAGEColors);
  const [groups, setGroups] = useState(String(template.groups));
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value);
  const handleDescription = (event: React.ChangeEvent<HTMLInputElement>) => setDescription(event.target.value);
  const handleColorChange = (c: string) => setColor(c as SAGEColors);

  useEffect(() => {
    if (!props.isOpen) return;
    let active = true;
    setName('');
    setDescription('');
    setColor(randomSAGEColor());
    setIsListed(false);
    setTemplates(roomTemplates);
    setTemplateId(noTemplate.id);
    setProtected(noTemplate.isPrivate);
    setGroups(String(noTemplate.groups));
    setError('');
    setTemplateError('');
    setLoadingTemplates(true);
    fetch('/api/rooms/templates', { credentials: 'include' })
      .then((response) => response.json())
      .then((response: { success: boolean; message?: string; data?: RoomTemplate[] }) => {
        if (!active) return;
        if (response.success && response.data) {
          setTemplates(response.data.filter((t) => !t.ownerId || t.published || t.ownerId === account.userId));
        } else setTemplateError(response.message || 'Could not load saved templates. Built-in templates are still available.');
      })
      .catch(() => { if (active) setTemplateError('Could not load saved templates. Built-in templates are still available.'); })
      .finally(() => { if (active) setLoadingTemplates(false); });
    return () => { active = false; };
  }, [props.isOpen, account.userId]);

  // the input element
  // When the modal panel opens, select the text for quick replacing
  const initialRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void create();
    }
  };

  const create = async () => {
    if (submitting.current || loadingTemplates || !account.createRooms) return;
    const cleanedName = name.trim().substring(0, NAME_MAX);
    if (!cleanedName) {
      setError('Name must have at least one character.');
      return;
    }
    if (rooms.some((room) => room.data.name === cleanedName)) {
      setError('Room name already exists.');
      return;
    }
    if (!isAlphanumericWithSpacesAndForeign(cleanedName)) {
      setError('Name must only contain Unicode letters, numbers, comma, hyphen, underscore and spaces.');
      return;
    }
    if (template.id === 'group-work' && (!Number.isSafeInteger(Number(groups)) || Number(groups) < 1)) {
      setError('Enter a positive whole number of groups.');
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      const result = await fetch('/api/rooms/from-template', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          name: cleanedName,
          description,
          color,
          isPrivate: isProtected,
          isListed,
          ...(template.id === 'group-work' ? { groups: Number(groups) } : {}),
        }),
      });
      const response: { success: boolean; message?: string; data?: { room: Room; inviteCode?: string } } = await result.json();
      if (!response.success || !response.data) {
        setError(response.message || 'Could not create the room.');
        return;
      }
      const { inviteCode } = response.data;
      toast({
        title: 'Room created successfully',
        description: inviteCode ? `Invite code: ${inviteCode}` : undefined,
        status: 'success',
        duration: inviteCode ? 15 * 1000 : 2 * 1000,
        isClosable: true,
      });
      props.onClose();
    } catch {
      setError('Could not create the room.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  // To enable/disable
  const checkListed = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsListed(e.target.checked);
  };
  const checkProtected = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProtected(e.target.checked);
  };
  const handleTemplate = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = templates.find((t) => t.id === e.target.value);
    if (!selected) return;
    setTemplateId(selected.id);
    setProtected(selected.isPrivate);
    setGroups(String(selected.groups));
    setError('');
  };

  return (
    <Modal isCentered isOpen={props.isOpen} onClose={pending ? () => undefined : props.onClose} blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader fontSize="3xl">Create Room</ModalHeader>
        <ModalBody>
          {error && <Alert status="error" mb="4"><AlertIcon />{error}</Alert>}
          <Box mb="4">
            <InputGroup>
              <InputLeftElement pointerEvents="none" children={<MdPerson size={'24px'} />} />
              <Input
                ref={initialRef}
                type="text"
                aria-label="Room name"
                isDisabled={pending}
                placeholder={'Room Name'}
                _placeholder={{ opacity: 1, color: 'gray.400' }}
                mr={0}
                value={name}
                onChange={handleNameChange}
                onKeyDown={onSubmit}
                isRequired={true}
                maxLength={NAME_MAX}
              />
            </InputGroup>
            <Text fontSize="xs" textAlign="right" mt="1" color={name.length >= NAME_MAX ? 'red.400' : name.length >= NAME_MAX * 0.8 ? 'orange.400' : 'gray.400'}>
              {name.length} / {NAME_MAX}
            </Text>
          </Box>
          <Box my="4">
            <InputGroup>
              <InputLeftElement pointerEvents="none" children={<MdPerson size={'24px'} />} />
              <Input
                type="text"
                aria-label="Room description"
                isDisabled={pending}
                placeholder={'Room Description (optional)'}
                _placeholder={{ opacity: 1, color: 'gray.400' }}
                mr={0}
                value={description}
                onChange={handleDescription}
                onKeyDown={onSubmit}
                isRequired={false}
                maxLength={DESC_MAX}
              />
            </InputGroup>
            <Text fontSize="xs" textAlign="right" mt="1" color={description.length >= DESC_MAX ? 'red.400' : description.length >= DESC_MAX * 0.8 ? 'orange.400' : 'gray.400'}>
              {description.length} / {DESC_MAX}
            </Text>
          </Box>

          <ColorPicker selectedColor={color} onChange={handleColorChange}></ColorPicker>

          <Checkbox mt={4} mr={4} onChange={checkListed} isChecked={isListed} isDisabled={pending}>
            Room Listed Publicly
          </Checkbox>
          <Checkbox mt={4} mr={4} onChange={checkProtected} isChecked={isProtected} isDisabled={pending}>
            Joining Needs an Invite
          </Checkbox>
          <FormControl mt={4} isDisabled={pending || loadingTemplates}>
            <FormLabel>Room template</FormLabel>
            <Select value={templateId} onChange={handleTemplate}>
              <option value="open">No template</option>
              {templates
                .filter((t) => t.id !== 'open')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.ownerId ? ` — ${t.published ? 'Published' : 'Private'}` : ''}
                  </option>
                ))}
            </Select>
          </FormControl>
          {loadingTemplates && <Text fontSize="sm">Loading templates…</Text>}
          {templateError && <Alert status="warning" mt="2"><AlertIcon />{templateError}</Alert>}
          <Text fontSize="sm" mt="1" color="gray.500">
            {template.description}
            {template.id !== 'open' && ' Creates an independent copy; later template changes will not affect this room.'}
          </Text>
          <Text fontSize="sm" mt="2">
            Default invite roles: {template.joinRoles.map((id) => template.roles.find((role) => role.id === id)?.name ?? id).join(', ') || '@everyone only'}.
            {template.boards?.length ? ` Includes ${template.boards.length} empty boards.` : ''}
          </Text>
          {template.id === 'group-work' && (
            <FormControl mt="3" isDisabled={pending}>
              <FormLabel>Number of groups</FormLabel>
              <Input type="number" min={1} step={1} value={groups} onChange={(e) => setGroups(e.target.value)} onKeyDown={onSubmit} />
            </FormControl>
          )}
        </ModalBody>
        <ModalFooter>
          <Button colorScheme="green" onClick={() => create()} isLoading={pending} loadingText="Creating" isDisabled={!name.trim() || loadingTemplates || !account.createRooms}>
            Create
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
