import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActiveGitIdentity, GitProfile, OrganizeSummary } from '../types';
import { ProfileStorage } from './storageService';

const PORTABLE_GIT_SYSTEM_DIRS = new Set([
  'bin',
  'cmd',
  'dev',
  'etc',
  'mingw64',
  'tmp',
  'usr',
  '.git',
  'node_modules',
]);

export class GitService {
  constructor(private readonly storage: ProfileStorage) {}

  public getGitExecutable(): string {
    const portableRoot = this.storage.getPortableGitRoot();
    const portableGitExe = path.join(portableRoot, 'cmd', 'git.exe');
    if (fs.existsSync(portableGitExe)) {
      return portableGitExe;
    }
    return 'git';
  }

  public execGit(args: string[], cwd?: string): Promise<string> {
    const gitExe = this.getGitExecutable();
    return new Promise((resolve, reject) => {
      execFile(
        gitExe,
        args,
        {
          cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || error.message).trim()));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });
  }

  public isGitRepository(dirPath: string): boolean {
    return fs.existsSync(path.join(dirPath, '.git'));
  }

  public parseGitHubRemote(remoteUrl: string): {
    owner: string;
    repo: string;
    authUser?: string;
    cleanHttpsUrl: string;
  } | undefined {
    if (!remoteUrl) {
      return undefined;
    }

    const httpsMatch = remoteUrl.match(
      /^https?:\/\/(?:([^:@/]+)(?::[^@/]+)?@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
    );
    if (httpsMatch) {
      return {
        owner: httpsMatch[2],
        repo: httpsMatch[3],
        authUser: httpsMatch[1],
        cleanHttpsUrl: `https://github.com/${httpsMatch[2]}/${httpsMatch[3]}.git`,
      };
    }

    const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (sshMatch) {
      return {
        owner: sshMatch[2],
        repo: sshMatch[3],
        cleanHttpsUrl: `https://github.com/${sshMatch[2]}/${sshMatch[3]}.git`,
      };
    }

    return undefined;
  }

  public buildAuthenticatedRemoteUrl(
    currentRemoteUrl: string,
    githubUsername: string,
    token?: string
  ): string | undefined {
    const parsed = this.parseGitHubRemote(currentRemoteUrl);
    if (!parsed) {
      return undefined;
    }

    const encodedUser = encodeURIComponent(githubUsername);
    if (token && token.trim()) {
      const encodedToken = encodeURIComponent(token.trim());
      return `https://${encodedUser}:${encodedToken}@github.com/${parsed.owner}/${parsed.repo}.git`;
    }

    return `https://${encodedUser}@github.com/${parsed.owner}/${parsed.repo}.git`;
  }

  public async getActiveIdentity(repoPath?: string): Promise<ActiveGitIdentity> {
    const validRepo = repoPath && this.isGitRepository(repoPath) ? repoPath : undefined;

    try {
      const scopeFlag = validRepo ? '--local' : '--global';
      const userName = await this.execGit(['config', scopeFlag, '--get', 'user.name'], validRepo).catch(
        async () => this.execGit(['config', '--global', '--get', 'user.name']).catch(() => '')
      );
      const userEmail = await this.execGit(['config', scopeFlag, '--get', 'user.email'], validRepo).catch(
        async () => this.execGit(['config', '--global', '--get', 'user.email']).catch(() => '')
      );

      let remoteUrl: string | undefined;
      let remoteOwner: string | undefined;
      let remoteAuthUser: string | undefined;

      if (validRepo) {
        remoteUrl = await this.execGit(['remote', 'get-url', 'origin'], validRepo).catch(() => undefined);
        if (remoteUrl) {
          const parsed = this.parseGitHubRemote(remoteUrl);
          remoteOwner = parsed?.owner;
          remoteAuthUser = parsed?.authUser;
        }
      }

      return {
        scope: validRepo ? 'local' : 'global',
        repoPath: validRepo,
        userName,
        userEmail,
        remoteUrl,
        remoteOwner,
        remoteAuthUser,
      };
    } catch {
      return {
        scope: 'global',
        userName: '',
        userEmail: '',
      };
    }
  }

  public async applyProfileDynamic(
    profile: GitProfile,
    token?: string,
    currentRepoPath?: string,
    syncAllSubRepos = false
  ): Promise<void> {
    await this.execGit(['config', '--global', 'user.name', profile.gitName]).catch(() => undefined);
    await this.execGit(['config', '--global', 'user.email', profile.gitEmail]).catch(() => undefined);

    const portableRoot = this.storage.getPortableGitRoot();
    const portableGitConfig = path.join(portableRoot, 'etc', 'gitconfig');
    if (fs.existsSync(portableGitConfig)) {
      await this.execGit(['config', '--file', portableGitConfig, 'user.name', profile.gitName]).catch(
        () => undefined
      );
      await this.execGit(['config', '--file', portableGitConfig, 'user.email', profile.gitEmail]).catch(
        () => undefined
      );
    }

    if (token && token.trim()) {
      await this.updateGitCredentialManager(profile.githubUsername, token.trim()).catch(() => undefined);
    }

    const profileDir = this.storage.getProfileDirectory(profile);
    if (!fs.existsSync(profileDir)) {
      try {
        fs.mkdirSync(profileDir, { recursive: true });
      } catch {
        // Ignore if target root is read-only or not yet created
      }
    }
    await this.syncAllFolderIncludeIfConfigs(profile).catch(() => undefined);
    this.ensureGitBashPromptConfig();

    const allProfiles = await this.storage.getProfiles();
    const targetRepos = new Set<string>();
    for (const p of allProfiles) {
      const pDir = this.storage.getProfileDirectory(p);
      for (const repo of this.findAllRepositoriesInDir(pDir)) {
        targetRepos.add(repo);
      }
    }

    if (currentRepoPath && fs.existsSync(currentRepoPath)) {
      if (this.isGitRepository(currentRepoPath)) {
        targetRepos.add(currentRepoPath);
      } else if (syncAllSubRepos) {
        for (const repo of this.findAllRepositoriesInDir(currentRepoPath)) {
          targetRepos.add(repo);
        }
      }
    }

    for (const subRepoPath of targetRepos) {
      await this.applyProfileToSingleRepo(subRepoPath, profile, token);
    }
  }

  public findAllRepositoriesInDir(rootDir: string, maxDepth = 3): string[] {
    const results: string[] = [];
    if (!fs.existsSync(rootDir)) {
      return results;
    }

    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) {
        return;
      }
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (this.isGitRepository(fullPath)) {
          results.push(fullPath);
        } else {
          walk(fullPath, depth + 1);
        }
      }
    };

    walk(rootDir, 1);
    return results;
  }

  public async applyProfileToSingleRepo(
    repoPath: string,
    profile: GitProfile,
    token?: string
  ): Promise<void> {
    if (!this.isGitRepository(repoPath)) {
      return;
    }

    const currentName = await this.execGit(['config', '--local', '--get', 'user.name'], repoPath).catch(
      () => ''
    );
    if (currentName !== profile.gitName) {
      await this.execGit(['config', '--local', 'user.name', profile.gitName], repoPath).catch(
        () => undefined
      );
    }

    const currentEmail = await this.execGit(['config', '--local', '--get', 'user.email'], repoPath).catch(
      () => ''
    );
    if (currentEmail !== profile.gitEmail) {
      await this.execGit(['config', '--local', 'user.email', profile.gitEmail], repoPath).catch(
        () => undefined
      );
    }

    const currentOrigin = await this.execGit(['remote', 'get-url', 'origin'], repoPath).catch(() => '');
    if (currentOrigin) {
      const updatedUrl = this.buildAuthenticatedRemoteUrl(
        currentOrigin,
        profile.githubUsername,
        token
      );
      if (updatedUrl && updatedUrl !== currentOrigin) {
        await this.execGit(['remote', 'set-url', 'origin', updatedUrl], repoPath).catch(
          () => undefined
        );
      }
    }
  }

  private async syncAllFolderIncludeIfConfigs(activeProfile: GitProfile): Promise<void> {
    const allProfiles = await this.storage.getProfiles();
    const content = [
      '# Auto-generated by vscode-git-profile-switch',
      '[user]',
      `\tname = ${activeProfile.gitName}`,
      `\temail = ${activeProfile.gitEmail}`,
      '',
    ].join('\n');

    for (const p of allProfiles) {
      const pDir = this.storage.getProfileDirectory(p);
      if (!fs.existsSync(pDir)) {
        continue;
      }
      const profileGitConfigPath = path.join(pDir, '.gitconfig-profile');
      fs.writeFileSync(profileGitConfigPath, content, 'utf8');

      const normalizedDir = pDir.replace(/\\/g, '/').replace(/\/?$/, '/');
      const normalizedConfigPath = profileGitConfigPath.replace(/\\/g, '/');
      await this.execGit([
        'config',
        '--global',
        `includeIf.gitdir/i:${normalizedDir}.path`,
        normalizedConfigPath,
      ]).catch(() => undefined);
    }
  }

  private ensureGitBashPromptConfig(): void {
    try {
      const gitConfigDir = path.join(os.homedir(), '.config', 'git');
      if (!fs.existsSync(gitConfigDir)) {
        fs.mkdirSync(gitConfigDir, { recursive: true });
      }
      const promptPath = path.join(gitConfigDir, 'git-prompt.sh');
      const promptContent = [
        '# Auto-generated by vscode-git-profile-switch',
        'PS1=\'\\[\\033]0;$TITLEPREFIX:$PWD\\007\\]\'',
        'PS1="$PS1"\'\\n\'',
        'PS1="$PS1"\'\\[\\033[32m\\]\'',
        'PS1="$PS1"\'`git config user.name 2>/dev/null || echo "\\u"`@\\h \'',
        'PS1="$PS1"\'\\[\\033[35m\\]\'',
        'PS1="$PS1"\'$MSYSTEM \'',
        'PS1="$PS1"\'\\[\\033[33m\\]\'',
        'PS1="$PS1"\'\\w\'',
        'if test -n "$BASH_VERSION" && test -z "$WINELOADERNOEXEC"',
        'then',
        '\tGIT_EXEC_PATH="$(git --exec-path 2>/dev/null)"',
        '\tCOMPLETION_PATH="${GIT_EXEC_PATH%/libexec/git-core}"',
        '\tCOMPLETION_PATH="${COMPLETION_PATH%/lib/git-core}"',
        '\tCOMPLETION_PATH="$COMPLETION_PATH/share/git/completion"',
        '\tif test -f "$COMPLETION_PATH/git-prompt.sh"',
        '\tthen',
        '\t\t. "$COMPLETION_PATH/git-completion.bash"',
        '\t\t. "$COMPLETION_PATH/git-prompt.sh"',
        '\t\tPS1="$PS1"\'\\[\\033[36m\\]\'',
        '\t\tPS1="$PS1"\'`__git_ps1`\'',
        '\tfi',
        'fi',
        'PS1="$PS1"\'\\[\\033[0m\\]\'',
        'PS1="$PS1"\'\\n\'',
        'PS1="$PS1"\'$ \'',
        '',
      ].join('\n');
      fs.writeFileSync(promptPath, promptContent, 'utf8');
    } catch {
      // Ignore if home directory is read-only
    }
  }

  private updateGitCredentialManager(username: string, token: string): Promise<void> {
    const gitExe = this.getGitExecutable();
    return new Promise((resolve) => {
      const child = spawn(gitExe, ['credential', 'approve'], { windowsHide: true });
      const payload = `protocol=https\nhost=github.com\nusername=${username}\npassword=${token}\n\n`;
      child.stdin.write(payload);
      child.stdin.end();
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    });
  }

  public async organizeExistingPortableGitRepos(
    activeWorkspacePath?: string
  ): Promise<OrganizeSummary> {
    const portableRoot = this.storage.getPortableGitRoot();
    const profiles = await this.storage.getProfiles();
    const profileDirsLower = new Set(
      profiles.map((p) => p.githubUsername.toLowerCase())
    );

    const movedRepos: Array<{ repoName: string; targetProfile: string; targetPath: string }> = [];
    const skippedRepos: Array<{ repoName: string; reason: string }> = [];

    if (!fs.existsSync(portableRoot)) {
      return { movedRepos, skippedRepos };
    }

    const entries = fs.readdirSync(portableRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const folderName = entry.name;
      const folderLower = folderName.toLowerCase();

      if (PORTABLE_GIT_SYSTEM_DIRS.has(folderLower) || profileDirsLower.has(folderLower)) {
        continue;
      }

      const fullRepoPath = path.join(portableRoot, folderName);
      if (!this.isGitRepository(fullRepoPath)) {
        continue;
      }

      // Avoid moving active workspace folder while locked by VS Code process
      if (
        activeWorkspacePath &&
        path.resolve(activeWorkspacePath).toLowerCase() === path.resolve(fullRepoPath).toLowerCase()
      ) {
        skippedRepos.push({
          repoName: folderName,
          reason: 'Currently open as active VS Code workspace',
        });
        continue;
      }

      const originUrl = await this.execGit(['remote', 'get-url', 'origin'], fullRepoPath).catch(
        () => ''
      );
      const parsed = this.parseGitHubRemote(originUrl);
      const matchedProfile =
        (await this.storage.findMatchingProfile(undefined, parsed?.owner)) ||
        (await this.storage.getActiveProfile());

      if (!matchedProfile) {
        skippedRepos.push({
          repoName: folderName,
          reason: 'No matching profile found',
        });
        continue;
      }

      const targetPath = this.storage.getRepoTargetDirectory(
        matchedProfile,
        parsed?.owner,
        folderName
      );
      const targetParent = path.dirname(targetPath);
      if (!fs.existsSync(targetParent)) {
        fs.mkdirSync(targetParent, { recursive: true });
      }

      if (fs.existsSync(targetPath)) {
        const targetStatus = await this.execGit(['status', '--porcelain'], targetPath).catch(
          () => 'dirty'
        );
        const targetHasEnv = fs.existsSync(path.join(targetPath, '.env'));

        if (targetStatus === '' && !targetHasEnv) {
          try {
            fs.rmSync(targetPath, { recursive: true, force: true });
          } catch {
            skippedRepos.push({
              repoName: folderName,
              reason: `Already exists in ${matchedProfile.githubUsername}/${folderName}`,
            });
            continue;
          }
        } else {
          skippedRepos.push({
            repoName: folderName,
            reason: `Already exists in ${matchedProfile.githubUsername}/${folderName}`,
          });
          continue;
        }
      }

      try {
        try {
          fs.renameSync(fullRepoPath, targetPath);
        } catch {
          // Fallback to copy if Windows file lock prevents atomic rename
          fs.cpSync(fullRepoPath, targetPath, { recursive: true });
        }
        const token = await this.storage.getToken(matchedProfile.id);
        await this.applyProfileToSingleRepo(targetPath, matchedProfile, token);
        movedRepos.push({
          repoName: folderName,
          targetProfile: matchedProfile.githubUsername,
          targetPath,
        });
      } catch (err) {
        skippedRepos.push({
          repoName: folderName,
          reason: err instanceof Error ? err.message : 'Folder locked by another process',
        });
      }
    }

    for (const profile of profiles) {
      const profileDir = this.storage.getProfileDirectory(profile);
      if (!fs.existsSync(profileDir)) {
        continue;
      }
      const subEntries = fs.readdirSync(profileDir, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isDirectory() || sub.name === 'Personal' || sub.name === 'Organizations') {
          continue;
        }
        const flatRepoPath = path.join(profileDir, sub.name);
        if (!this.isGitRepository(flatRepoPath)) {
          continue;
        }
        const originUrl = await this.execGit(['remote', 'get-url', 'origin'], flatRepoPath).catch(
          () => ''
        );
        const parsed = this.parseGitHubRemote(originUrl);
        const destPath = this.storage.getRepoTargetDirectory(profile, parsed?.owner, sub.name);
        if (path.resolve(flatRepoPath).toLowerCase() === path.resolve(destPath).toLowerCase()) {
          continue;
        }
        const destParent = path.dirname(destPath);
        if (!fs.existsSync(destParent)) {
          fs.mkdirSync(destParent, { recursive: true });
        }
        if (!fs.existsSync(destPath)) {
          try {
            fs.renameSync(flatRepoPath, destPath);
            movedRepos.push({
              repoName: sub.name,
              targetProfile: profile.githubUsername,
              targetPath: destPath,
            });
          } catch {
            // Keep existing directory untouched if locked
          }
        }
      }
    }

    return { movedRepos, skippedRepos };
  }
}
