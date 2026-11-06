import * as vscode from 'vscode';
import { ProfileStorage } from '../services/storageService';
import { GitService } from '../services/gitService';
import { GitHubService } from '../services/githubService';
import { StatusBarManager } from '../ui/statusBar';
import { SyncCoordinator } from '../sync/syncCoordinator';

import { registerSwitchCommand } from './switchProfile';
import { registerAddCommand } from './addProfile';
import { registerEditCommand } from './editProfile';
import { registerDeleteCommand } from './deleteProfile';
import { registerSyncReposCommand } from './syncRepos';
import { registerOrganizeExistingCommand } from './organizeExisting';
import { registerVerifyIdentityCommand } from './verifyIdentity';
import { registerOpenProfileFolderCommand } from './openProfileFolder';

export function registerAllCommands(
  context: vscode.ExtensionContext,
  storage: ProfileStorage,
  gitService: GitService,
  githubService: GitHubService,
  statusBar: StatusBarManager,
  coordinator: SyncCoordinator
): void {
  context.subscriptions.push(
    registerSwitchCommand(storage, coordinator),
    registerAddCommand(storage, coordinator, statusBar),
    registerEditCommand(storage, coordinator, statusBar),
    registerDeleteCommand(storage, coordinator, statusBar),
    registerSyncReposCommand(storage, coordinator),
    registerOrganizeExistingCommand(gitService, coordinator, statusBar),
    registerVerifyIdentityCommand(storage, gitService, githubService, coordinator),
    registerOpenProfileFolderCommand(storage, coordinator)
  );
}
