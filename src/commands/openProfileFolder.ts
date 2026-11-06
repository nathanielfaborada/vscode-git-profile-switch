import * as vscode from 'vscode';
import { ProfileStorage } from '../services/storageService';
import { SyncCoordinator } from '../sync/syncCoordinator';

export function registerOpenProfileFolderCommand(
  storage: ProfileStorage,
  coordinator: SyncCoordinator
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.openProfileFolder', async () => {
    const active = await storage.getActiveProfile();
    if (!active) {
      vscode.window.showWarningMessage('No active Git profile selected.');
      return;
    }
    const profileDir = storage.getProfileDirectory(active);
    await coordinator.switchExplorerToProfileFolder(active, profileDir, false);
  });
}
