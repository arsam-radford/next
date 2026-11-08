# Roles and Permissions: Design

**Status:** Draft. All questions raised so far are decided.
**Last updated:** 2026-10-27 (implemented; see [section 25](#25-implementation-notes))

This document describes a new permission system for SAGE3. It replaces the current four fixed global roles with roles that each room defines for itself, permissions that can be adjusted per board, and server-side enforcement on every request. It is modeled closely on Discord's roles and channel permission overwrites, adapted to the way SAGE3 is used in teaching: a room is a class, the instructor needs to be able to change who can do what in the middle of a session, and students are regularly split into groups.

The document is meant to be read on its own. It starts with how permissions work today, then explains the new model piece by piece, and ends with migration, implementation phases, and the questions that are still open.

---

## Contents

1. [Goals](#1-goals)
2. [How permissions work today](#2-how-permissions-work-today)
3. [Why model this on Discord](#3-why-model-this-on-discord)
4. [Vocabulary](#4-vocabulary)
5. [The hierarchy: instance, room, board, app](#5-the-hierarchy-instance-room-board-app)
6. [Permissions](#6-permissions)
7. [Roles](#7-roles)
8. [Board overrides](#8-board-overrides)
9. [Computing a user's effective permissions](#9-computing-a-users-effective-permissions)
10. [Groups](#10-groups)
11. [Templates and the default roles](#11-templates-and-the-default-roles)
12. [Live moderation: changing things on a whim](#12-live-moderation-changing-things-on-a-whim)
13. [Membership, invites, bans, and timeouts](#13-membership-invites-bans-and-timeouts)
14. [How apps interact with permissions](#14-how-apps-interact-with-permissions)
15. [Plugins](#15-plugins)
16. [Files](#16-files)
17. [Enforcement](#17-enforcement)
18. [Audit log](#18-audit-log)
19. [Instance-level permissions and the old global roles](#19-instance-level-permissions-and-the-old-global-roles)
20. [Data model](#20-data-model)
21. [Migrating existing data](#21-migrating-existing-data)
22. [Implementation phases](#22-implementation-phases)
23. [Decisions so far](#23-decisions-so-far)
24. [Open questions](#24-open-questions)
25. [Implementation notes](#25-implementation-notes)

---

## 1. Goals

The system should let an instructor run a class inside SAGE3 the way they would run a physical classroom, and moderate it when needed. Concretely:

- **Rooms are classes.** Everyone in a room is a member of that class, and each member has one or more roles, such as Instructor, TA, or Student, that decide what they can do there.
- **Rooms decide their own roles.** There is no fixed list built into the code. SAGE3 ships sensible starting setups as templates, and each room can change them freely.
- **Boards can differ from the rest of the room.** A board can be hidden, read-only, or open only to one group, without creating a separate room.
- **Groups are easy.** Splitting a class into teams, each with its own board, should take a few clicks, not a custom feature.
- **Changes take effect immediately.** When an instructor locks a board or mutes a student, that applies to the very next action, for everyone, with no reload or re-login.
- **The server is the authority.** The client uses permissions to hide buttons, but every rule is checked on the server, so a modified client, a Python script using the API, or a plugin cannot get around it.
- **Moderation is accountable.** Every permission change and moderation action is recorded in an audit log that room administrators can read.
- **Existing rooms keep working.** Upgrading must not lock anyone out of a room they use today.

---

## 2. How permissions work today

Understanding the current system explains what has to change and what can stay.

### Global roles

Every user has exactly one role for the whole server: `admin`, `user`, `guest`, or `spectator` (`libs/shared/src/lib/types/schemas/user.ts`). The role is not looked up from the database. It is derived from the login provider at request time (`libs/backend/src/lib/generics/permissions.ts`): logging in with Google, CILogon, Apple, JWT, or Keycloak makes you a `user`, the guest login makes you a `guest`, and so on. LDAP is the one exception, where a group-to-role mapping can be stored on the login record.

### What a role allows

The rules live in `libs/shared/src/lib/permissions/SAGEAbility.ts`. Each rule says that a role may perform an action on a collection, for example "a guest may update apps" or "a spectator may read anything". The current table gives `admin` and `user` permission to do everything to everything, gives `guest` permission to create, read, and update apps, presence, and users, and gives `spectator` read-only access.

### Where it is checked

The checks run in two places:

- `SAGERouter` for REST requests, which maps the HTTP method to an action (`POST` is create, `PUT` is update, and so on).
- `SAGEWSRouter` for WebSocket messages, which does the same for real-time traffic.

This is useful for the new design. Almost all writes and subscriptions already pass through these two points, so the new checks have a natural home.

### What is missing

- **Nothing is scoped to a room or board.** The check asks "can a `user` update apps?", never "can this user update this app on this board?". Since `user` is allowed everything, any logged-in user can edit, move, or delete any app in any room on the server.
- **Rooms have no roles.** The only special person in a room is its owner (`ownerId`). Membership is a single document per room holding a flat list of user IDs (`ROOMMEMBERS`). The only moderation available is the owner removing a member, and the owner approving plugins.
- **Privacy is a PIN.** Rooms and boards have `isPrivate` and `privatePin` fields. As far as the server-side code shows, the PIN is checked in the client. The server's checks never look at which room or board a request is for.
- **Pinning is only a suggestion.** A pinned app cannot be dragged or resized in the browser (`libs/applications/src/lib/components/AppWindow/AppWindow.tsx`), but anyone can unpin anything, and the server does not check the pin at all.
- **Files are not protected.** Each file (asset) records its `owner` and `room`, but as far as the generic routes show, any logged-in user can delete any file.
- **Guests and spectators are special-cased in the UI.** The home page has explicit branches for `guest` and `spectator` (`apps/webapp/src/app/pages/home/Home.tsx`) to hide room and board creation.

The structure itself (rooms containing boards containing apps) is already the one we want. What the new system adds is the idea of *who someone is inside a room*, and checks that actually use it.

---

## 3. Why model this on Discord

Discord solves almost exactly this problem: many communities on one platform, each defining its own roles, with per-channel exceptions, moderation tools, and a clear hierarchy of who can manage whom. It has been refined against millions of communities and the rules are well understood by many students and staff already.

The pieces we take from it:

- **Roles are defined per community** (for us, per room), not per platform.
- **Permissions are additive.** A member's permissions are everything granted by any of their roles combined.
- **`@everyone` is a role** that every member has implicitly. It is the baseline.
- **Channels (for us, boards) can override** what roles or individual members can do there, both granting and removing permissions.
- **Roles are ordered.** You can only manage roles and members below your own highest role.
- **The owner and anyone with Administrator bypass everything**, so the people running the community can never lock themselves out.
- **Timeouts** temporarily remove a member's ability to participate without removing them.

The main additions for SAGE3 are templates (so an instructor does not start from a blank slate), groups as a first-class idea in the UI, and app-level "interaction" so students can use an app without being able to rewrite it.

---

## 4. Vocabulary

- **Instance:** one SAGE3 server (one homebase). Users are global to an instance.
- **Room:** a class. Has members, roles, boards, assets, plugins, and chat.
- **Board:** a canvas inside a room. Has apps, annotations, and links.
- **File (asset):** an uploaded file, such as an image, PDF, or video. Belongs to the board it was uploaded on, or is shared with the whole room.
- **App:** a window on a board (a sticky note, a PDF, a Poll, a SageCell, a plugin).
- **Member:** a user who has joined a room. Membership is per room.
- **Role:** a named set of permissions defined by a room, given to members.
- **`@everyone`:** the role every member of a room has automatically.
- **Permission:** a single ability, such as "create apps" or "use AI".
- **Override:** a per-board adjustment that allows or denies specific permissions for one role or one member on that board.
- **Effective permissions:** what a specific user can actually do on a specific board, after roles and overrides are combined.
- **Group:** a role marked as a group, used to split a class into teams.
- **Template:** a saved set of roles (and optionally boards and overrides) that can be applied to a new room.
- **Owner:** the user who owns a room. Always has every permission in it.

---

## 5. The hierarchy: instance, room, board, app

```
Instance                  instance permissions (admin, create rooms)
└─ Room  = a class        roles, members, invites, bans, audit log
   └─ Board               overrides per role and per member
      └─ App              ownership, pin and lock flags, declared actions
```

**Instance.** A small number of permissions apply to the whole server: being an instance administrator and being allowed to create rooms. These replace the old global roles. See [section 19](#19-instance-level-permissions-and-the-old-global-roles).

**Room.** This is where roles are defined and where membership lives. It is the equivalent of a Discord server. One room is one class (or one section of a class). We decided not to add anything between the instance and the room for now: a course with several sections is simply several rooms, and templates make it easy to set them up the same way. A department or organization level can be added later if it turns out to be needed.

**Board.** The equivalent of a Discord channel. A board does not define roles of its own. It can only adjust the room's roles through overrides: "on this board, Students cannot edit", or "on this board, only Group 3 can see anything".

**App.** Apps do not get their own permission lists, the same way Discord messages do not. Instead an app has an owner (the user who created it), can be pinned in place or locked against editing, and may declare *actions* that let people interact with it without editing it (see [section 14](#14-how-apps-interact-with-permissions)).

---

## 6. Permissions

Each permission is one bit in a number. A role's permissions, an override's allow list, and an override's deny list are each a single number, and combining them is a bitwise OR. This keeps the data small, makes the calculation trivially cheap, and makes it easy to send permissions to the client.

JavaScript's bitwise operators work on 32-bit integers, so we can use bits 0 to 30 with a plain `number`. The list below uses 24 bits (8 room permissions and 16 board permissions), which leaves room for growth. If we ever exceed 31 permissions we can move to a `bigint`, as Discord did.

Permissions come in two scopes:

- **Room permissions** apply to the room as a whole. They can only be granted by roles and are not affected by board overrides.
- **Board permissions** apply to what happens on a board. Roles grant them as a baseline, and board overrides can adjust them per board.

### Room permissions

| Permission | What it allows |
|---|---|
| **Administrator** | Everything in the room, on every board, ignoring all overrides. Should only be given to people who run the class. |
| **Manage Room** | Change the room's name, description, listing, and other settings. |
| **Manage Roles** | Create, edit, reorder, and delete roles below your own highest role, and assign them to members. You can never grant a permission you do not have yourself. |
| **Manage Members** | Create invites and join codes, remove members, and ban or unban users. Only for members below your own highest role. |
| **Moderate Members** | Put members in a timeout (see [section 13](#13-membership-invites-bans-and-timeouts)). Only for members below your own highest role. |
| **Manage Boards** | Create, rename, delete, and reorder boards, and edit board overrides. |
| **Manage Plugins** | Approve plugins for use on boards, and remove other people's plugins. Replaces the current rule that only the room owner can approve plugins. Uploading a plugin needs only Use Plugins, because nothing runs until it is approved. |
| **View Audit Log** | Read the room's audit log. |

### Board permissions

| Permission | What it allows |
|---|---|
| **View Board** | See the board and everything on it. Without this, the board does not appear in the board list and no other board permission has any effect. |
| **Create Apps** | Add new apps to the board. Some app types additionally need a specific permission (for example SageCell needs Execute Code). |
| **Edit Apps** | Change the content of any app on the board, regardless of who created it, and move and resize apps that are not pinned. Classrooms are collaborative, so this deliberately covers everyone's apps. Also allows deleting, pinning, and unpinning apps you created. |
| **Interact With Apps** | Use the declared actions of apps, such as voting in a Poll, without being able to change the app's content. Edit Apps includes this. |
| **Manage Apps** | Delete anyone's apps, pin or unpin anyone's apps, and lock or unlock apps. A locked app's content can only be edited by people with Manage Apps. |
| **Upload Assets** | Upload files (images, PDFs, videos, and so on) to the board. |
| **Download Assets** | Open and download the files that belong to the board, and the files shared with the whole room (see [section 16](#16-files)). |
| **Manage Assets** | Delete or rename other people's files, and share files with the whole room. Everyone can always delete and rename their own files. |
| **Annotate** | Draw on the board with the whiteboard and annotation tools. |
| **Chat** | Send messages in the room and board chat. |
| **Use AI** | Use the AI features (the Chat app's AI, SageIdeator, and other agent-backed features). Separate because AI usage costs money and instructors will often want it off. |
| **Execute Code** | Run code through SageCell and the kernels. Separate because it runs arbitrary code on the server's kernels. |
| **Screenshare** | Share a screen into the board. |
| **Use Plugins** | Create and use plugin apps. The plugin's own approved capabilities still apply on top of this (see [section 15](#15-plugins)). |
| **Present** | Take over everyone's view of the board, for example to walk the class through a slide deck. |
| **View Presence** | See who else is on the board, including their cursors and names. Can be denied for exams or anonymous activities. |

### Rules that tie permissions together

A few relationships are applied when checking, rather than being stored:

- **View Board gates everything on a board.** If you cannot see a board you cannot do anything on it, whatever else you have been granted.
- **Edit Apps includes Interact With Apps.** Anyone who can rewrite an app can also use it.
- **Deleting an app** you created needs Edit Apps. Deleting someone else's needs Manage Apps.
- **Pinning controls moving and resizing.** A pinned app cannot be moved or resized by anyone, and the server rejects such updates. To move it, it has to be unpinned first. You can pin and unpin your own apps. Pinning or unpinning someone else's needs Manage Apps. This lets an instructor fix their layout in place while students can still move the apps they create themselves.
- **Locking controls content.** A locked app's content can only be edited by people with Manage Apps. It can still be interacted with, so a locked Poll can still be voted on. Pin and lock are independent: an instructions note is usually both.

---

## 7. Roles

A role belongs to one room and has:

- a **name**, such as "TA" or "Group 3";
- a **color**, used in the member list and next to cursors;
- a **permission set** (one number);
- a **position** in the room's role order;
- a **group flag**, which only affects how the role is shown in the UI (see [section 10](#10-groups)).

A member can have any number of roles. Their room permissions are the combination of `@everyone` and all of their roles.

### `@everyone`

Every room has an `@everyone` role that cannot be deleted and that every member has without it being assigned. It sits at the bottom of the role order. Its permissions are what any member of the room can do. Its id is always `everyone`. Roles belong to one room, so role ids only need to be unique within it.

Because permissions are additive, **`@everyone` should be the minimum anyone in the room needs.** If `@everyone` were the normal student level, there would be no way to make an "Observer" role with fewer permissions than a student. So in the shipped templates `@everyone` can view, and participation comes from a Student role that join codes assign automatically.

### Role order and who can manage whom

Roles are kept in an ordered list. A higher position means more authority. The order matters in three ways:

1. **You can only edit, assign, or remove roles below your own highest role.** A TA cannot edit the Instructor role or give someone the Instructor role.
2. **You can only remove, ban, or time out members whose highest role is below yours.** A TA cannot remove the instructor.
3. **You can never grant a permission you do not have.** Even with Manage Roles, a TA without Use AI cannot give Use AI to a role.

The room owner is outside this order and can manage everyone and everything.

---

## 8. Board overrides

A board can have a list of overrides. Each override targets either one role or one member and has two permission sets: **allow** and **deny**. Anything in neither stays as it was.

Examples:

- `@everyone`: deny Edit Apps. Makes the board read-only for everyone without a higher override.
- `Group 3`: allow View Board, Edit Apps. Together with `@everyone`: deny View Board, makes a board only Group 3 (and staff) can see and edit.
- Member `alex`: deny Chat. Mutes one student on one board.

Only board permissions can appear in overrides; the server refuses overrides that contain room permissions. Editing overrides needs Manage Boards, and every bit an edit allows, denies or clears must be one the editor's roles give them in the room. The bound is the room-level permissions rather than the editor's permissions on that board, so a lock that also applies to the person who set it can still be undone.

Overrides replace the current private-board PIN. A "private" board is a board with `@everyone`: deny View Board, plus allow overrides for whoever should see it.

---

## 9. Computing a user's effective permissions

This is Discord's algorithm, with two instance-level additions: instance administrators are treated like the owner, and read-only accounts are capped. It runs on the server for every check, and the same function runs on the client to decide what to show.

```ts
const ALL = 0x7fffffff;

function roomPermissions(room: Room, member: Member, account: Account): number {
  if (account.instanceAdmin || member.userId === room.ownerId) return ALL;

  let p = room.roles[0].permissions; // @everyone is always first
  for (const role of room.roles) {
    if (member.roles.includes(role.id)) p |= role.permissions;
  }

  if (p & Permission.Administrator) p = ALL;

  // Read-only accounts (spectator logins) are capped, whatever their roles say.
  if (account.readOnly) p &= READ_ONLY_KEEPS;
  return p;
}

function boardPermissions(room: Room, board: Board, member: Member, account: Account, now: number): number {
  let p = roomPermissions(room, member, account);
  if (p === ALL) return ALL;

  // 1. The @everyone override.
  const everyone = board.overrides.find((o) => o.target === room.id);
  if (everyone) p = (p & ~everyone.deny) | everyone.allow;

  // 2. All overrides for roles the member has, combined.
  let allow = 0;
  let deny = 0;
  for (const o of board.overrides) {
    if (o.kind === 'role' && o.target !== room.id && member.roles.includes(o.target)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  p = (p & ~deny) | allow;

  // 3. The member's own override, if any.
  const own = board.overrides.find((o) => o.kind === 'member' && o.target === member.userId);
  if (own) p = (p & ~own.deny) | own.allow;

  // View Board gates everything on the board.
  if (!(p & Permission.ViewBoard)) return 0;

  // Timeouts remove participation, whatever the overrides say.
  if (member.timeoutUntil > now) p &= ~TIMEOUT_REMOVES;

  // Overrides cannot lift the read-only cap either.
  if (account.readOnly) p &= READ_ONLY_KEEPS;

  return p;
}
```

Four details are worth spelling out:

- **The order of the steps matters.** The `@everyone` override is applied first, then role overrides, then the member's own override. A later step wins over an earlier one. So "deny for everyone, allow for Group 3" gives Group 3 access, and "allow for the Students role, deny for this one student" mutes that student.
- **Role overrides are combined before being applied.** If a member has two roles and one override denies something while the other allows it, the allow wins. This matches Discord and means adding a role to someone never takes something away from them.
- **Owner and Administrator skip overrides entirely.** This is what guarantees the instructor can lock a board without locking themselves out of it. Instance administrators are treated like the owner (see [section 19](#19-instance-level-permissions-and-the-old-global-roles)).
- **The read-only cap is applied last**, both to room permissions and after board overrides, so nothing inside a room can lift it.

The calculation is a handful of bitwise operations over a few short lists. It costs far less than reading the documents it needs, so it is fine to run on every request. The documents it reads (the room's roles, the board's overrides, the membership) are what is worth caching.

---

## 10. Groups

Classes are regularly split into groups for projects, labs, or discussion. In Discord's model a group needs no new mechanism: **a group is a role, and a group board is a board with overrides for that role.**

A typical group setup:

- Roles `Group 1` through `Group 5`, each with no room permissions of its own. Their only purpose is to be targeted by overrides.
- Boards `Group 1` through `Group 5`. Each has `@everyone`: deny View Board, and `Group N`: allow View Board.
- Students keep their Student role, which gives them the normal ability to edit. On their group's board they can see and edit. Other groups' boards are hidden from them.
- Instructors and TAs see every board, because Administrator ignores overrides and the TA template's overrides allow it.

Because this is just roles and overrides, all the variations instructors ask for are a matter of choosing different overrides:

- **Groups can look at each other's work but only edit their own:** allow View Board for `@everyone` on group boards, and deny Edit Apps for `@everyone`, then allow Edit Apps for the group.
- **A group leader:** a `Group 3 Lead` role, or a member override allowing Manage Apps on that board.
- **A student in two groups**, for example a project team and a lab section: give them both roles.
- **A TA responsible for two groups:** give the TA those group roles or member overrides on those boards.

### What makes groups first-class in the UI

The one addition on top of Discord is a **group flag** on roles. It does not change any permission calculation. It lets the UI show groups separately from roles, because instructors think about "teams" and "staff" very differently even though they work the same way underneath. With the flag, the UI can offer:

- a **Groups** panel listing teams and their members, separate from the Roles panel;
- **create N groups**, which creates the roles and, optionally, a board for each with the right overrides;
- **assign students to groups automatically**, randomly or evenly;
- **dissolve groups**, which removes the group roles and optionally archives their boards;
- **spin off group rooms**, described below.

### Rooms for groups

Some group work outgrows a board in the class room. A semester-long project, for example, may need its own boards, its own invites, and its own roles. That calls for a separate room per group, and the natural thought is to let the group create it.

Roles cannot grant that directly. A role only exists inside a room, and creating a room happens outside any room, so a `Group 3` role in the class has no way to say "may create rooms" unless rooms could have parent rooms, which this design deliberately avoids. Giving every student the instance-wide Create Rooms permission would work but defeats the point of restricting it (see [section 19](#19-instance-level-permissions-and-the-old-global-roles)).

Instead the instructor creates the rooms, in one action from the Groups panel:

- **Spin off group rooms** creates one room per group from a chosen template, named after the group, for example "Group 3 – Semester Project".
- The group's members join the new room with a **Project Lead** role that has Administrator. Inside their room they can do anything: create boards, invite people, and set up their own roles.
- **The instructor stays the owner** of every spun-off room. The class's rooms stay accountable, their audit logs stay visible to the instructor, and they can be archived together at the end of the semester.
- The same action works for individual students: a group of one, or a per-student option.

Students therefore never need Create Rooms for class projects, and restricting it costs almost nothing for teaching.

If it later turns out that students need to create rooms entirely on their own within a class, a possible extension is a room permission such as "Create Linked Rooms", where any room a member creates is automatically owned by the class's owner. That reintroduces a link between rooms, so it is left out until spin-off rooms prove insufficient.

---

## 11. Templates and the default roles

SAGE3 does not hard-code roles such as Student or TA. Instead it ships **templates**. A template is a saved room setup:

- the list of roles, with their permissions, colors, order, and group flags;
- optionally a set of empty boards and their role overrides;
- the roles granted by the new room's first invite.

When a room is created from a template, the template is **copied** into the room. The new room is independent: changing or deleting the template does not change rooms already created from it. Templates do not copy members, bans, board content, member-specific overrides, or saved board presets. Applying a template to an existing room is not supported.

Room owners can save their setup from **Roles and Members → Templates**. The snapshot starts private, and the owner chooses its default invite roles and whether to include empty boards. Instance administrators can publish or unpublish saved templates there. **Create Room** offers shipped templates, the user's private templates, and published templates. Owners and instance administrators can delete saved templates; shipped templates cannot be changed.

### Shipped templates

**Classroom.** The default for teaching.

| Role | Permissions |
|---|---|
| Instructor | Administrator |
| TA | Everything a Student has, plus Manage Apps, Manage Assets, Manage Boards, Manage Members, Moderate Members, Present, View Audit Log, Use AI, Execute Code, Screenshare |
| Student | View Board, Create Apps, Edit Apps, Interact With Apps, Upload Assets, Download Assets, Annotate, Chat, Use Plugins, View Presence |
| `@everyone` | View Board, Download Assets, View Presence |

Join codes assign Student. Use AI, Execute Code, Screenshare, and Present are off for students by default and can be turned on per class or per board.

**Group work.** Classroom, plus a configurable number of group roles and one board per group, set up as described in [section 10](#10-groups).

**Lecture.** For presentations where students follow along. Same roles as Classroom, but Student only adds Interact With Apps, Annotate, and Chat on top of `@everyone`, so students can vote in polls and ask questions without changing the slides.

**Open collaboration.** Everyone in the room can do everything except manage the room: `@everyone` has every board permission plus Manage Boards. This reproduces how rooms behave today, and **every existing room is migrated to it** so nothing changes on upgrade (see [section 21](#21-migrating-existing-data)).

---

## 12. Live moderation: changing things on a whim

The instructor needs to be able to change what people can do in the middle of a class, without preparing anything in advance. The key design choice is that **every live moderation action is an ordinary edit to roles, overrides, or membership.** There is no separate mechanism for "live" changes, which means there is only one thing to implement, test, and audit.

The UI provides one-click actions for the common cases:

| Action | What it does underneath |
|---|---|
| Lock this board | `@everyone`: deny Create Apps, Edit Apps on the board |
| Pin all apps | Pins every app currently on the board, so the layout stays in place while apps created afterwards can still be moved |
| Pin an app | Sets the app's pinned flag |
| Hide this board | `@everyone`: deny View Board on the board |
| Freeze all boards | The same deny on every board in the room, in one atomic change |
| Mute a student | Member override denying Chat (on one board or all boards) |
| Time out a student | Sets the member's timeout (see [section 13](#13-membership-invites-bans-and-timeouts)) |
| Lock an app | Sets the app's lock flag |
| Open group boards | Allows each group role on its own board |
| Turn AI on for this activity | Allows Use AI for Student on the current board |

### Making changes feel instant

- **The server checks permissions on every request**, using the current roles and overrides. A change applies to the next action anyone takes.
- **Clients are subscribed to the room and board documents** that hold roles and overrides, so they receive changes immediately, recompute their permissions, and update the UI: buttons disappear, a hidden board closes, a pinned app stops responding to drags.
- **Actions already in flight are rejected** by the server if they arrive after the change, and the client reverts its optimistic update.
- **The instructor cannot lock themselves out.** The owner and anyone with Administrator ignore overrides.

### Saved board presets

A preset stores a named set of overrides for **one board**. In **Board Permissions**, edit the overrides and choose **Save Edits as Preset**; saving does not apply them. **Apply** immediately replaces that board's overrides, including any unsaved edits in the dialog. Save a baseline preset to switch back. Other boards are unchanged.

Saving, applying, and deleting presets require Manage Boards in the room. Applying also checks the current roles and the manager's permission limits, so a saved preset cannot bypass a later permission change. Stale edits or a changed or deleted preset are rejected rather than overwriting newer settings. Presets use the existing permission calculation.

---

## 13. Membership, invites, bans, and timeouts

### Membership

A user becomes a member of a room by joining it, either through an invite or join code, or (for listed, open rooms) directly. Each membership records the user, their roles, when they joined, and any active timeout.

Today all of a room's members are stored as one array in a single document. With roles and timeouts per member, and a whole class joining at the start of a session, it is better to store **one membership document per user per room**. Joins then do not contend for the same document, and "which rooms am I in" becomes a simple query.

### Invites and join codes

Invites replace room PINs. An invite has:

- a short **code** that can be typed or shared as a link;
- the **roles** it grants on joining (by default the template's join role, such as Student);
- optional **expiry** and **maximum uses**;
- who created it.

An instructor can keep separate codes for students and TAs, or create a single-use code for a guest speaker.

### Removing and banning

**Removing** a member deletes their membership. They can rejoin if they have a valid invite. **Banning** removes them and adds them to the room's ban list, which blocks rejoining. Both need Manage Members and only work on members below you in the role order.

### Timeouts

A timeout temporarily removes a member's ability to participate without removing them from the class. Until it expires, the member keeps View Board and Download Assets but loses Create Apps, Edit Apps, Interact With Apps, Upload Assets, Annotate, Chat, Screenshare, and Present, regardless of roles or overrides. Timeouts need Moderate Members and expire on their own.

---

## 14. How apps interact with permissions

Apps are where most activity happens, so how permissions apply to them deserves the most care. There are three parts: what kind of change an update is, what an app type requires, and how people can use an app without editing it.

### Classifying changes to an app

An app document has general fields and a `state` object. The server classifies every update by the fields it touches:

| Fields | Permission needed |
|---|---|
| `position`, `size`, `rotation`, `raised`, `dragging` | Edit Apps, and the app must not be pinned |
| `title`, `state` | Edit Apps (or a declared action, below), and the app must not be locked unless you have Manage Apps |
| `pinned` | Edit Apps if you created the app, otherwise Manage Apps |
| `locked` | Manage Apps |
| `roomId`, `boardId`, `type` | Not changeable by an update. Moving an app to another board is a delete and a create, checked on both boards. |

An update touching several kinds of field needs all of the corresponding permissions.

### App types can require a permission

Each app type in the registry can declare a permission that is needed to create and use it:

- SageCell requires Execute Code;
- Chat and SageIdeator require Use AI;
- Screenshare and TwilioScreenshare require Screenshare;
- PluginApp requires Use Plugins.

The apps menu hides app types the user cannot create, and the server refuses to create them.

### Interacting without editing: app actions

Students often need to *use* an app without being able to *change* it: vote in a poll, tick a checklist, start a timer. A rule based on which fields are touched cannot express this. Poll shows why. Its state is:

```ts
{ poll: { question: string, options: [{ id: string, option: string, votes: number }] } }
```

A vote changes `votes` inside an option, right next to the `option` text, and the client sends the whole `poll` object back. From the server's point of view a vote and a rewrite of the question look the same. Nothing records who voted either, so the same person can vote repeatedly.

The solution is for **apps to declare named actions**, which the server runs:

- An app type can declare actions, such as Poll's `vote(optionId)`. Each action is a small function that takes the current state, the arguments, and who is calling it, and returns the new state.
- **Interact With Apps** lets you call an app's actions. **Edit Apps** lets you write its state directly.
- The server runs the action itself and writes the result atomically, using the same conditional-write mechanism the plugin SDK's server operations already use. Because the action runs on the server, it can also enforce rules of its own. Poll's `vote` can record the voter and refuse a second vote.
- **Apps without declared actions behave as they do today:** any change to them is an edit.

Action functions must be importable by the server, so they live alongside each app's schema in its `index.ts` (which the server already imports for types), not in the React component.

Adopting actions is incremental. Each app that needs student interaction gets its actions written one at a time. The first candidates are Poll, any checklist or to-do style app, and Timer. Poll's state will need a small migration to record voters.

This is the same model the plugin SDK already uses for server operations: named, permission-gated functions run on the server. Native apps and plugins end up on one mechanism instead of two.

---

## 15. Plugins

The plugin SDK already has its own permission layer: each plugin package declares capabilities, and the room owner approves them for the room. The new system fits around it:

- **Approval moves from "the room owner" to "anyone with Manage Plugins".** The owner still has it implicitly.
- **A plugin acts as the user running it.** Anything a plugin does on a board needs both the user's effective permission on that board *and* the plugin's approved capability. A plugin cannot give a student more than the student already has, and a student cannot use a plugin to do something the plugin was not approved for.
- **Plugin server operations map onto the same split as native apps.** Calling a plugin's declared operation needs Interact With Apps. Writing its state directly needs Edit Apps.
- **Plugins can see the user's permissions.** The plugin context exposes the user's effective permissions on the current board, so a plugin can hide controls the user cannot use, the same way native apps do.

---

## 16. Files

Files (assets) raise two separate questions. **Permissions decide who** can upload, open, delete, or share files. **Scope decides which files** someone can see at all. Both are needed. Permissions alone cannot stop Group 1 from opening a file uploaded to Group 2's private board, because today every file belongs to the whole room. The only permission-based fix would be denying Download Assets to Group 1 for the entire room, which would also block every file they legitimately need.

### Where a file belongs

- **A file belongs to the board it was uploaded on.** The server records that board when the file is uploaded. Anyone who can see that board and has Download Assets there can open the file, so board overrides apply to files exactly as they apply to apps.
- **A file can be shared with the whole room.** The file's owner, or someone with Manage Assets, can share it room-wide. This is for things every board needs: the syllabus, a dataset all groups use, the course logo. Any member whose roles give them Download Assets can open a room-wide file.
- **Placing a file on a different board shares it.** If a file is opened as an app on a board other than the one it belongs to, the people on that board would otherwise see an app whose file they cannot load. So placing it there shares the file with the room, which needs the file's owner or Manage Assets. Otherwise the server refuses.
- **The room's file list only shows files you can open.** Group 1 does not see Group 2's files in the list.

### Who can do what with a file

| Action | Needs |
|---|---|
| Upload | Upload Assets on the board |
| Open or download | Download Assets on the file's board, or on any board for a room-wide file |
| Rename or delete your own file | Nothing beyond being able to open it |
| Rename or delete someone else's file | Manage Assets on the file's board |
| Share a file with the whole room | Being the file's owner, or Manage Assets on the file's board |
| Make a room-wide file board-only again | Manage Assets |

Derived files, such as thumbnails and converted PDF pages, follow the same rules as the file they come from.

---

## 17. Enforcement

The server is the authority on every rule. The client computes the same permissions purely to decide what to show.

### Where checks happen

- **`SAGERouter` and `SAGEWSRouter`.** These already see almost every read, write, and subscription. They change from checking "role × action × collection" to resolving which room and board the request concerns and checking the user's effective permissions there.
- **Custom routes.** Routes outside the generic routers need explicit checks: the agent router (Use AI), the kernels router (Execute Code), room membership (Manage Members), and plugin upload and approval (Manage Plugins).
- **LiveKit.** Screenshare tokens are only issued to users with Screenshare on that board.
- **Files.** The file-serving route, the file list, and file deletion apply the rules from [section 16](#16-files), including for derived files such as thumbnails.

### Working out which room and board a request concerns

- **Creating a document:** the room and board come from the request body. The server also checks that the board belongs to that room, so a request cannot pair a board with a room it does not belong to.
- **Updating or deleting a document:** the server reads the existing document and uses *its* stored room and board, never the ones in the request. `roomId` and `boardId` cannot be changed by an update.
- **Room-level documents** (members, invites, roles, chat messages) are checked against room permissions only.

### Reads and subscriptions

Hiding a board in the UI is not enough. Its contents must not reach clients that cannot see it:

- Subscribing to a board's apps, annotations, links, or presence requires View Board on that board.
- The board list a user receives only contains boards they can view.
- When a user loses View Board, the server ends their subscriptions to that board and the client leaves it.
- Presence on a board is only sent to users with View Presence there.

### Caching

The permission calculation itself is cheap. What costs time is reading the room's roles, the board's overrides, and the user's membership for every request. The server keeps these documents in memory, using the change subscriptions homebase already has to keep them up to date, and recalculates permissions from them on each check. Caching the documents rather than the results means there is no separate cache to invalidate when a role changes.

---

## 18. Audit log

Moderation without a record of who did what goes badly in schools. Every room keeps an audit log that members with View Audit Log can read.

### What is recorded

- Role changes: created, edited (with which permissions changed), reordered, deleted.
- Role assignments: who gave or removed which role from whom.
- Board override changes, including the one-click moderation actions.
- Membership: joins (and the invite used), removals, bans, unbans, timeouts.
- Invites created and revoked.
- Room settings changes.
- Plugin uploads and approvals.
- Board creation, renaming, and deletion.
- Deletions of other people's apps through Manage Apps, and pinning, unpinning, locking, or unlocking other people's apps.
- Deletions and renames of other people's files through Manage Assets, and files shared with the whole room.
- Group rooms spun off from the class, recorded in the class room's log.

Ordinary activity, such as creating, editing, or moving apps, is not recorded in the audit log. It would dwarf everything else, and the log is about moderation, not activity tracking.

### What an entry contains

Each entry records when it happened, who did it, what kind of action it was, what it was done to (a role, a member, a board), and a short summary of the change, such as which permission bits were added and removed. Entries are written by the server as part of the same request that makes the change, so a change cannot happen without being logged.

### Retention

Entries are kept for **30 days** by default and then removed, so the log does not grow forever. The period is an instance setting, so an institution whose policy requires a longer or shorter record can change it.

---

## 19. Instance-level permissions and the old global roles

A few things are not about any one room: administering the server and being allowed to create rooms. These become **instance permissions**:

| Instance permission | What it allows |
|---|---|
| **Instance Admin** | Manage the server: users, templates published to everyone, server configuration. Also has every permission inside every room (see below). |
| **Create Rooms** | Create new rooms. |
| **Read-only** | Not a permission but a cap: the account can only view, in every room, whatever its roles say (see below). |

The old global roles map onto them as follows:

| Old global role | Becomes |
|---|---|
| `admin` | Instance Admin and Create Rooms |
| `user` | Create Rooms |
| `guest` | No instance permissions. In rooms they join, they get whatever their room roles give them. |
| `spectator` | Read-only. In rooms they join, they can view boards, open files, and see presence, and nothing else. |

The guest and spectator special cases in the UI go away and are replaced by permission checks and the read-only cap. LDAP's group-to-role mapping keeps working but maps groups to instance permissions only. It does not reach into rooms.

### Who can create rooms

Which accounts get Create Rooms is an **instance setting**. The default gives it to every regular account, which is today's behavior. An instance administrator can restrict it to selected accounts, for example staff identified by an LDAP group, so students cannot create rooms on their own.

Restricting it costs little for teaching, because instructors can spin off rooms for groups or individual students without those students ever needing Create Rooms (see [section 10](#10-groups)).

### Read-only accounts

Today a `spectator` is read-only everywhere, and spectator logins are useful precisely because of that, for example on display walls or for anonymous visitors. Without a special rule, a spectator who joined an Open collaboration room (which is what every existing room becomes) would suddenly be able to edit.

So accounts can be marked **read-only** at the instance level, and spectator logins always are. A read-only account is capped at View Board, Download Assets, and View Presence in every room. The cap is applied last, after roles and overrides, so no role, override, or Administrator grant inside a room can lift it. Only an instance administrator can change whether an account is read-only.

### Instance administrators inside rooms

Instance administrators have every permission in every room, as if they were the room's owner. Support requests and abuse reports regularly need someone to look inside a class and act there, and instance administrators are usually the people operating the server, who could reach the data anyway. Withholding this in the permission system would mostly get in the way of support.

What keeps this accountable is the audit log: **everything an instance administrator does inside a room is recorded in that room's audit log**, marked as an instance administrator action, so the instructor can always see it.

---

## 20. Data model

The shapes below are a sketch of what is stored, written as TypeScript types. Names may change during implementation. Following the project's preference for simple data structures, everything is plain arrays and numbers.

```ts
// A permission set is one number. Each permission is one bit.
type Permissions = number;

// Not stored: derived from the login on every request (provider, LDAP role, and the admins list).
type Account = {
  userId: string;
  instanceAdmin: boolean;
  createRooms: boolean;
  readOnly: boolean; // always true for spectator logins
};

// Stored on the room document.
type Role = {
  id: string; // @everyone's id is 'everyone'
  name: string;
  color: string;
  permissions: Permissions;
  group: boolean; // UI only
};

type RoomAccess = {
  // Ordered from lowest to highest. Index 0 is always @everyone.
  // The array order *is* the role hierarchy, so there is no position field.
  roles: Role[];
  bans: string[]; // user ids
};

// Stored on the board document.
type Override = {
  kind: 'role' | 'member';
  target: string; // role id or user id
  allow: Permissions;
  deny: Permissions;
};

type BoardAccess = {
  overrides: Override[];
  permissionPresets?: { id: string; name: string; overrides: Override[] }[];
};

// One document per user per room.
type Membership = {
  roomId: string;
  userId: string;
  roles: string[]; // role ids, not including @everyone
  timeoutUntil: number; // 0 when not timed out
  // The document's _createdAt is when the user joined. Its id is `${roomId}_${userId}`.
};

// One document per invite.
type Invite = {
  roomId: string;
  code: string;
  roles: string[];
  // The document's id is `${roomId}_${code}`, and _createdBy is who created it.
  expiresAt: number; // 0 for never
  maxUses: number; // 0 for unlimited
  uses: number;
};

// Added to the app document. `pinned` already exists and is now enforced by the server.
type AppAccess = {
  locked: boolean;
};

// Added to the asset document, which already records `owner` and `room`.
type AssetAccess = {
  board: string; // the board the file belongs to, or '' when shared with the whole room
};

// One document per entry.
type AuditEntry = {
  roomId: string;
  // The document's _createdAt and _createdBy say when and who.
  asInstanceAdmin: boolean; // true when `by` acted as an instance administrator
  action: string; // for example 'role.update', 'member.ban', 'board.override'
  target: string; // id of the role, member, board, or invite
  summary: string; // for example 'allowed Use AI, denied Chat'
};

// Shipped templates live in libs/shared; saved snapshots live in ROOMTEMPLATES.
type RoomTemplate = {
  id: string;
  name: string;
  description: string;
  roles: Role[];
  isPrivate: boolean; // joining needs an invite
  joinRoles: string[]; // roles the room's first invite grants
  groups: number; // group roles and group boards to create
  boards?: { name: string; description: string; color: string; overrides: Override[] }[];
  ownerId?: string; // saved templates only
  published?: boolean; // saved templates start private
};
```

The shared library (`libs/shared`) holds the permission bits, the calculation from [section 9](#9-computing-a-users-effective-permissions), and the field classification from [section 14](#14-how-apps-interact-with-permissions), so the server and the client use exactly the same code.

---

## 21. Migrating existing data

The migration must leave every existing room usable by the people who use it today.

- **Every existing room gets the Open collaboration template.** Its owner stays its owner. Everyone can keep doing what they can do today.
- **Existing members** each get a membership document with no roles beyond `@everyone`.
- **Room PINs become invite codes.** A private room's existing PIN is turned into an invite with that code, so people who know the PIN can still get in.
- **Private boards become overrides.** A board with a PIN gets `@everyone`: deny View Board, with allow overrides for the board's owner. The server has no record of who knew a board's PIN, so other people lose access to those boards until the owner or an administrator adds them. This is the one visible change from the migration and should be announced.
- **Global roles become instance permissions** as described in [section 19](#19-instance-level-permissions-and-the-old-global-roles).
- **Plugin approvals carry over unchanged.** The room owner who approved them still has Manage Plugins as owner.
- **Existing files are shared with the whole room**, which is how they behave today. Only files uploaded after the upgrade belong to a board by default.
- **Existing pins stay as they are**, but are now enforced by the server. Apps that are pinned today can only be unpinned by their creator or someone with Manage Apps. In Open collaboration rooms that is everyone, so nothing changes there.
- **Poll state** is migrated to record voters when Poll's actions are added. Existing vote counts are kept, with no voters recorded for them.

---

## 22. Implementation phases

Each phase can be released on its own, and the system is useful from phase 2 onward.

1. **Foundations.** The permission bits, the calculation, and their tests in `libs/shared`. The data model for roles, overrides, memberships, invites, and the audit log. Recording the board each new file is uploaded on. The migration to Open collaboration. Nothing changes for users yet.
2. **Server enforcement.** `SAGERouter`, `SAGEWSRouter`, and the custom routes check effective permissions. Subscriptions are filtered by View Board. Pins, locks, and the file rules are enforced. The audit log records changes. Templates (Classroom, Group work, Lecture, Open collaboration) are available when creating rooms, and the Create Rooms instance setting is available.
3. **Management UI.** Roles panel, member list with role assignment, board override editor, invites, bans, timeouts, and the audit log viewer. The client hides what the user cannot do.
4. **Groups and live moderation.** Groups panel, automatic group creation and assignment, spin-off group rooms, and the one-click moderation actions.
5. **App actions.** The action mechanism for native apps, Poll first, then other interactive apps. Plugin operations mapped onto Interact With Apps.
6. **Reusable setups.** Saved board presets and private or published room templates are implemented. Linked rooms remain deferred unless spin-off rooms prove insufficient.

---

## 23. Decisions so far

| Topic | Decision |
|---|---|
| Overall model | Follow Discord: per-room roles, additive permissions, per-board overrides, ordered roles, owner and Administrator bypass. |
| Hierarchy | Instance, room (a class), board, app. Nothing between instance and room for now. Multiple sections are multiple rooms. |
| Default roles | Not hard-coded. Shipped as templates that are copied into the room, which can then change them freely. |
| `@everyone` | The baseline every member has. In the teaching templates it is view-only, and participation comes from a Student role. |
| Edit Apps scope | Covers everyone's apps on the board, because classrooms are collaborative. Deleting others' apps and locking are Manage Apps. |
| Interact vs. edit | Both are in the first version, through app-declared actions run on the server. |
| Old global roles | `admin` becomes Instance Admin, `user` gets Create Rooms, `guest` and `spectator` lose their special meaning. LDAP maps to instance permissions only. |
| Private boards and PINs | Replaced by overrides (private boards) and invite codes (private rooms). |
| Audit log | Yes, covering moderation and permission changes, not ordinary activity. |
| Moving and resizing | Not a separate permission. Controlled by pinning instead: pinned apps cannot be moved or resized, you can pin and unpin your own apps, and pinning or unpinning others' needs Manage Apps. Enforced by the server. |
| Rooms for groups | Instructors spin off rooms for groups or individual students from the Groups panel. Group members get Administrator in their room, and the instructor stays the owner. Students do not need Create Rooms. |
| Who can create rooms | An instance setting. Defaults to every regular account (today's behavior), and can be restricted, for example to staff. |
| Templates | Copied into the room when applied. They do not stay linked. |
| View Presence | Included, so presence can be hidden for exams and anonymous activities. |
| Spectator logins | Stay read-only everywhere, through an instance-level read-only cap that no room setting can lift. |
| Instance administrators | Have every permission in every room. Everything they do in a room is recorded in that room's audit log. |
| Audit log retention | 30 days by default, configurable per instance. |
| Files | Belong to the board they were uploaded on, and can be shared with the whole room on purpose. A new Manage Assets permission covers deleting, renaming, and sharing other people's files. Existing files stay room-wide. |

---

## 24. Open questions

All questions raised so far have been decided and are listed in [section 23](#23-decisions-so-far). New questions will be collected here as they come up.

---

## 25. Implementation notes

The system is implemented as described above, with the details and the few deviations recorded here.

### Where the code lives

- **`libs/shared/src/lib/permissions`:** the permission bits, the calculation, the role and override change rules, and the shipped templates. The server and the client import the same code.
- **`libs/backend/src/lib/generics/permissions.ts`:** resolves the account from the login and computes a user's room and board permissions from the stored room, board and membership.
- **`libs/backend/src/lib/generics/SAGECollection.ts`:** every collection has an access policy (create, read, update, delete). The default refuses everything, so a collection without rules is closed. The REST and WebSocket routers both go through the same checked operations.
- **`apps/homebase/src/api/collections`:** each collection's rules, the membership, invite and audit collections, and the startup migration (`migrate-permissions.ts`).
- **Frontend:** `usePermissions.ts` (hooks), the room settings and board permissions dialogs in `ui/components/permissions`, and the group helpers in `utils/groups.ts`.
- **Templates:** `roomtemplates.ts` stores snapshots and implements the checked `/rooms/templates`, `/rooms/:id/templates`, and `/rooms/from-template` endpoints. Room creation runs on the server, including owner membership, empty boards, and the initial invite. A failed setup attempts to remove its partial records before returning an error.

### Changes that cannot interleave

- **Roles and overrides** are saved through `POST /rooms/:id/roles` and `POST /boards/:id/overrides`, which take the version the edit started from. The server checks the change against that version and commits only while it is still current, so of two people editing at once, one gets "changed by someone else" instead of silently overwriting the other. The generic update route does not accept these fields.
- **Joining** creates the membership with a create-only write before counting the invite use with compare-and-swap. A double click cannot spend two uses, and a refused use removes the membership again.
- **Ban lists, member roles and app actions** commit with compare-and-swap. Actions retry on the new state when they lose a race.
- **Board presets** use compare-and-swap for the saved list and, when applying, the current overrides. A stale request fails instead of overwriting a newer edit. Save, apply, and delete operations are audited. Template publication also uses compare-and-swap.

### Checks and caching

Permissions are recomputed on every request from cached results that are cleared whenever any room, board or membership changes, so a change applies to the next request. Results for timed-out members are never cached, because a timeout ends without anything changing.

Subscriptions only pass on documents the subscriber may read, checked in order. When an update makes a document unreadable (a board is hidden, for example), the subscriber receives a deletion carrying only the id, so its view drops the board without seeing the new contents.

### Other entry points

- **Yjs:** documents are checked when connecting and on every message. Whiteboards need Annotate to write, and app text and drawings need Edit Apps. Writes from people without the permission are dropped, and the connection closes when the person can no longer see the board.
- **Files:** uploads need Upload Assets on the board they come from, or in the room for files uploaded outside a board. A refused upload's files are deleted. The direct file URLs (`/api/assets/static/...` and the public share links) stay capability URLs: their names cannot be guessed, and what the permissions control is finding them (the file list and the apps that show them).
- **AI requests** carry the board they come from, and need Use AI there.
- **Kernels:** creating one needs Execute Code on its board. Running, restarting, interrupting or deleting one looks its board up from the kernel service, and a private kernel is only its owner's.
- **Screenshare:** joining a board's LiveKit room needs View Board; the token allows publishing only with Screenshare.
- **Plugins:** the context passed to plugins now includes the user's permissions on the board, as names such as `EditApps`.
- **Accounts:** a user document's `userRole` is now set by the server from the login when the account is created, never by the client.

### Known limitations

- **Locks and Yjs text.** Locking an app protects its state and title, but text edited through Yjs (code editors, notes) lives in one shared document per board, so the lock cannot be applied to it. Edit Apps on the board still is.
- **The audit log** is written right after each change, in the same request, but not in the same transaction. A crash between the change and the entry would lose the entry.
- **Chat** is a permission without anything to gate yet. SAGE3 has no room chat, and the Party chat is shared by the whole instance rather than a room. Timeouts already include it.
- **Only Poll has actions so far.** Other apps that students should use without editing need their actions written the same way.
- **Not built yet:** linked rooms (see [section 22](#22-implementation-phases)). Templates create new rooms; they do not overwrite existing rooms.
- **Unchanged:** the `/rtc` screen pixel relay in the Yjs service accepts connections without signing in, as before.
- **Guest accounts** are still deleted when the server starts, as before. Their memberships stay behind, but grant nothing to anyone else.
