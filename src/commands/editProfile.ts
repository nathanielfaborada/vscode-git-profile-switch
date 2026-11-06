import * as vscode from 'vscode';
import { ProfileStorage } from '../services/storageService';
import { SyncCoordinator } from '../sync/syncCoordinator';
import { StatusBarManager } from '../ui/statusBar';

export function registerEditCommand(
  storage: ProfileStorage,
  coordinator: SyncCoordinator,
  statusBar: StatusBarManager
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.edit', async () => {
    const profiles = await storage.getProfiles();
    if (profiles.length === 0) {
      vscode.window.showWarningMessage('No profiles found to edit.');
      return;
    }

    const picked = await vscode.window.showQuickPick(
      profiles.map((p) => ({
        label: `${p.icon} ${p.label}`,
        description: `${p.gitName} <${p.gitEmail}>`,
        detail: `GitHub: ${p.githubUsername} | Orgs: ${p.autoMatchOwners.join(', ')}`,
        profile: p,
      })),
      {
        title: 'Edit Git Profile: Select Profile',
        placeHolder: 'Choose a profile to update',
      }
    );
    if (!picked) {
      return;
    }

    const target = { ...picked.profile };
    const fieldPick = await vscode.window.showQuickPick(
      [
        { label: '$(tag) Edit Display Label & Icon', field: 'label' },
        { label: '$(person) Edit Git Commit Author (user.name & user.email)', field: 'author' },
        { label: '$(mark-github) Edit GitHub Username', field: 'username' },
        { label: '$(key) Update / Rotate Personal Access Token (PAT)', field: 'token' },
        { label: '$(organization) Edit Auto-Match Organizations/Owners', field: 'orgs' },
      ],
      {
        title: `Editing "${target.label}"`,
        placeHolder: 'Select what you want to update',
      }
    );
    if (!fieldPick) {
      return;
    }

    let newToken: string | undefined;

    if (fieldPick.field === 'label') {
      const newLabel = await vscode.window.showInputBox({
        title: 'Update Display Label',
        value: target.label,
        validateInput: (v) => (!v.trim() ? 'Label cannot be empty' : null),
      });
      if (!newLabel) {
        return;
      }
      target.label = newLabel.trim();
    } else if (fieldPick.field === 'author') {
      const newName = await vscode.window.showInputBox({
        title: 'Update Git Commit Author Name (user.name)',
        value: target.gitName,
        validateInput: (v) => (!v.trim() ? 'Name cannot be empty' : null),
      });
      if (!newName) {
        return;
      }
      const newEmail = await vscode.window.showInputBox({
        title: 'Update Git Commit Author Email (user.email)',
        value: target.gitEmail,
        validateInput: (v) =>
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? 'Invalid email format' : null,
      });
      if (!newEmail) {
        return;
      }
      target.gitName = newName.trim();
      target.gitEmail = newEmail.trim();
    } else if (fieldPick.field === 'username') {
      const newUser = await vscode.window.showInputBox({
        title: 'Update GitHub Username',
        value: target.githubUsername,
        validateInput: (v) => (!v.trim() ? 'Username cannot be empty' : null),
      });
      if (!newUser) {
        return;
      }
      target.githubUsername = newUser.trim();
    } else if (fieldPick.field === 'token') {
      const tokenInput = await vscode.window.showInputBox({
        title: `Update Personal Access Token for ${target.githubUsername}`,
        prompt: 'Enter new GitHub PAT or leave blank to clear token',
        password: true,
        placeHolder: 'e.g., ghp_token',
      });
      if (tokenInput === undefined) {
        return;
      }
      if (tokenInput.trim() === '') {
        await storage.deleteToken(target.id);
      } else {
        newToken = tokenInput.trim();
      }
    } else if (fieldPick.field === 'orgs') {
      const orgsInput = await vscode.window.showInputBox({
        title: 'Update Auto-Match GitHub Organizations / Owners',
        prompt: 'Comma-separated list of GitHub owners/orgs',
        value: target.autoMatchOwners.join(', '),
      });
      if (orgsInput === undefined) {
        return;
      }
      target.autoMatchOwners = orgsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    await storage.upsertProfile(target, newToken);

    const activeId = storage.getActiveProfileId();
    if (activeId === target.id) {
      await coordinator.enforceDynamicSync(target, { syncRemoteRepos: false, promptOpenFolder: false });
    } else {
      await statusBar.refresh(coordinator.getCurrentWorkspacePath());
    }

    vscode.window.showInformationMessage(`Updated profile "${target.label}" successfully.`);
  });
}
