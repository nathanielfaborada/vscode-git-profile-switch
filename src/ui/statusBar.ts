import * as vscode from 'vscode';
import { ProfileStorage } from '../services/storageService';
import { GitService } from '../services/gitService';

export class StatusBarManager implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly storage: ProfileStorage,
    private readonly gitService: GitService
  ) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98
    );
    this.statusBarItem.command = 'gitProfileSwitch.switch';
    this.statusBarItem.show();
  }

  public async refresh(currentRepoPath?: string): Promise<void> {
    const activeProfile = await this.storage.getActiveProfile();
    const identity = await this.gitService.getActiveIdentity(currentRepoPath);

    if (!activeProfile) {
      this.statusBarItem.text = '$(account) Git Profile: Unconfigured';
      this.statusBarItem.tooltip = 'Click to add and switch Git profiles';
      return;
    }

    const token = await this.storage.getToken(activeProfile.id);
    const profileDir = this.storage.getProfileDirectory(activeProfile);
    const localRepoCount = this.gitService.findAllRepositoriesInDir(profileDir).length;

    this.statusBarItem.text = `${activeProfile.icon} Git: ${activeProfile.label} (${activeProfile.githubUsername})`;

    const tooltip = new vscode.MarkdownString('', true);
    tooltip.isTrusted = true;
    tooltip.appendMarkdown(`### ${activeProfile.icon} ${activeProfile.label}\n\n`);
    tooltip.appendMarkdown(`- **Commit Author:** \`${identity.userName || activeProfile.gitName} <${identity.userEmail || activeProfile.gitEmail}>\`\n`);
    tooltip.appendMarkdown(`- **GitHub Push User:** \`${activeProfile.githubUsername}\` ${token ? '$(verified) *(Token Ready)*' : '$(warning) *(No PAT Token)*'}\n`);
    tooltip.appendMarkdown(`- **PortableGit Folder:** \`${profileDir}\` *(${localRepoCount} repos)*\n`);
    if (activeProfile.autoMatchOwners.length > 0) {
      tooltip.appendMarkdown(`- **Auto-Match Orgs:** \`${activeProfile.autoMatchOwners.join(', ')}\`\n`);
    }
    tooltip.appendMarkdown(`\n---\n`);
    tooltip.appendMarkdown(
      `[$(arrow-swap) Switch Profile](command:gitProfileSwitch.switch) &nbsp;|&nbsp; ` +
      `[$(repo-clone) Sync Repos](command:gitProfileSwitch.syncRepos) &nbsp;|&nbsp; ` +
      `[$(folder-opened) Open Folder](command:gitProfileSwitch.openProfileFolder) &nbsp;|&nbsp; ` +
      `[$(add) Add](command:gitProfileSwitch.add) &nbsp;|&nbsp; ` +
      `[$(heart) Ko-fi](https://ko-fi.com/nathanielfaborada)`
    );

    this.statusBarItem.tooltip = tooltip;
  }

  public setBusy(label: string): void {
    this.statusBarItem.text = `$(sync~spin) Git: ${label}`;
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
