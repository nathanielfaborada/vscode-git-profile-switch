import * as vscode from 'vscode';
import { GitProfile } from '../types';
import { ProfileStorage } from '../services/storageService';
import { GitHubService } from '../services/githubService';
import { SyncCoordinator } from '../sync/syncCoordinator';
import { StatusBarManager } from '../ui/statusBar';

export function registerAddCommand(
  storage: ProfileStorage,
  githubService: GitHubService,
  coordinator: SyncCoordinator,
  statusBar: StatusBarManager
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.add', async () => {
    const label = await vscode.window.showInputBox({
      title: 'Add Git Profile (1/6): Profile Label',
      prompt: 'Enter a display name for this profile (e.g., "Jane Personal", "PowerTractire")',
      placeHolder: 'e.g., Jane Personal',
      validateInput: (val) => (!val.trim() ? 'Profile label is required' : null),
    });
    if (!label) {
      return;
    }

    const iconPick = await vscode.window.showQuickPick(
      [
        { label: '$(account) Personal Account', icon: '$(account)' },
        { label: '$(organization) Company / Organization Account', icon: '$(organization)' },
      ],
      {
        title: 'Add Git Profile (2/6): Account Type Icon',
        placeHolder: 'Choose an icon for the status bar',
      }
    );
    if (!iconPick) {
      return;
    }

    const githubUsername = await vscode.window.showInputBox({
      title: 'Add Git Profile (3/6): GitHub Username',
      prompt: 'Enter the GitHub username (used for PortableGit/<username> folder and push auth)',
      placeHolder: 'e.g., nathanielfaborada or jane',
      validateInput: (val) => (!val.trim() ? 'GitHub username is required' : null),
    });
    if (!githubUsername) {
      return;
    }

    const resolvedIdentity = await githubService.fetchGitHubUserIdentity(githubUsername.trim());
    const canonicalLogin = resolvedIdentity?.login || githubUsername.trim();
    const defaultEmail =
      resolvedIdentity?.noreplyEmail || `${canonicalLogin}@users.noreply.github.com`;

    const gitName = await vscode.window.showInputBox({
      title: 'Add Git Profile (4/6): Git Commit Author Name (user.name)',
      prompt: 'Enter the exact name to record in Git commits',
      value: canonicalLogin,
      validateInput: (val) => (!val.trim() ? 'Git author name is required' : null),
    });
    if (!gitName) {
      return;
    }

    const gitEmail = await vscode.window.showInputBox({
      title: 'Add Git Profile (5/6): Git Commit Author Email (user.email)',
      prompt:
        'GitHub-bound noreply email is pre-filled so GitHub always attributes commits to this exact account',
      value: defaultEmail,
      placeHolder: defaultEmail,
      validateInput: (val) =>
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())
          ? 'Please enter a valid email address'
          : null,
    });
    if (!gitEmail) {
      return;
    }

    const token = await vscode.window.showInputBox({
      title: 'Add Git Profile (6/6): GitHub Personal Access Token (PAT)',
      prompt: 'Enter GitHub PAT for pushing & cloning private/org repos (Encrypted in SecretStorage)',
      placeHolder: 'e.g., ghp_token (Leave blank for public-only)',
      password: true,
    });

    const orgsInput = await vscode.window.showInputBox({
      title: 'Optional: Auto-Match GitHub Organizations / Owners',
      prompt: 'Comma-separated GitHub orgs/users that belong to this profile',
      value: githubUsername.trim(),
      placeHolder: 'e.g., Power-Tractire-Inc, Track-Speed',
    });

    const id = githubUsername
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');

    const autoMatchOwners = (orgsInput || githubUsername)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const now = new Date().toISOString();
    const newProfile: GitProfile = {
      id,
      label: label.trim(),
      icon: iconPick.icon,
      gitName: gitName.trim(),
      gitEmail: gitEmail.trim(),
      githubUsername: githubUsername.trim(),
      autoMatchOwners,
      includeForks: false,
      createdAt: now,
      updatedAt: now,
    };

    await storage.upsertProfile(newProfile, token);

    const switchNow = await vscode.window.showInformationMessage(
      `Profile "${newProfile.label}" created! Switch to this profile and sync PortableGit/${newProfile.githubUsername} now?`,
      'Switch & Sync All Repos',
      'Switch Only',
      'Later'
    );

    if (switchNow === 'Switch & Sync All Repos') {
      await coordinator.enforceDynamicSync(newProfile, { syncRemoteRepos: true, promptOpenFolder: true });
    } else if (switchNow === 'Switch Only') {
      await coordinator.enforceDynamicSync(newProfile, { syncRemoteRepos: false, promptOpenFolder: true });
    } else {
      await statusBar.refresh(coordinator.getCurrentWorkspacePath());
    }
  });
}
