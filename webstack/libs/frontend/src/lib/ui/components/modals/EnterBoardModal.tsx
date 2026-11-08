/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */


import { useEffect } from 'react';

import { useRouteNav } from '../../../hooks';

import { Board } from '@sage3/shared/types';

export interface EnterBoardProps {
  isOpen: boolean;
  onClose: () => void;
  board: Board;
}

// Enters the board when opened. Who may see a board is decided by its permissions, not a PIN.
export const EnterBoardModal = (props: EnterBoardProps) => {
  const { toBoard } = useRouteNav();
  const { isOpen, onClose, board } = props;

  useEffect(() => {
    if (isOpen) {
      toBoard(board.data.roomId, board._id);
      onClose();
    }
  }, [isOpen, onClose, board, toBoard]);

  return null;
};
