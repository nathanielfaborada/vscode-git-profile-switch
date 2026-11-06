import * as vscode from 'vscode';
import { GitService } from '../services/gitService';
import { SyncCoordinator } from '../sync/syncCoordinator';
import { StatusBarManager } from '../ui/statusBar';

export function registerOrganizeExistingCommand(
  gitService: GitService,
  coordinator: SyncCoordinator,
  statusBar: StatusBarManager
): vscode.Disposable {
  return vscode.commands.registerCommand('gitProfileSwitch.organizeExisting', async () => {
    const currentWorkspace = coordinator.getCurrentWorkspacePath();
    const summary = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Organizing existing PortableGit repositories into profile folders...',
      },
      async () => gitService.organizeExistingPortableGitRepos(currentWorkspace)
    );

    await statusBar.refresh(currentWorkspace);

    if (summary.movedRepos.length === 0) {
      vscode.window.showInformationMessage(
        `No standalone repos needed moving (${summary.skippedRepos.length} skipped).`
      );
      return;
    }

    const movedList = summary.movedRepos
      .map((m) => `${m.repoName} → PortableGit/${m.targetProfile}/${m.repoName}`)
      .join(', ');
    vscode.window.showInformationMessage(
      `Organized ${summary.movedRepos.length} repositories: ${movedList}`
    );
  });
}
