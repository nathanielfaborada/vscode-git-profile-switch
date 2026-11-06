import * as vscode from 'vscode';
import { ProfileStorage } from '../services/storageService';
import { SyncCoordinator } from '../sync/syncCoordinator';

export function registerSyncReposCommand(
  storage: ProfileStorage,
  coordinator: SyncCoordinator
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.syncRepos', async () => {
    const active = await storage.getActiveProfile();
    if (!active) {
      vscode.window.showWarningMessage('Please select or create a Git profile first.');
      return;
    }

    await coordinator.enforceDynamicSync(active, { syncRemoteRepos: true, promptOpenFolder: true });
  });
}
