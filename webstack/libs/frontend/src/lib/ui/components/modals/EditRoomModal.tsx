/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import React, { useEffect, useState } from 'react';
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
  Button,
  Box,
  Checkbox,
  useDisclosure,
  useToast,
  Text,
} from '@chakra-ui/react';

import { MdPerson } from 'react-icons/md';

import { useRoomStore, useBoardStore, useAppStore, ConfirmModal, useRouteNav } from '@sage3/frontend';
import { isAlphanumericWithSpacesAndForeign, SAGEColors } from '@sage3/shared';
import { Room, RoomSchema } from '@sage3/shared/types';
import { ColorPicker } from '../general';

interface EditRoomModalProps {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  room: Room;
}

const NAME_MAX = 50;
const DESC_MAX = 150;

export function EditRoomModal(props: EditRoomModalProps): JSX.Element {
  const { toHome } = useRouteNav();

  const [name, setName] = useState<RoomSchema['name']>(props.room.data.name);
  const [description, setDescription] = useState<RoomSchema['description']>(props.room.data.description);
  const [color, setColor] = useState(props.room.data.color as SAGEColors);

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value);
  const handleDescriptionChange = (event: React.ChangeEvent<HTMLInputElement>) => setDescription(event.target.value);
  const handleColorChange = (c: string) => setColor(c as SAGEColors);

  // Rooms
  const rooms = useRoomStore((state) => state.rooms);
  const deleteRoom = useRoomStore((state) => state.delete);
  const updateRoom = useRoomStore((state) => state.update);

  // Apps
  const fetchBoardApps = useAppStore((state) => state.fetchBoardApps);
  const deleteApp = useAppStore((state) => state.delete);

  // Boards
  const boards = useBoardStore((state) => state.boards);
  const deleteBoard = useBoardStore((state) => state.delete);

  const [isListed, setIsListed] = useState(props.room.data.isListed);
  const [isProtected, setProtected] = useState(props.room.data.isPrivate);

  // Delete Confirmation  Modal
  const { isOpen: delConfirmIsOpen, onOpen: delConfirmOnOpen, onClose: delConfirmOnClose } = useDisclosure();

  // Toast
  const toast = useToast();

  useEffect(() => {
    setName(props.room.data.name);
    setDescription(props.room.data.description);
    setColor(props.room.data.color as SAGEColors);
    setIsListed(props.room.data.isListed);
    setProtected(props.room.data.isPrivate);
  }, [props.room]);

  // When the modal panel opens, select the text for quick replacing
  const initialRef = React.useRef<HTMLInputElement>(null);

  // Keyboard handler: press enter to activate command
  const onSubmit = (e: React.KeyboardEvent) => {
    // Keyboard instead of pressing the button
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    let updated = false;
    if (name !== props.room.data.name) {
      const cleanedName = cleanNameCheckDoubles(name);
      if (cleanedName) {
        updateRoom(props.room._id, { name: cleanedName, description: description, color, isListed });
        updated = true;
      } else {
        return;
      }
    }
    if (description != props.room.data.description) {
      updateRoom(props.room._id, { description: description });
      updated = true;
    }
    if (color !== props.room.data.color) {
      updateRoom(props.room._id, { color });
      updated = true;
    }
    if (isListed !== props.room.data.isListed) {
      updateRoom(props.room._id, { isListed });
      updated = true;
    }

    if (isProtected !== props.room.data.isPrivate) {
      updateRoom(props.room._id, { isPrivate: isProtected });
      updated = true;
    }
    if (updated) {
      toast({
        title: 'Room Updated',
        description: 'Room has been updated',
        status: 'success',
        duration: 3000,
      });
      props.onClose();
    } else {
      // Just close the modal
      props.onClose();
    }
  };

  function cleanNameCheckDoubles(name: string): string | null {
    const cleanedName = name.trim().substring(0, NAME_MAX);
    const roomNames = rooms.filter((r) => r._id !== props.room._id).map((room) => room.data.name);
    if (cleanedName.split(' ').join('').length === 0) {
      toast({
        title: 'Name must have at least one character',
        status: 'error',
        duration: 2 * 1000,
        isClosable: true,
      });
      return null;
    } else if (roomNames.includes(cleanedName)) {
      toast({
        title: 'Room name already exists',
        status: 'error',
        duration: 2 * 1000,
        isClosable: true,
      });
      return null;
    } else if (!isAlphanumericWithSpacesAndForeign(cleanedName)) {
      toast({
        title: 'Name must only contain Unicode letters, numbers, comma, hyphen, underscore and spaces',
        status: 'error',
        duration: 3 * 1000,
        isClosable: true,
      });
      return null;
    }
    return cleanedName;
  }

  /**
   * Delete the room and its boards and its apps
   */
  const handleDeleteRoom = () => {
    delConfirmOnClose();
    props.onClose();
    boards.forEach((b) => {
      // Skip if this board doesn't belong to the room
      if (b.data.roomId !== props.room._id) return;
      fetchBoardApps(b._id)
        .then((apps) => {
          // delete all apps in the board
          if (apps) apps.forEach((a) => deleteApp(a._id));
        })
        .finally(() => {
          deleteBoard(b._id);
        });
    });
    // delete the room
    deleteRoom(props.room._id);
    toHome();
  };

  // To enable/disable
  const checkListed = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsListed(e.target.checked);
  };

  // Toggle whether joining needs an invite
  const checkProtected = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProtected(e.target.checked);
  };

  return (
    <Modal isCentered isOpen={props.isOpen} onClose={props.onClose} blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader fontSize="3xl">Edit Room: {props.room.data.name}</ModalHeader>
        <ModalBody>
          <Box mb={4}>
            <InputGroup>
              <InputLeftElement pointerEvents="none" children={<MdPerson size={'24px'} />} />
              <Input
                ref={initialRef}
                type="text"
                placeholder={'Room Name'}
                _placeholder={{ opacity: 1, color: 'gray.600' }}
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
          <Box my={4}>
            <InputGroup>
              <InputLeftElement pointerEvents="none" children={<MdPerson size={'24px'} />} />
              <Input
                type="text"
                placeholder={'Room Description (optional)'}
                _placeholder={{ opacity: 1, color: 'gray.600' }}
                mr={0}
                value={description}
                onChange={handleDescriptionChange}
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

          <Checkbox mt={4} mr={4} onChange={checkListed} defaultChecked={isListed}>
            Room Listed Publicly
          </Checkbox>
          <Checkbox mt={4} mr={4} onChange={checkProtected} defaultChecked={isProtected}>
            Joining Needs an Invite
          </Checkbox>
        </ModalBody>
        <ModalFooter pl="4" pr="8" mb="2">
          <Box display="flex" justifyContent="space-between" width="100%">
            <Button colorScheme="red" onClick={delConfirmOnOpen} mx="2">
              Delete
            </Button>
            <Button colorScheme="green" onClick={handleSubmit} isDisabled={!name}>
              Update
            </Button>
          </Box>
        </ModalFooter>
      </ModalContent>
      <ConfirmModal
        isOpen={delConfirmIsOpen}
        onClose={delConfirmOnClose}
        onConfirm={handleDeleteRoom}
        title="Delete Room"
        message="Are you sure you want to delete this room?"
        cancelText="Cancel"
        confirmText="Delete"
        confirmColor="red"
      ></ConfirmModal>
    </Modal>
  );
}
