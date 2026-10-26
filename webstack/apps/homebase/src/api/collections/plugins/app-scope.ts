import type { App } from '@sage3/applications/schema';
import type { SBNestedCondition } from '@sage3/sagebase';

/** Commit against the app that was authorized, not an ID since moved or reassigned by a native client. */
export function pluginAppConditions(app: App): readonly SBNestedCondition[] {
  const conditions: SBNestedCondition[] = [
    { segments: ['type'], value: app.data.type },
    { segments: ['boardId'], value: app.data.boardId },
    { segments: ['roomId'], value: app.data.roomId },
  ];

  if (app.data.type === 'PluginApp') {
    conditions.push(
      { segments: ['state', 'pluginId'], value: app.data.state.pluginId },
      { segments: ['state', 'viewId'], value: app.data.state.viewId },
    );
  }

  if (app.data.type === 'PDFViewer') {
    conditions.push(
      { segments: ['state', 'assetid'], value: app.data.state.assetid },
      { segments: ['state', 'numPages'], value: app.data.state.numPages },
    );
  }

  return conditions;
}
