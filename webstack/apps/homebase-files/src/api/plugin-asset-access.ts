import * as path from 'path';
import { promises as fs } from 'fs';
import type { Asset, Board, Plugin } from '@sage3/shared/types';
import type { SBAuthSchema } from '@sage3/sagebase';
import { boardPermissionsOf, roomPermissionsOf } from '@sage3/backend/permissions';
import { has, Permission } from '@sage3/shared';

export class PluginAssetRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function requirePluginAssetAccess(
  plugin: Plugin | undefined,
  board: Board | undefined,
  user: SBAuthSchema,
  digest: string | undefined,
  action: 'GET' | 'POST',
): Promise<{ roomId: string; boardId: string }> {
  if (!plugin || !board || !plugin.data.roomId || plugin.data.roomId !== board.data.roomId) {
    throw new PluginAssetRequestError('Extension or board not found in this room.', 404);
  }
  const needed = action === 'GET' ? Permission.ViewBoard : Permission.UploadAssets;
  if (!has(await boardPermissionsOf(user, board._id), needed)) {
    throw new PluginAssetRequestError('Permission denied.', 403);
  }

  const packaged = plugin.data.package;
  const capability = action === 'GET' ? 'assets.read' : 'assets.write';
  if (
    !packaged ||
    packaged.digest !== digest ||
    plugin.data.boardGrants?.[board._id] !== packaged.digest ||
    !packaged.manifest.capabilities.includes(capability)
  ) {
    throw new PluginAssetRequestError('Extension is unavailable or lacks asset access.', 403);
  }

  return { roomId: plugin.data.roomId, boardId: board._id };
}

export async function pluginAssetFile(
  asset: Asset,
  roomId: string,
  root: string,
  page: number | undefined,
  user: SBAuthSchema,
): Promise<{ path: string; mimeType: string }> {
  // A plugin reading a file's bytes is a download: the user's own file, or Download Others' Files.
  const permissions = asset.data.board ? await boardPermissionsOf(user, asset.data.board) : await roomPermissionsOf(user, asset.data.room);
  if (asset.data.room !== roomId || (asset.data.owner !== user.id && !has(permissions, Permission.DownloadOthersAssets))) {
    throw new PluginAssetRequestError('Asset not found.', 404);
  }

  const data = asset.data;
  let filename = data.file;
  let mimeType = data.mimetype;
  if (page !== undefined) {
    if (data.mimetype !== 'application/pdf' || !Array.isArray(data.derived)) {
      throw new PluginAssetRequestError('Invalid PDF page.');
    }
    const images = data.derived[page];
    if (!images?.length) {
      throw new PluginAssetRequestError('PDF page not found.', 404);
    }

    const image = images.reduce((largest, candidate) => (candidate.width > largest.width ? candidate : largest));
    const expected = `${path.parse(data.file).name}-${page}-${image.width}.webp`;
    if (image.url !== `api/assets/static/${expected}` && image.url !== `/api/assets/static/${expected}`) {
      throw new PluginAssetRequestError('PDF page not found.', 404);
    }
    filename = expected;
    mimeType = 'image/webp';
  }

  // Asset records are writable through generic routes, so the file must resolve directly inside root.
  try {
    const directory = await fs.realpath(root);
    const resolved = await fs.realpath(path.join(directory, filename));
    if (path.dirname(resolved) !== directory) {
      throw new PluginAssetRequestError('Asset not found.', 404);
    }

    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      throw new PluginAssetRequestError('Asset not found.', 404);
    }

    return { path: resolved, mimeType };
  } catch (error) {
    if (error instanceof PluginAssetRequestError) {
      throw error;
    }

    throw new PluginAssetRequestError('Asset not found.', 404);
  }
}
