import * as vscode from 'vscode';
import { ProfileStorage } from './services/storageService';
import { GitService } from './services/gitService';
import { GitHubService } from './services/githubService';
import { StatusBarManager } from './ui/statusBar';
import { SyncCoordinator } from './sync/syncCoordinator';
import { registerAllCommands } from './commands';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = new ProfileStorage(context);
  const gitService = new GitService(storage);
  const githubService = new GitHubService(storage, gitService);
  const statusBar = new StatusBarManager(storage, gitService);
  const coordinator = new SyncCoordinator(storage, gitService, githubService, statusBar);

  context.subscriptions.push(statusBar, coordinator);

  registerAllCommands(
    context,
    storage,
    gitService,
    githubService,
    statusBar,
    coordinator
  );

  await coordinator.autoDetectAndSyncOnOpen();
}

export function deactivate(): void {
  // Disposables registered in context.subscriptions handle cleanup automatically
}
