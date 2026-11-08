/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

/**
 * The asset database model.
 *
 * @author <a href="mailto:renambot@uic.edu">Luc Renambot</a>
 * @version 1.0.0
 */

// SAGE3 modules
import { AssetSchema } from '@sage3/shared/types';
import { SAGE3Collection, sageRouter, boardPermissionsOf, fileToken, guarded, readBoard, readRoom, roomPermissionsOf } from '@sage3/backend';
import { SBAuthSchema, SBDocument } from '@sage3/sagebase';
import { has, Permission as P } from '@sage3/shared';

import { deny, refuse } from './access';
import { AuditCollection } from './audit';

/**
 * Permissions on a file: those of the board it belongs to, or the room's for a room-wide file.
 */
export function filePermissionsOf(auth: SBAuthSchema, asset: AssetSchema): Promise<number> {
  return asset.board ? boardPermissionsOf(auth, asset.board) : roomPermissionsOf(auth, asset.room);
}

class SAGE3AssetsCollection extends SAGE3Collection<AssetSchema> {
  constructor() {
    super('ASSETS', { file: '', room: '', owner: '' });
    this.access = {
      // The files service creates asset documents when files are uploaded.
      create: refuse,
      // Apps on a board show its files, so whoever sees the board sees their records. Browsing other
      // people's files is a filter in the library, and downloading their originals is checked by the files service.
      read: async (auth, doc) => doc.data.owner === auth.id || has(await filePermissionsOf(auth, doc.data), P.ViewBoard),
      update: (auth, doc, update) => this.checkUpdate(auth, doc, update),
      delete: async (auth, doc) => {
        if (doc.data.owner !== auth.id && !has(await filePermissionsOf(auth, doc.data), P.ManageOthersAssets)) deny();
      },
      written: (auth, before, after) => this.audit(auth, before, after),
    };
    const router = sageRouter<AssetSchema>(this);

    // A share link opens the original without signing in, so it needs the right to download it.
    router.get(
      '/:id/link',
      guarded(async ({ params, user }, res) => {
        const auth = user as SBAuthSchema;
        const asset = await this.get(String(params.id));
        if (!asset) deny('File not found.', 404);
        if (asset.data.owner !== auth.id && !has(await filePermissionsOf(auth, asset.data), P.DownloadOthersAssets)) deny();
        res.status(200).send({ success: true, data: { token: fileToken(asset._id) } });
      })
    );

    this.httpRouter = router;
  }

  private async checkUpdate(auth: SBAuthSchema, doc: SBDocument<AssetSchema>, update: Partial<AssetSchema>) {
    const permissions = await filePermissionsOf(auth, doc.data);
    // Renaming or sharing your own file is always allowed; other people's need Manage Others' Files.
    const mayChange = doc.data.owner === auth.id || has(permissions, P.ManageOthersAssets);
    for (const key of Object.keys(update)) {
      if (key === 'originalfilename') {
        if (!mayChange) deny();
      } else if (key === 'board') {
        if (update.board === '') {
          // Share with the whole room.
          if (!mayChange) deny();
        } else {
          // Make it belong to one board again.
          const board = await readBoard(update.board as string);
          if (!board || board.data.roomId !== doc.data.room) deny('Board not found in this room.', 404);
          if (!has(permissions, P.ManageOthersAssets) || !has(await boardPermissionsOf(auth, board._id), P.ManageOthersAssets)) deny();
        }
      } else {
        deny(`${key} cannot be changed.`);
      }
    }
  }

  private async audit(auth: SBAuthSchema, before: SBDocument<AssetSchema> | undefined, after: SBDocument<AssetSchema> | undefined) {
    const asset = (after ?? before)!;
    let summary = '';
    if (before && after && before.data.board && !after.data.board) summary = `shared ${asset.data.originalfilename} with the room`;
    else if (asset.data.owner !== auth.id && !after) summary = `deleted ${asset.data.originalfilename}`;
    else if (asset.data.owner !== auth.id && before && after && before.data.originalfilename !== after.data.originalfilename) {
      summary = `renamed ${before.data.originalfilename} to ${after.data.originalfilename}`;
    }
    if (!summary) return;
    const room = await readRoom(asset.data.room);
    if (room) await AuditCollection.record(auth, room, 'file.update', asset._id, summary);
  }

  // Delete all the assets of a specific user
  public async deleteUsersAssets(userId: string): Promise<number> {
    // Delete the assets of the user
    const userAssets = await this.query('owner', userId);
    const assetsIds = userAssets ? userAssets.map((asset) => asset._id) : [];
    const assetsDeleted = await this.deleteBatch(assetsIds);
    return assetsDeleted ? assetsDeleted.length : 0;
  }

  // Delete all the assets in a specific room
  public async deleteAssetsInRoom(roomId: string): Promise<number> {
    // Delete the assets on the room
    const roomAssets = await this.query('room', roomId);
    const assetIds = roomAssets ? roomAssets.map((asset) => asset._id) : [];
    const assetsDeleted = await this.deleteBatch(assetIds);
    return assetsDeleted ? assetsDeleted.length : 0;
  }

  // Transfer all the assets of a user to another user
  public async transferUsersAssets(oldUserId: string, newOwner: string): Promise<boolean> {
    // Get all the assets of the user
    const userAssets = await this.query('owner', oldUserId);
    const assetsIds = userAssets ? userAssets.map((asset) => asset._id) : [];
    // Update the owner field of the assets
    const assetsUpdated = await Promise.all(assetsIds.map((assetId) => this.update(assetId, newOwner, { owner: newOwner })));
    return assetsUpdated ? true : false;
  }
}

export const AssetsCollection = new SAGE3AssetsCollection();
