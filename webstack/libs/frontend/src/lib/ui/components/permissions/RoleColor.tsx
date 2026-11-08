/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

// Role colors: a palette name such as "teal", or any hex color.

import { ReactNode, useState } from 'react';
import {
  Box,
  Input,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  SimpleGrid,
  Tag,
  Text,
  useToken,
} from '@chakra-ui/react';

import { parseRoleColor } from '@sage3/shared';

const palette = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'cyan', 'purple', 'pink'];
const isHex = (color: string) => color.startsWith('#');

/**
 * A role color as a CSS color for text: hex as it is, palette names at a shade that reads on both themes.
 */
export const roleColor = (color: string) => (isHex(color) ? color : `${color}.400`);

// Black or white, whichever reads better on a hex background.
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? 'black' : 'white';
}

/**
 * A tag in a role's color.
 */
export function RoleTag(props: { color: string; children: ReactNode }) {
  const hex = isHex(props.color);
  return (
    <Tag size="sm" colorScheme={hex ? undefined : props.color} bg={hex ? props.color : undefined} color={hex ? textOn(props.color) : undefined}>
      {props.children}
    </Tag>
  );
}

/**
 * A circle in the role's color, opening palette swatches, a color wheel, and a field for hex or "r, g, b".
 */
export function RoleColorPicker(props: { value: string; onChange: (color: string) => void; isDisabled?: boolean }) {
  const swatches = useToken('colors', palette.map((c) => `${c}.400`)) as string[];
  const hex = isHex(props.value) ? props.value : (swatches[palette.indexOf(props.value)] ?? '#808080');
  const [typed, setTyped] = useState('');
  const typedColor = parseRoleColor(typed);

  return (
    <Popover placement="bottom-end" isLazy>
      <PopoverTrigger>
        <Box
          as="button"
          aria-label="Role color"
          width="28px"
          height="28px"
          flexShrink={0}
          borderRadius="full"
          bg={hex}
          borderWidth="2px"
          borderColor="whiteAlpha.700"
          disabled={props.isDisabled}
          opacity={props.isDisabled ? 0.5 : 1}
          cursor={props.isDisabled ? 'not-allowed' : 'pointer'}
        />
      </PopoverTrigger>
      <PopoverContent width="220px">
        <PopoverArrow />
        <PopoverBody>
          <SimpleGrid columns={5} spacing="2" mb="3">
            {palette.map((c, i) => (
              <Box
                key={c}
                as="button"
                aria-label={c}
                width="28px"
                height="28px"
                borderRadius="full"
                bg={swatches[i]}
                borderWidth="2px"
                borderColor={props.value === c ? 'white' : 'transparent'}
                onClick={() => props.onChange(c)}
              />
            ))}
          </SimpleGrid>
          <Input type="color" size="sm" p="0" value={hex} aria-label="Color wheel" onChange={(e) => props.onChange(e.target.value)} />
          <Text fontSize="xs" color="gray.500" mt="2" mb="1">
            RGB, as #e07a2f or 224, 122, 47
          </Text>
          <Input
            size="sm"
            placeholder={hex}
            value={typed}
            isInvalid={typed !== '' && !typedColor}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typedColor) props.onChange(typedColor);
            }}
            onBlur={() => typedColor && props.onChange(typedColor)}
          />
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
