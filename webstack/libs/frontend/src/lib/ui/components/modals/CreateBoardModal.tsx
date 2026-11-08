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
  useToast,
  Button,
  Checkbox,
  Box,
  Text,
} from '@chakra-ui/react';

import { MdPerson } from 'react-icons/md';

import { useUser } from '@sage3/frontend';
import { BoardSchema } from '@sage3/shared/types';
import { SAGEColors, randomSAGEColor, generateReadableID, isAlphanumericWithSpacesAndForeign, withPrivacy } from '@sage3/shared';

import { useBoardStore } from '../../../stores';
import { ColorPicker } from '../general';

interface CreateBoardModalProps {
  isOpen: boolean;
  roomId: string;
  onClose: () => void;
}

const NAME_MAX = 50;

export function CreateBoardModal(props: CreateBoardModalProps): JSX.Element {
  const { user, saveBoard } = useUser();
  const toast = useToast();

  const createBoard = useBoardStore((state) => state.create);
  const boards = useBoardStore((state) => state.boards);

  const [name, setName] = useState<BoardSchema['name']>('');
  const [isProtected, setProtected] = useState(false);
  const [roomID, setRoomID] = useState('');
  const [color, setColor] = useState('red' as SAGEColors);

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value);
  const handleColorChange = (color: SAGEColors) => setColor(color);

  // Pending create board sever reponse useState
  const [pendingCreate, setPendingCreate] = useState(false);

  // Run on every open of the dialog
  useEffect(() => {
    setRoomID(generateReadableID());
    // Reset the form fields
    setName('');
    setColor(randomSAGEColor());
    setProtected(false);
  }, [props.isOpen]);

  // the input element
  // When the modal panel opens, select the text for quick replacing
  const initialRef = React.useRef<HTMLInputElement>(null);

  // Keyboard handler: press enter to activate command
  const onSubmit = (e: React.KeyboardEvent) => {
    // Keyboard instead of pressing the button
    if (e.key === 'Enter') {
      create();
    }
  };

  const create = async () => {
    if (name && user) {
      const cleanedName = name.trim().substring(0, NAME_MAX);
      // list of board names in the room
      const roomsBoards = boards.filter((board) => board.data.roomId === props.roomId);
      const boardNames = roomsBoards.map((board) => board.data.name);

      if (cleanedName.split(' ').join('').length === 0) {
        toast({
          title: 'Name must have at least one character',
          status: 'error',
          duration: 2 * 1000,
          isClosable: true,
        });
      } else if (boardNames.includes(cleanedName)) {
        // board name already exists
        toast({
          title: 'Board name already exists',
          status: 'error',
          duration: 2 * 1000,
          isClosable: true,
        });
      } else if (!isAlphanumericWithSpacesAndForeign(cleanedName)) {
        toast({
          title: 'Name must only contain Unicode letters, numbers, comma, hyphen, underscore and spaces',
          status: 'error',
          duration: 3 * 1000,
          isClosable: true,
        });
      } else {
        // set the pending state to true so that the button is disabled
        setPendingCreate(true);
        // Create the board
        const board = await createBoard({
          name: cleanedName,
          description: 'description',
          roomId: props.roomId,
          ownerId: user._id,
          color: color,
          code: roomID,
          overrides: withPrivacy([], isProtected, user._id),
          executeInfo: { executeFunc: '', params: {} },
        });
        if (board) {
          toast({
            title: 'Board created successfully',
            status: 'success',
            duration: 2 * 1000,
            isClosable: true,
          });
          // Save the board to the user's starred boards
          if (saveBoard) {
            saveBoard(board._id);
          }
        } else {
          toast({
            title: 'Board creation failed',
            status: 'error',
            duration: 2 * 1000,
            isClosable: true,
          });
        }
        setPendingCreate(false);
        props.onClose();
      }
    }
  };

  // To enable/disable
  const checkProtected = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProtected(e.target.checked);
  };

  // Copy the board id to the clipboard
  const handleCopyId = async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(roomID);
      toast({
        title: 'Success',
        description: `BoardID Copied to Clipboard`,
        duration: 3000,
        isClosable: true,
        status: 'success',
      });
    }
  };

  return (
    <Modal isCentered isOpen={props.isOpen} onClose={props.onClose} blockScrollOnMount={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader fontSize="3xl">Create a New Board</ModalHeader>
        <ModalBody>
          <Box mb="4">
            <InputGroup>
              <InputLeftElement pointerEvents="none" children={<MdPerson size={'24px'} />} />
              <Input
                ref={initialRef}
                type="text"
                placeholder={'Board Name'}
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

          <ColorPicker selectedColor={color} onChange={handleColorChange}></ColorPicker>

          <Checkbox mt={4} mr={4} onChange={checkProtected} defaultChecked={isProtected}>
            Private Board (only you, and whoever you allow)
          </Checkbox>
        </ModalBody>
        <ModalFooter>
          <Button
            colorScheme="green"
            onClick={() => create()}
            isDisabled={!name || pendingCreate}
          >
            Create
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
