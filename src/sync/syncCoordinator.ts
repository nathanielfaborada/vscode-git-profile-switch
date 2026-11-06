import * as vscode from 'vscode';
import * as fs from 'fs';
import { GitProfile, SyncOptions } from '../types';
import { ProfileStorage } from '../services/storageService';
import { GitService } from '../services/gitService';
import { GitHubService } from '../services/githubService';
import { StatusBarManager } from '../ui/statusBar';

export class SyncCoordinator implements vscode.Disposable {
  private isInternalGitUpdate = false;
  private lastInternalUpdateTime = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly storage: ProfileStorage,
    private readonly gitService: GitService,
    private readonly githubService: GitHubService,
    private readonly statusBar: StatusBarManager
  ) {
    this.registerGitWatcher();
  }

  public getCurrentWorkspacePath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
  }

  public async switchExplorerToProfileFolder(
    profile: GitProfile,
    profileDir: string,
    openInNewWindow: boolean
  ): Promise<void> {
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    if (openInNewWindow) {
      await vscode.commands.executeCommand(
        'vscode.openFolder',
        vscode.Uri.file(profileDir),
        true
      );
      return;
    }

    const existingCount = vscode.workspace.workspaceFolders
      ? vscode.workspace.workspaceFolders.length
      : 0;

    vscode.workspace.updateWorkspaceFolders(0, existingCount, {
      uri: vscode.Uri.file(profileDir),
      name: `PortableGit (${profile.githubUsername})`,
    });
  }

  public async enforceDynamicSync(
    targetProfile?: GitProfile,
    options?: SyncOptions
  ): Promise<void> {
    if (this.isInternalGitUpdate) {
      return;
    }

    const currentWorkspace = this.getCurrentWorkspacePath();
    const profile = targetProfile || (await this.storage.getActiveProfile());
    if (!profile) {
      await this.statusBar.refresh(currentWorkspace);
      return;
    }

    try {
      this.isInternalGitUpdate = true;
      this.lastInternalUpdateTime = Date.now();
      this.statusBar.setBusy(`Syncing ${profile.label}...`);

      await this.storage.setActiveProfileId(profile.id);
      const token = await this.storage.getToken(profile.id);

      await this.gitService.applyProfileDynamic(
        profile,
        token,
        currentWorkspace,
        Boolean(options?.syncAllSubRepos || options?.syncRemoteRepos)
      );

      if (options?.syncRemoteRepos) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Git Profile (${profile.githubUsername})`,
            cancellable: true,
          },
          async (progress, cancelToken) => {
            progress.report({ message: 'Organizing existing local PortableGit repositories first...' });
            const orgSummary = await this.gitService.organizeExistingPortableGitRepos(currentWorkspace);

            const summary = await this.githubService.syncProfileRepositories(
              profile,
              progress,
              cancelToken
            );

            const parts: string[] = [];
            if (orgSummary.movedRepos.length > 0) {
              parts.push(`${orgSummary.movedRepos.length} moved`);
            }
            if (summary.clonedRepos.length > 0) {
              parts.push(`${summary.clonedRepos.length} cloned`);
            }
            if (summary.updatedRepos.length > 0) {
              parts.push(`${summary.updatedRepos.length} synced`);
            }
            if (summary.failedRepos.length > 0) {
              parts.push(`${summary.failedRepos.length} failed`);
            }

            vscode.window.showInformationMessage(
              `Switched to ${profile.label} (${profile.gitName} <${profile.gitEmail}>). ` +
                `PortableGit/${profile.githubUsername}: ${parts.join(', ') || 'Up to date'}.`
            );
          }
        );
      }

      if (options?.promptOpenFolder) {
        const config = vscode.workspace.getConfiguration('gitProfileSwitch');
        const mode = config.get<string>('autoOpenProfileWorkspace', 'prompt');
        const profileDir = this.storage.getProfileDirectory(profile);

        if (
          fs.existsSync(profileDir) &&
          currentWorkspace?.toLowerCase() !== profileDir.toLowerCase()
        ) {
          if (mode === 'always') {
            await this.switchExplorerToProfileFolder(profile, profileDir, false);
          } else if (mode === 'prompt') {
            const choice = await vscode.window.showInformationMessage(
              `Open PortableGit/${profile.githubUsername} workspace folder now?`,
              'Switch Explorer Here (No Reload)',
              'Open in New Window',
              'Stay Here'
            );
            if (choice === 'Switch Explorer Here (No Reload)') {
              await this.switchExplorerToProfileFolder(profile, profileDir, false);
            } else if (choice === 'Open in New Window') {
              await this.switchExplorerToProfileFolder(profile, profileDir, true);
            }
          }
        }
      }
    } finally {
      this.lastInternalUpdateTime = Date.now();
      this.isInternalGitUpdate = false;
      await this.statusBar.refresh(currentWorkspace);
    }
  }

  public async autoDetectAndSyncOnOpen(): Promise<void> {
    const config = vscode.workspace.getConfiguration('gitProfileSwitch');
    const autoDetect = config.get<boolean>('autoDetectFromRepo', true);
    const currentWorkspace = this.getCurrentWorkspacePath();

    if (autoDetect && currentWorkspace) {
      const identity = await this.gitService.getActiveIdentity(currentWorkspace);
      const matched = await this.storage.findMatchingProfile(
        currentWorkspace,
        identity.remoteOwner
      );
      if (matched) {
        await this.enforceDynamicSync(matched, { syncRemoteRepos: false, promptOpenFolder: false });
        return;
      }
    }

    const active = await this.storage.getActiveProfile();
    if (active) {
      await this.enforceDynamicSync(active, { syncRemoteRepos: false, promptOpenFolder: false });
    } else {
      await this.statusBar.refresh(currentWorkspace);
    }
  }

  private registerGitWatcher(): void {
    const gitConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.git/config');
    gitConfigWatcher.onDidChange(async () => {
      // Debounce and suppress events triggered by our own sync
      if (!this.isInternalGitUpdate && Date.now() - this.lastInternalUpdateTime > 3000) {
        const active = await this.storage.getActiveProfile();
        if (active) {
          await this.enforceDynamicSync(active, { syncRemoteRepos: false, promptOpenFolder: false });
        }
      }
    });

    this.disposables.push(gitConfigWatcher);
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
