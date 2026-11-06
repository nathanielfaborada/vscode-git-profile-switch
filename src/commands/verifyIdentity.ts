import * as vscode from 'vscode';
import { ProfileStorage } from '../services/storageService';
import { GitService } from '../services/gitService';
import { GitHubService } from '../services/githubService';
import { SyncCoordinator } from '../sync/syncCoordinator';

export function registerVerifyIdentityCommand(
  storage: ProfileStorage,
  gitService: GitService,
  githubService: GitHubService,
  coordinator: SyncCoordinator
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.verify', async () => {
    const currentWorkspace = coordinator.getCurrentWorkspacePath();
    const active = await storage.getActiveProfile();
    const identity = await gitService.getActiveIdentity(currentWorkspace);

    if (!active) {
      vscode.window.showWarningMessage('No active Git profile selected.');
      return;
    }

    const token = await storage.getToken(active.id);
    let tokenStatus = 'No PAT Token configured (Public HTTPS / Credential Manager mode)';

    if (token) {
      try {
        const verified = await githubService.verifyToken(token);
        tokenStatus = `Verified GitHub API User: @${verified.login} (Scopes: ${verified.scopes || 'fine-grained'})`;
      } catch (err) {
        tokenStatus = `Token check failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    const profileDir = storage.getProfileDirectory(active);
    vscode.window.showInformationMessage(
      `Active Profile: ${active.label} | Commit Author: ${identity.userName} <${identity.userEmail}> | Push Account: ${active.githubUsername} | ${tokenStatus} | Folder: ${profileDir}`,
      { modal: true }
    );
  });
}
