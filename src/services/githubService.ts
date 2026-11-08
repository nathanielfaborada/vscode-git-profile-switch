import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitHubRepo, GitProfile, SyncSummary } from '../types';
import { ProfileStorage } from './storageService';
import { GitService } from './gitService';

export class GitHubService {
  constructor(
    private readonly storage: ProfileStorage,
    private readonly gitService: GitService
  ) {}

  public async verifyToken(token: string): Promise<{ login: string; name: string | null; scopes: string }> {
    const response = await this.requestJson<{ login: string; name: string | null }>('/user', token);
    return {
      login: response.data.login,
      name: response.data.name,
      scopes: response.scopes,
    };
  }

  public async fetchGitHubUserIdentity(
    username: string,
    token?: string
  ): Promise<{ id: number; login: string; name: string | null; noreplyEmail: string } | undefined> {
    const clean = username.trim();
    if (!clean) {
      return undefined;
    }
    try {
      const response = await this.requestJson<{
        id: number;
        login: string;
        name: string | null;
      }>(`/users/${encodeURIComponent(clean)}`, token);
      const { id, login, name } = response.data;
      return {
        id,
        login,
        name,
        noreplyEmail: `${id}+${login}@users.noreply.github.com`,
      };
    } catch {
      return undefined;
    }
  }

  public async fetchAllProfileRepositories(
    profile: GitProfile,
    token?: string
  ): Promise<GitHubRepo[]> {
    const repoMap = new Map<string, GitHubRepo>();
    const targetOwners = new Set<string>([
      profile.githubUsername.toLowerCase(),
      ...profile.autoMatchOwners.map((o) => o.toLowerCase()),
    ]);

    if (token && token.trim()) {
      try {
        const authRepos = await this.fetchPaginatedRepos(
          '/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member,collaborator',
          token
        );
        for (const repo of authRepos) {
          const ownerLower = repo.owner.login.toLowerCase();
          if (targetOwners.has(ownerLower)) {
            if (!profile.includeForks && repo.fork) {
              continue;
            }
            repoMap.set(repo.name.toLowerCase(), repo);
          }
        }
      } catch {
        // Fallback to public endpoints below if token lacks authorization
      }
    }

    const ownersToQuery = [
      profile.githubUsername,
      ...profile.autoMatchOwners.filter(
        (o) => o.toLowerCase() !== profile.githubUsername.toLowerCase()
      ),
    ];

    for (const owner of ownersToQuery) {
      if (!owner.trim()) {
        continue;
      }
      const encodedOwner = encodeURIComponent(owner.trim());
      const isPrimaryUser = owner.toLowerCase() === profile.githubUsername.toLowerCase();
      const typeParam = isPrimaryUser ? 'all' : 'owner';
      try {
        const userRepos = await this.fetchPaginatedRepos(
          `/users/${encodedOwner}/repos?per_page=100&type=${typeParam}&sort=updated`,
          token
        );
        for (const repo of userRepos) {
          if (!profile.includeForks && repo.fork) {
            continue;
          }
          if (!repoMap.has(repo.name.toLowerCase())) {
            repoMap.set(repo.name.toLowerCase(), repo);
          }
        }
      } catch {
        try {
          const orgRepos = await this.fetchPaginatedRepos(
            `/orgs/${encodedOwner}/repos?per_page=100&sort=updated`,
            token
          );
          for (const repo of orgRepos) {
            if (!profile.includeForks && repo.fork) {
              continue;
            }
            if (!repoMap.has(repo.name.toLowerCase())) {
              repoMap.set(repo.name.toLowerCase(), repo);
            }
          }
        } catch {
          // Skip unreachable owners or non-existent org endpoints
        }
      }
    }

    return Array.from(repoMap.values());
  }

  public async syncProfileRepositories(
    profile: GitProfile,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    cancellationToken?: vscode.CancellationToken,
    activeWorkspacePath?: string
  ): Promise<SyncSummary> {
    const token = await this.storage.getToken(profile.id);
    const profileDir = this.storage.getProfileDirectory(profile);

    if (!fs.existsSync(profileDir)) {
      try {
        fs.mkdirSync(profileDir, { recursive: true });
      } catch {
        // Ignore if directory cannot be created
      }
    }

    progress?.report({ message: `Fetching repositories for ${profile.githubUsername} from GitHub...` });
    const remoteRepos = await this.fetchAllProfileRepositories(profile, token);

    const clonedRepos: string[] = [];
    const updatedRepos: string[] = [];
    const removedRepos: string[] = [];
    const failedRepos: Array<{ name: string; error: string }> = [];

    const validTargetPaths = new Set<string>();
    const validRepoNames = new Set<string>();

    const total = remoteRepos.length;
    const stepIncrement = total > 0 ? 100 / total : 100;

    for (let i = 0; i < remoteRepos.length; i++) {
      if (cancellationToken?.isCancellationRequested) {
        break;
      }

      const repo = remoteRepos[i];
      const targetRepoPath = this.storage.getRepoTargetDirectory(
        profile,
        repo.owner.login,
        repo.name
      );
      validTargetPaths.add(path.resolve(targetRepoPath).toLowerCase());
      validRepoNames.add(repo.name.toLowerCase());

      const targetParentDir = path.dirname(targetRepoPath);
      if (!fs.existsSync(targetParentDir)) {
        try {
          fs.mkdirSync(targetParentDir, { recursive: true });
        } catch {
          // Ignore if parent directory cannot be created
        }
      }

      if (fs.existsSync(targetRepoPath) && this.gitService.isGitRepository(targetRepoPath)) {
        progress?.report({
          message: `[${i + 1}/${total}] Syncing identity for existing repo: ${repo.name}...`,
          increment: stepIncrement,
        });
        try {
          await this.gitService.applyProfileToSingleRepo(targetRepoPath, profile, token);
          updatedRepos.push(repo.name);
        } catch (err) {
          failedRepos.push({
            name: repo.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (!fs.existsSync(targetRepoPath)) {
        progress?.report({
          message: `[${i + 1}/${total}] Cloning ${repo.full_name} into PortableGit/${profile.githubUsername}...`,
          increment: stepIncrement,
        });

        try {
          const cloneUrl =
            this.gitService.buildAuthenticatedRemoteUrl(
              repo.clone_url,
              profile.githubUsername,
              token
            ) || repo.clone_url;

          await this.gitService.execGit(['clone', cloneUrl, targetRepoPath], profileDir);
          await this.gitService.applyProfileToSingleRepo(targetRepoPath, profile, token);
          clonedRepos.push(repo.name);
        } catch (err) {
          failedRepos.push({
            name: repo.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Prune local repositories in profileDir that were deleted or renamed on GitHub
    if (!cancellationToken?.isCancellationRequested && remoteRepos.length > 0) {
      progress?.report({
        message: `Cleaning up local repositories no longer on GitHub for ${profile.githubUsername}...`,
      });
      const localRepos = this.gitService.findAllRepositoriesInDir(profileDir);
      const normalizedActiveWorkspace = activeWorkspacePath
        ? path.resolve(activeWorkspacePath).toLowerCase()
        : undefined;

      for (const localRepoPath of localRepos) {
        if (cancellationToken?.isCancellationRequested) {
          break;
        }
        const normalizedLocal = path.resolve(localRepoPath).toLowerCase();
        if (validTargetPaths.has(normalizedLocal)) {
          continue;
        }
        if (normalizedActiveWorkspace && normalizedLocal === normalizedActiveWorkspace) {
          continue;
        }

        const folderName = path.basename(localRepoPath);
        const shouldRemove = await this.isRepoDeletedOrRenamedOnGitHub(
          localRepoPath,
          folderName,
          profile,
          token,
          validRepoNames
        );

        if (shouldRemove) {
          try {
            fs.rmSync(localRepoPath, { recursive: true, force: true });
            removedRepos.push(folderName);
          } catch {
            // Skip if locked by another process
          }
        }
      }
    }

    return {
      profile,
      profileDir,
      totalRemoteRepos: remoteRepos.length,
      clonedRepos,
      updatedRepos,
      removedRepos,
      failedRepos,
    };
  }

  private async isRepoDeletedOrRenamedOnGitHub(
    localRepoPath: string,
    folderName: string,
    profile: GitProfile,
    token: string | undefined,
    validRepoNames: Set<string>
  ): Promise<boolean> {
    // If a PAT token is configured, fetchAllProfileRepositories already returned all accessible public + private repos
    if (token && token.trim() && !validRepoNames.has(folderName.toLowerCase())) {
      return true;
    }

    const originUrl = await this.gitService
      .execGit(['remote', 'get-url', 'origin'], localRepoPath)
      .catch(() => '');
    const parsed = this.gitService.parseGitHubRemote(originUrl);
    const owner = parsed?.owner || profile.githubUsername;

    // Check GitHub API for 404 (deleted) or rename redirect (canonical name differs from folderName)
    try {
      const response = await this.requestJson<{ name: string }>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(folderName)}`,
        token
      );
      if (
        response.data?.name &&
        response.data.name.toLowerCase() !== folderName.toLowerCase() &&
        validRepoNames.has(response.data.name.toLowerCase())
      ) {
        return true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('HTTP 404')) {
        // Verify with git ls-remote whether it's truly deleted vs a private repo accessible via Git Credential Manager
        try {
          await this.gitService.execGit(['ls-remote', '--exit-code', 'origin', 'HEAD'], localRepoPath);
          return false;
        } catch (gitErr) {
          const gitMsg = gitErr instanceof Error ? gitErr.message.toLowerCase() : '';
          if (gitMsg.includes('not found') || gitMsg.includes('repository not found')) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async fetchPaginatedRepos(endpoint: string, token?: string): Promise<GitHubRepo[]> {
    const response = await this.requestJson<GitHubRepo[]>(endpoint, token);
    return Array.isArray(response.data) ? response.data : [];
  }

  private requestJson<T>(
    apiPath: string,
    token?: string
  ): Promise<{ data: T; scopes: string }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent': 'vscode-git-profile-switch/1.0.1',
        Accept: 'application/vnd.github+json',
      };

      if (token && token.trim()) {
        headers.Authorization = `Bearer ${token.trim()}`;
      }

      const req = https.request(
        {
          hostname: 'api.github.com',
          path: apiPath,
          method: 'GET',
          headers,
          timeout: 15000,
        },
        (res: http.IncomingMessage) => {
          let raw = '';
          res.on('data', (chunk: Buffer | string) => {
            raw += chunk.toString();
          });
          res.on('end', () => {
            const statusCode = res.statusCode || 500;
            const scopes = String(res.headers['x-oauth-scopes'] || '');
            if (statusCode >= 200 && statusCode < 300) {
              try {
                const parsed = JSON.parse(raw) as T;
                resolve({ data: parsed, scopes });
              } catch (err) {
                reject(new Error(`Invalid JSON from GitHub API: ${err}`));
              }
            } else {
              reject(new Error(`GitHub API HTTP ${statusCode}: ${raw}`));
            }
          });
        }
      );

      req.on('error', (err: Error) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('GitHub API request timed out'));
      });
      req.end();
    });
  }
}
