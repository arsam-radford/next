/**
 * Copyright (c) SAGE3 Development Team 2026. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useState } from 'react';
import { Box, Button, Checkbox, HStack, Icon, IconButton, Select, SimpleGrid, Tag, TagCloseButton, TagLabel, Text, Tooltip, VStack } from '@chakra-ui/react';
import { MdDelete, MdInfoOutline } from 'react-icons/md';

import {
  ALL,
  appLevels,
  BOARD_PERMISSIONS,
  fileLevels,
  Level,
  Override,
  Permission,
  PermissionName,
  permissionNames,
  pluginLevels,
} from '@sage3/shared';

import { useRoom } from '../../../hooks';
import { useRoomStore, useUsersStore } from '../../../stores';

const names = Object.keys(Permission) as PermissionName[];
const label = (name: PermissionName) => permissionNames(Permission[name])[0];

// What each permission allows, shown next to it.
const descriptions: Record<PermissionName, string> = {
  Administrator: 'Everything in the room, on every board, ignoring all board and app overrides. Only for people who run the class.',
  ManageRoom: "Change the room's name, description, listing, and whether joining needs an invite.",
  ManageRoles: 'Create, edit, reorder and delete roles below your own highest role, and give them to members. You can only grant permissions you have.',
  ManageMembers: 'Create invites, add and remove members, and ban or unban users. Only for members below you in the role order.',
  ModerateMembers: 'Time members out: they keep viewing but cannot participate until the timeout ends. Only for members below you.',
  ManageBoards: "Create, rename and delete boards, and change the permissions of boards and of single apps.",
  ManagePlugins: "Approve plugins for use on boards, and remove other people's plugins.",
  ViewAuditLog: "Read the room's audit log of permission and moderation changes.",
  UploadPlugins: 'Upload plugin packages to the room. Nothing in them runs until someone with Manage Plugins approves it.',
  ViewBoard: 'See the board and everything on it. Without this, the board is hidden and no other board permission applies.',
  CreateApps: 'Add new apps to the board. Some apps also need their own permission, such as Execute Code for SageCell.',
  InteractWithApps: 'Use apps without changing them, such as voting in a Poll. Editing an app includes this.',
  EditOwnApps: 'Change the content and title of apps you created.',
  EditOthersApps: "Change the content and title of other people's apps.",
  ArrangeOwnApps: 'Move, resize, pin and unpin apps you created. A pinned app does not move until it is unpinned.',
  ArrangeOthersApps: "Move, resize, pin and unpin other people's apps.",
  DeleteOwnApps: 'Delete apps you created.',
  DeleteOthersApps: "Delete other people's apps.",
  UploadAssets: 'Upload files (images, PDFs, videos and so on) to the board.',
  BrowseOthersAssets: "See other people's files in the file library. Files shown by apps on the board are visible either way.",
  DownloadOthersAssets: "Download the originals of other people's images and PDFs. What apps show stays visible either way.",
  ManageOthersAssets: "Rename and delete other people's files, and share them with the whole room.",
  UsePlugins: 'Use plugin apps on the board.',
  PlacePlugins: 'Add plugin apps to the board.',
  Annotate: 'Draw on the board with the whiteboard tools.',
  UseAI: 'Ask the AI (@S in the Chat app), and use SageIdeator. AI usage costs money.',
  ExecuteCode: "Run code in SageCell and the kernels. This runs code on the server's kernels.",
  Screenshare: 'Share a screen into the board.',
  Present: "Take over everyone's view of the board, for example to walk the class through slides.",
  ViewPresence: "See who else is on the board, with their cursors and names. Deny it for exams or anonymous activities.",
  Chat: 'Post messages in Chat apps. Deny it to mute someone. Clearing a chat needs Edit.',
};

function Info(props: { name: PermissionName }) {
  return (
    <Tooltip label={descriptions[props.name]} hasArrow placement="top" openDelay={150}>
      <Box as="span" display="inline-flex" ml="1" color="gray.400" cursor="help" aria-label={descriptions[props.name]} tabIndex={0}>
        <Icon as={MdInfoOutline} boxSize="14px" />
      </Box>
    </Tooltip>
  );
}

// A role's permissions by what people do. Sections with levels stack (each level includes the one before);
// the rest are plain switches. `text` is the plain wording of the simple view.
type Section = { title: string; levels?: Level[]; switches: { name: PermissionName; text: string }[] };
const sections: Section[] = [
  {
    title: 'Running the class',
    switches: [
      { name: 'ModerateMembers', text: 'Time students out' },
      { name: 'ManageMembers', text: 'Let people in and remove them' },
      { name: 'ManageRoles', text: 'Change roles' },
      { name: 'ManageBoards', text: 'Create and manage boards' },
      { name: 'ViewAuditLog', text: 'Read the audit log' },
    ],
  },
  {
    title: 'Boards',
    switches: [
      { name: 'ViewBoard', text: 'See boards' },
      { name: 'ViewPresence', text: 'See who else is here' },
    ],
  },
  { title: 'Apps', levels: appLevels, switches: [] },
  { title: 'Files', levels: fileLevels, switches: [] },
  { title: 'Plugins', levels: pluginLevels, switches: [{ name: 'ManagePlugins', text: 'Approve plugins' }] },
  {
    title: 'Communication',
    switches: [
      { name: 'Chat', text: 'Chat' },
      { name: 'Annotate', text: 'Draw on boards' },
      { name: 'Screenshare', text: 'Share a screen' },
      { name: 'Present', text: 'Present to everyone' },
    ],
  },
  {
    title: 'AI and code',
    switches: [
      { name: 'UseAI', text: 'Use AI' },
      { name: 'ExecuteCode', text: 'Run code' },
    ],
  },
  {
    title: 'Room owner powers',
    switches: [
      { name: 'ManageRoom', text: 'Change room settings' },
      { name: 'Administrator', text: 'Administrator: everything, everywhere' },
    ],
  },
];
const levelBits = (levels: Level[]) => levels.reduce((bits, l) => bits | l.bits, 0);
const bitNames = (bits: number) => names.filter((name) => bits & Permission[name]);
const count = (bits: number) => bitNames(bits).length;

// The level closest to `bits`, and how `bits` differs from it.
function closest(levels: Level[], bits: number) {
  const level = levels.reduce((best, l) => (count(l.bits ^ bits) < count(best.bits ^ bits) ? l : best));
  return { level, extra: bits & ~level.bits, missing: level.bits & ~bits };
}

const pairs: { action: string; own: PermissionName; others: PermissionName }[] = [
  { action: 'Edit', own: 'EditOwnApps', others: 'EditOthersApps' },
  { action: 'Move, resize and pin', own: 'ArrangeOwnApps', others: 'ArrangeOthersApps' },
  { action: 'Delete', own: 'DeleteOwnApps', others: 'DeleteOthersApps' },
];

// One line saying what the role can do, for example "Apps: Full · Files: View · Chat, Draw on boards".
function summarize(bits: number): string {
  if (bits & Permission.Administrator) return 'Can do everything in this room, on every board.';
  const parts = sections.map((section) => {
    const on = section.switches.filter((s) => bits & Permission[s.name]).map((s) => s.text);
    if (!section.levels) return on.join(', ');
    const { level, extra, missing } = closest(section.levels, bits & levelBits(section.levels));
    return [`${section.title}: ${level.name}${extra | missing ? ' with exceptions' : ''}`, ...on].join(', ');
  });
  return parts.filter(Boolean).join(' · ') || 'Nothing beyond @everyone.';
}

/**
 * A role's permissions: a plain-language summary, then one level or a few switches per section, with exceptions to a
 * level shown next to it. Advanced shows every permission. `inherited` is what @everyone already gives: shown as on,
 * marked, and not removable here. Bits outside `editable` cannot be changed.
 */
export function PermissionChecks(props: { value: number; editable: number; inherited?: number; onChange: (value: number) => void }) {
  const [advanced, setAdvanced] = useState(false);
  const inherited = props.inherited ?? 0;
  const bits = props.value | inherited;
  const set = (bit: number, on: boolean) => props.onChange(on ? props.value | bit : props.value & ~bit);

  const check = (name: PermissionName, text = label(name)) => {
    const bit = Permission[name];
    const fromEveryone = (inherited & bit) !== 0 && (props.value & bit) === 0;
    return (
      <Box key={name} display="flex" alignItems="center">
        <Checkbox
          size="sm"
          aria-label={label(name)}
          isChecked={(bits & bit) !== 0}
          isDisabled={fromEveryone || (props.editable & bit) === 0}
          onChange={(e) => set(bit, e.target.checked)}
        >
          {text}
          {fromEveryone && (
            <Text as="span" fontSize="xs" color="gray.500" ml="1">
              (from @everyone)
            </Text>
          )}
        </Checkbox>
        <Info name={name} />
      </Box>
    );
  };
  const heading = (text: string) => (
    <Text fontSize="xs" fontWeight="bold" textTransform="uppercase" color="gray.500" mt="3" mb="1">
      {text}
    </Text>
  );

  // A level, and each way the role differs from it, with a way back to the plain level.
  const leveled = (levels: Level[]) => {
    const mask = levelBits(levels);
    const { level, extra, missing } = closest(levels, bits & mask);
    const choose = (l: Level) => props.onChange((props.value & ~mask) | (l.bits & ~inherited));
    const exception = (name: PermissionName, adds: boolean) => {
      const bit = Permission[name];
      const fromEveryone = adds && (props.value & bit) === 0;
      return (
        <Tag key={name} size="sm" colorScheme={adds ? 'green' : 'red'} variant="subtle">
          <TagLabel>
            {adds ? 'can ' : 'cannot '}
            {label(name)}
            {fromEveryone && ' (from @everyone)'}
          </TagLabel>
          {!fromEveryone && (props.editable & bit) !== 0 && (
            <TagCloseButton aria-label={`Back to ${level.name}`} onClick={() => set(bit, !adds)} />
          )}
        </Tag>
      );
    };
    return (
      <HStack align="center" wrap="wrap" spacing="2">
        <Select size="sm" width="200px" value={level.name} onChange={(e) => choose(levels.find((l) => l.name === e.target.value)!)}>
          {levels.map((l) => (
            <option key={l.name} value={l.name} disabled={(((l.bits & ~inherited) ^ props.value) & mask & ~props.editable) !== 0}>
              {l.name}
            </option>
          ))}
        </Select>
        {(extra | missing) !== 0 && (
          <Text fontSize="sm" color="gray.500">
            except:
          </Text>
        )}
        {bitNames(extra).map((name) => exception(name, true))}
        {bitNames(missing).map((name) => exception(name, false))}
      </HStack>
    );
  };

  // Every permission of a section, by its formal name.
  const everyCheck = (section: Section) =>
    section.title === 'Apps' ? (
      <SimpleGrid columns={3} spacingX="4" spacingY="1" alignItems="center">
        {check('CreateApps')}
        {check('InteractWithApps')}
        <Box />
        <Box />
        <Text fontSize="xs" color="gray.500">
          Their own apps
        </Text>
        <Text fontSize="xs" color="gray.500">
          Other people's apps
        </Text>
        {pairs.map((pair) => [
          <Text key={pair.action} fontSize="sm">
            {pair.action}
          </Text>,
          check(pair.own, ''),
          check(pair.others, ''),
        ])}
      </SimpleGrid>
    ) : (
      <SimpleGrid columns={3} spacingX="4" spacingY="1">
        {[...bitNames(section.levels ? levelBits(section.levels) : 0), ...section.switches.map((s) => s.name)].map((name) => check(name))}
      </SimpleGrid>
    );

  const shown = bits & Permission.Administrator ? sections.filter((s) => s.title === 'Room owner powers') : sections;
  return (
    <Box mt="2">
      <Text fontSize="sm" fontWeight="medium">
        {summarize(bits)}
      </Text>
      {shown.map((section) => (
        <Box key={section.title}>
          {heading(section.title)}
          {advanced ? (
            everyCheck(section)
          ) : (
            <VStack align="stretch" spacing="1">
              {section.levels && leveled(section.levels)}
              {section.switches.length > 0 && (
                <SimpleGrid columns={3} spacingX="4" spacingY="1">
                  {section.switches.map((s) => check(s.name, s.text))}
                </SimpleGrid>
              )}
            </VStack>
          )}
        </Box>
      ))}
      {props.editable !== 0 && (ALL & ~props.editable) !== 0 && (
        <Text fontSize="xs" color="gray.500" mt="2">
          Greyed out: you can only give permissions you have yourself.
        </Text>
      )}
      <Button size="xs" variant="link" mt="2" onClick={() => setAdvanced(!advanced)}>
        {advanced ? 'Show the simple view' : 'Show every permission'}
      </Button>
    </Box>
  );
}

/**
 * Allow / inherit / deny choices for an override, limited to the permissions in `mask`.
 */
export function OverrideChoices(props: {
  allow: number;
  deny: number;
  editable: number;
  mask?: number;
  onChange: (allow: number, deny: number) => void;
}) {
  const mask = props.mask ?? BOARD_PERMISSIONS;
  return (
    <SimpleGrid columns={2} spacingX="4" spacingY="1">
      {names
        .filter((name) => Permission[name] & mask)
        .map((name) => {
          const bit = Permission[name];
          const value = props.allow & bit ? 'allow' : props.deny & bit ? 'deny' : 'inherit';
          const change = (next: string) => {
            const allow = next === 'allow' ? props.allow | bit : props.allow & ~bit;
            const deny = next === 'deny' ? props.deny | bit : props.deny & ~bit;
            props.onChange(allow, deny);
          };
          return (
            <Box key={name} display="flex" alignItems="center" justifyContent="space-between" gap="2">
              <Text fontSize="sm" display="flex" alignItems="center">
                {label(name)}
                <Info name={name} />
              </Text>
              <Select
                size="xs"
                width="110px"
                value={value}
                isDisabled={(props.editable & bit) === 0}
                onChange={(e) => change(e.target.value)}
                color={value === 'allow' ? 'green.400' : value === 'deny' ? 'red.400' : undefined}
              >
                <option value="inherit">Inherit</option>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </Select>
            </Box>
          );
        })}
    </SimpleGrid>
  );
}

// The overrides with one target's allow and deny bits changed. An empty override is dropped.
export function setOverride(overrides: Override[], kind: Override['kind'], target: string, allow: number, deny: number): Override[] {
  const rest = overrides.filter((o) => !(o.kind === kind && o.target === target));
  return allow || deny ? [...rest, { kind, target, allow, deny }] : rest;
}

export function find(overrides: Override[], kind: Override['kind'], target: string): Override {
  return overrides.find((o) => o.kind === kind && o.target === target) ?? { kind, target, allow: 0, deny: 0 };
}

/**
 * A list of overrides, one per role or member, with a way to add more. Used for boards and for single apps.
 */
export function OverridesList(props: { roomId: string; overrides: Override[]; onChange: (overrides: Override[]) => void; editable: number; mask?: number }) {
  const room = useRoom(props.roomId);
  const members = useRoomStore((state) => state.members);
  const users = useUsersStore((state) => state.users);
  const [adding, setAdding] = useState('');
  const { overrides, onChange } = props;
  const name = (o: Override) =>
    o.kind === 'role' ? (room?.data.roles.find((r) => r.id === o.target)?.name ?? o.target) : (users.find((u) => u._id === o.target)?.data.name ?? o.target);
  const candidates = [
    ...(room?.data.roles ?? []).map((r) => ({ key: `role:${r.id}`, label: r.name })),
    ...members
      .filter((m) => m.data.roomId === props.roomId)
      .map((m) => ({ key: `member:${m.data.userId}`, label: users.find((u) => u._id === m.data.userId)?.data.name ?? m.data.userId })),
  ].filter((c) => !overrides.some((o) => `${o.kind}:${o.target}` === c.key));

  return (
    <VStack align="stretch" spacing="4">
      {overrides.map((o) => (
        <Box key={`${o.kind}:${o.target}`} borderWidth="1px" borderRadius="md" p="3">
          <HStack justify="space-between" mb="2">
            <Text fontWeight="bold">
              {o.kind === 'member' ? 'Member: ' : 'Role: '}
              {name(o)}
            </Text>
            <IconButton aria-label="Remove override" size="xs" icon={<MdDelete />} onClick={() => onChange(overrides.filter((x) => x !== o))} />
          </HStack>
          <OverrideChoices
            allow={o.allow}
            deny={o.deny}
            editable={props.editable}
            mask={props.mask}
            onChange={(allow, deny) => onChange(setOverride(overrides, o.kind, o.target, allow, deny))}
          />
        </Box>
      ))}
      <HStack>
        <Select size="sm" placeholder="Add a role or member" value={adding} onChange={(e) => setAdding(e.target.value)}>
          {candidates.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          isDisabled={!adding}
          onClick={() => {
            const [kind, target] = adding.split(':') as [Override['kind'], string];
            onChange([...overrides, { kind, target, allow: 0, deny: 0 }]);
            setAdding('');
          }}
        >
          Add
        </Button>
      </HStack>
    </VStack>
  );
}
