/**
 * Copyright (c) SAGE3 Development Team 2022. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

/**
 * Asset API Service
 * @file User Service
 * @author <a href="mailto:rtheriot@hawaii.edu">Ryan Theriot</a>
 * @version 1.0.0
 */

import { Asset } from '@sage3/shared/types';
import { APIHttp } from './api-http';

async function readAll(): Promise<Asset[] | undefined> {
  const response = await APIHttp.GET<Asset>('/assets');
  return response.data;
}

async function del(id: Asset['_id']): Promise<boolean> {
  const response = await APIHttp.DELETE('/assets/' + id);
  return response.success;
}

/**
 * A public share link for a file. The server issues it only to someone who may download the file.
 */
export async function publicFileURL(id: Asset['_id']): Promise<string | undefined> {
  try {
    const response = await fetch(`/api/assets/${id}/link`, { credentials: 'include' });
    const result = await response.json();
    return result.success ? `${window.location.origin}/api/files/${id}/${result.data.token}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The files of a saved session: the apps' files the user may download, with public links.
 */
export async function sessionAssets(apps: { data: { state: object } }[], assets: Asset[]): Promise<{ id: string; url: string; filename: string }[]> {
  const files: { id: string; url: string; filename: string }[] = [];
  for (const app of apps) {
    const id = (app.data.state as { assetid?: string }).assetid;
    const asset = id ? assets.find((a) => a._id === id) : undefined;
    const url = asset && (await publicFileURL(asset._id));
    if (asset && url) files.push({ id: asset._id, url, filename: asset.data.originalfilename });
  }
  return files;
}

/**
 * Asset HTTP Service.
 * Provides POST, GET, DELETE requests to the backend.
 */
export const AssetHTTPService = {
  readAll,
  del,
};
