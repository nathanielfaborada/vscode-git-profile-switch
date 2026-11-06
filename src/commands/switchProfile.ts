import * as vscode from 'vscode';
import { GitProfile } from '../types';
import { ProfileStorage } from '../services/storageService';
import { SyncCoordinator } from '../sync/syncCoordinator';

interface SwitchQuickPickItem extends vscode.QuickPickItem {
  action: 'switch' | 'add' | 'edit' | 'delete' | 'sync' | 'organize' | 'verify' | 'openFolder';
  profile?: GitProfile;
}

export function registerSwitchCommand(
  storage: ProfileStorage,
  coordinator: SyncCoordinator
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.switch', async () => {
    const profiles = await storage.getProfiles();
    const activeProfile = await storage.getActiveProfile();

    const items: SwitchQuickPickItem[] = [];

    for (const p of profiles) {
      const isCurrent = activeProfile?.id === p.id;
      const token = await storage.getToken(p.id);
      const profileDir = storage.getProfileDirectory(p);
      items.push({
        label: `${isCurrent ? '$(check) ' : ''}${p.icon} ${p.label}`,
        description: `${p.gitName} <${p.gitEmail}>`,
        detail: `PortableGit/${p.githubUsername} • ${token ? 'PAT Ready ✓' : 'No PAT Token'} • Orgs: ${p.autoMatchOwners.join(', ') || 'None'} (${profileDir})`,
        action: 'switch',
        profile: p,
      });
    }

    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator, action: 'switch' },
      {
        label: '$(repo-clone) Sync & Auto-Clone All GitHub Repos for Active Profile',
        description: `Clone missing repos into PortableGit/${activeProfile?.githubUsername || '<user>'}`,
        action: 'sync',
      },
      {
        label: '$(folder-library) Organize Existing PortableGit Repos into Profile Folders',
        description: 'Move standalone repos into PortableGit/<username>/<repo>',
        action: 'organize',
      },
      {
        label: '$(folder-opened) Open Active Profile Folder in Explorer',
        description: activeProfile ? storage.getProfileDirectory(activeProfile) : '',
        action: 'openFolder',
      },
      { label: '', kind: vscode.QuickPickItemKind.Separator, action: 'switch' },
      {
        label: '$(add) Add New Git Profile (Create)',
        description: 'Create a new Git author + GitHub account profile',
        action: 'add',
      },
      {
        label: '$(edit) Edit Existing Profile (Update)',
        description: 'Update name, email, PAT token, or auto-match organizations',
        action: 'edit',
      },
      {
        label: '$(trash) Delete Profile (Delete)',
        description: 'Remove a profile and its saved token',
        action: 'delete',
      },
      {
        label: '$(verified) Verify Active Identity & GitHub Token',
        description: 'Check commit author, push credentials, and GitHub API status',
        action: 'verify',
      }
    );

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Git Profile & PortableGit Workspace Switcher',
      placeHolder: 'Select a profile to switch dynamically or choose a management action',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) {
      return;
    }

    if (selected.action === 'switch' && selected.profile) {
      const config = vscode.workspace.getConfiguration('gitProfileSwitch');
      const autoClone = config.get<boolean>('autoCloneOnSwitch', true);
      await coordinator.enforceDynamicSync(selected.profile, {
        syncRemoteRepos: autoClone,
        promptOpenFolder: true,
      });
      if (!autoClone) {
        vscode.window.showInformationMessage(
          `Switched dynamically to ${selected.profile.label} (${selected.profile.gitName} <${selected.profile.gitEmail}>).`
        );
      }
    } else if (selected.action === 'add') {
      await vscode.commands.executeCommand('gitProfileSwitch.add');
    } else if (selected.action === 'edit') {
      await vscode.commands.executeCommand('gitProfileSwitch.edit');
    } else if (selected.action === 'delete') {
      await vscode.commands.executeCommand('gitProfileSwitch.delete');
    } else if (selected.action === 'sync') {
      await vscode.commands.executeCommand('gitProfileSwitch.syncRepos');
    } else if (selected.action === 'organize') {
      await vscode.commands.executeCommand('gitProfileSwitch.organizeExisting');
    } else if (selected.action === 'verify') {
      await vscode.commands.executeCommand('gitProfileSwitch.verify');
    } else if (selected.action === 'openFolder') {
      await vscode.commands.executeCommand('gitProfileSwitch.openProfileFolder');
    }
  });
}
