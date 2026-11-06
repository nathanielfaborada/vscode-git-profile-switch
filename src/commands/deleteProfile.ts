import * as vscode from 'vscode';
import { ProfileStorage } from '../services/storageService';
import { SyncCoordinator } from '../sync/syncCoordinator';
import { StatusBarManager } from '../ui/statusBar';

export function registerDeleteCommand(
  storage: ProfileStorage,
  coordinator: SyncCoordinator,
  statusBar: StatusBarManager
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.delete', async () => {
    const profiles = await storage.getProfiles();
    if (profiles.length === 0) {
      vscode.window.showWarningMessage('No profiles available to delete.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      profiles.map((p) => ({
        label: `${p.icon} ${p.label}`,
        description: `${p.gitName} <${p.gitEmail}>`,
        profile: p,
      })),
      {
        title: 'Delete Git Profile',
        placeHolder: 'Select a profile to remove',
      }
    );
    if (!picked) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete profile "${picked.profile.label}" (${picked.profile.githubUsername}) and remove its stored token? (Local repository files in PortableGit/${picked.profile.githubUsername} will NOT be deleted.)`,
      { modal: true },
      'Delete Profile'
    );
    if (confirm !== 'Delete Profile') {
      return;
    }

    await storage.deleteProfile(picked.profile.id);
    const nextActive = await storage.getActiveProfile();
    if (nextActive) {
      await coordinator.enforceDynamicSync(nextActive, { syncRemoteRepos: false, promptOpenFolder: false });
    } else {
      await statusBar.refresh(coordinator.getCurrentWorkspacePath());
    }

    vscode.window.showInformationMessage(`Deleted profile "${picked.profile.label}".`);
  });
}
