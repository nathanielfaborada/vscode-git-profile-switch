import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitProfile } from '../types';

const CONFIG_SECTION = 'gitProfileSwitch';
const SECRET_PREFIX = 'gitProfileSwitch.token.';

const SYSTEM_DIRS = new Set([
  'bin',
  'cmd',
  'dev',
  'etc',
  'mingw64',
  'tmp',
  'usr',
  '.git',
  'node_modules',
  'personal',
  'organizations',
]);

export class ProfileStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public getPortableGitRoot(): string {
    const homeDir = os.homedir();
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const rawConfigured = (config.get<string>('portableGitRoot') || '').trim();

    if (rawConfigured) {
      const expanded = this.expandUserPath(rawConfigured, homeDir);
      if (this.isUsableRootPath(expanded, homeDir)) {
        return expanded;
      }
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      for (const folder of workspaceFolders) {
        const currentPath = folder.uri.fsPath;
        const match = currentPath.match(/^(.*?[\\/]PortableGit)(?:[\\/]|$)/i);
        if (match && match[1] && fs.existsSync(match[1])) {
          return match[1];
        }
      }
    }

    const candidates = [
      path.join(homeDir, 'Downloads', 'PortableGit'),
      path.join(homeDir, 'PortableGit'),
      path.join(homeDir, 'Documents', 'PortableGit'),
      path.join(homeDir, 'Desktop', 'PortableGit'),
      'C:\\PortableGit',
      'D:\\PortableGit',
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    const downloadsDir = path.join(homeDir, 'Downloads');
    if (fs.existsSync(downloadsDir)) {
      return path.join(downloadsDir, 'PortableGit');
    }

    return path.join(homeDir, 'PortableGit');
  }

  private expandUserPath(inputPath: string, homeDir: string): string {
    let resolved = inputPath;
    if (resolved.startsWith('~')) {
      resolved = path.join(homeDir, resolved.slice(1));
    }
    resolved = resolved.replace(/%USERPROFILE%/gi, homeDir);
    resolved = resolved.replace(/\$HOME\b/g, homeDir);
    return path.normalize(resolved);
  }

  private isUsableRootPath(targetPath: string, homeDir: string): boolean {
    if (fs.existsSync(targetPath)) {
      return true;
    }

    // Prevent attempting to create directories under another Windows user profile (e.g. C:\Users\user\...)
    const usersMatch = targetPath.match(/^([a-zA-Z]:[\\/]Users[\\/][^\\/]+)/i);
    if (usersMatch && usersMatch[1]) {
      const targetUserHome = path.resolve(usersMatch[1]);
      if (
        targetUserHome.toLowerCase() !== path.resolve(homeDir).toLowerCase() &&
        !fs.existsSync(targetUserHome)
      ) {
        return false;
      }
    }

    // Check if the nearest existing ancestor directory is writable
    let current = path.resolve(targetPath);
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) {
        return false;
      }
      current = parent;
    }

    try {
      fs.accessSync(current, fs.constants.W_OK);
      // Avoid creating directly inside C:\Users
      if (/^[a-zA-Z]:[\\/]Users$/i.test(current)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  public getProfileDirectory(profile: GitProfile): string {
    const root = this.getPortableGitRoot();
    const safeFolder = profile.githubUsername.replace(/[<>:"/\\|?*]/g, '_');
    return path.join(root, safeFolder);
  }

  public getRepoTargetDirectory(
    profile: GitProfile,
    repoOwner: string | undefined,
    repoName: string
  ): string {
    const profileDir = this.getProfileDirectory(profile);
    const safeRepo = repoName.replace(/[<>:"/\\|?*]/g, '_');
    const cleanOwner = (repoOwner || profile.githubUsername).trim();

    if (cleanOwner.toLowerCase() === profile.githubUsername.toLowerCase()) {
      return path.join(profileDir, 'Personal', safeRepo);
    }

    const safeOwner = cleanOwner.replace(/[<>:"/\\|?*]/g, '_');
    return path.join(profileDir, 'Organizations', safeOwner, safeRepo);
  }

  public async getProfiles(): Promise<GitProfile[]> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const profiles = config.get<GitProfile[]>('profiles', []);
    if (profiles.length > 0) {
      return profiles;
    }

    const discovered = this.discoverProfilesFromEnvironment();
    if (discovered.length > 0) {
      await this.saveAllProfiles(discovered);
    }
    return discovered;
  }

  public async getProfileById(id: string): Promise<GitProfile | undefined> {
    const profiles = await this.getProfiles();
    return profiles.find((p) => p.id.toLowerCase() === id.toLowerCase());
  }

  public async findMatchingProfile(repoPath?: string, remoteOwner?: string): Promise<GitProfile | undefined> {
    const profiles = await this.getProfiles();
    const portableRoot = this.getPortableGitRoot().toLowerCase();

    if (repoPath) {
      const normalizedRepo = path.resolve(repoPath).toLowerCase();
      for (const profile of profiles) {
        const profileDir = path.resolve(this.getProfileDirectory(profile)).toLowerCase();
        if (normalizedRepo === profileDir || normalizedRepo.startsWith(profileDir + path.sep)) {
          return profile;
        }
      }
    }

    if (remoteOwner) {
      const ownerLower = remoteOwner.toLowerCase();
      for (const profile of profiles) {
        if (profile.githubUsername.toLowerCase() === ownerLower) {
          return profile;
        }
        if (profile.autoMatchOwners.some((o) => o.toLowerCase() === ownerLower)) {
          return profile;
        }
      }
    }

    if (repoPath && path.resolve(repoPath).toLowerCase().startsWith(portableRoot)) {
      const active = await this.getActiveProfile();
      if (active) {
        return active;
      }
    }

    return undefined;
  }

  public async upsertProfile(profile: GitProfile, token?: string): Promise<void> {
    const profiles = await this.getProfiles();
    const index = profiles.findIndex((p) => p.id === profile.id);
    const now = new Date().toISOString();

    const updatedProfile: GitProfile = {
      ...profile,
      updatedAt: now,
      createdAt: index >= 0 ? profiles[index].createdAt : now,
    };

    if (index >= 0) {
      profiles[index] = updatedProfile;
    } else {
      profiles.push(updatedProfile);
    }

    await this.saveAllProfiles(profiles);

    if (token !== undefined) {
      const trimmed = token.trim();
      if (trimmed) {
        await this.setToken(profile.id, trimmed);
      }
    }
  }

  public async deleteProfile(profileId: string): Promise<boolean> {
    const profiles = await this.getProfiles();
    const filtered = profiles.filter((p) => p.id !== profileId);
    if (filtered.length === profiles.length) {
      return false;
    }

    await this.saveAllProfiles(filtered);
    await this.deleteToken(profileId);

    const activeId = this.getActiveProfileId();
    if (activeId === profileId) {
      const nextActive = filtered[0]?.id || '';
      await this.setActiveProfileId(nextActive);
    }
    return true;
  }

  public getActiveProfileId(): string {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get<string>('activeProfileId', '');
  }

  public async setActiveProfileId(profileId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await config.update('activeProfileId', profileId, vscode.ConfigurationTarget.Global);
  }

  public async getActiveProfile(): Promise<GitProfile | undefined> {
    const profiles = await this.getProfiles();
    const activeId = this.getActiveProfileId();
    if (activeId) {
      const found = profiles.find((p) => p.id === activeId);
      if (found) {
        return found;
      }
    }
    return profiles[0];
  }

  public async getToken(profileId: string): Promise<string | undefined> {
    return this.context.secrets.get(`${SECRET_PREFIX}${profileId}`);
  }

  public async setToken(profileId: string, token: string): Promise<void> {
    await this.context.secrets.store(`${SECRET_PREFIX}${profileId}`, token.trim());
  }

  public async deleteToken(profileId: string): Promise<void> {
    await this.context.secrets.delete(`${SECRET_PREFIX}${profileId}`);
  }

  private async saveAllProfiles(profiles: GitProfile[]): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await config.update('profiles', profiles, vscode.ConfigurationTarget.Global);
  }

  private discoverProfilesFromEnvironment(): GitProfile[] {
    const now = new Date().toISOString();
    const discoveredByUsername = new Map<string, GitProfile>();
    const portableRoot = this.getPortableGitRoot();

    const registerCandidate = (
      gitName: string | undefined,
      gitEmail: string | undefined,
      githubUsername: string | undefined,
      remoteOwner?: string
    ) => {
      const cleanName = (gitName || '').trim();
      const cleanEmail = (gitEmail || '').trim();
      const emailLoginMatch = cleanEmail.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
      const inferredUser = (
        githubUsername ||
        (emailLoginMatch ? emailLoginMatch[1] : '') ||
        cleanName
      ).trim();

      if (!inferredUser) {
        return;
      }

      const key = inferredUser.toLowerCase();
      const id = key.replace(/[^a-z0-9-_]/g, '-');
      if (!id) {
        return;
      }

      const existing = discoveredByUsername.get(key);
      const ownerToAdd = (remoteOwner || inferredUser).trim();

      if (existing) {
        if (!existing.gitName && cleanName) {
          existing.gitName = cleanName;
        }
        if (
          cleanEmail &&
          (!existing.gitEmail || existing.gitEmail.endsWith('@users.noreply.github.com') === false)
        ) {
          existing.gitEmail = cleanEmail;
        }
        if (
          ownerToAdd &&
          !existing.autoMatchOwners.some((o) => o.toLowerCase() === ownerToAdd.toLowerCase())
        ) {
          existing.autoMatchOwners.push(ownerToAdd);
        }
        return;
      }

      const owners = [inferredUser];
      if (ownerToAdd && ownerToAdd.toLowerCase() !== key) {
        owners.push(ownerToAdd);
      }

      discoveredByUsername.set(key, {
        id,
        label: cleanName || inferredUser,
        icon: '$(account)',
        gitName: cleanName || inferredUser,
        gitEmail: cleanEmail || `${inferredUser}@users.noreply.github.com`,
        githubUsername: inferredUser,
        autoMatchOwners: owners,
        includeForks: false,
        createdAt: now,
        updatedAt: now,
      });
    };

    const inspectGitConfigFile = (configFilePath: string, fallbackUsername?: string) => {
      if (!fs.existsSync(configFilePath)) {
        return;
      }
      try {
        const raw = fs.readFileSync(configFilePath, 'utf8');
        const nameMatch = raw.match(/^\s*name\s*=\s*(.+)$/m);
        const emailMatch = raw.match(/^\s*email\s*=\s*(.+)$/m);
        const urlMatch = raw.match(/^\s*url\s*=\s*(.+)$/m);

        const name = nameMatch ? nameMatch[1].trim() : undefined;
        const email = emailMatch ? emailMatch[1].trim() : undefined;
        const url = urlMatch ? urlMatch[1].trim() : undefined;

        let authUser: string | undefined;
        let remoteOwner: string | undefined;
        if (url) {
          const httpsMatch = url.match(
            /^https?:\/\/(?:([^:@/]+)(?::[^@/]+)?@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i
          );
          if (httpsMatch) {
            authUser = httpsMatch[1] ? decodeURIComponent(httpsMatch[1]) : undefined;
            remoteOwner = httpsMatch[2];
          } else {
            const sshMatch = url.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
            if (sshMatch) {
              remoteOwner = sshMatch[2];
            }
          }
        }

        if (name || email || authUser || fallbackUsername) {
          registerCandidate(
            name,
            email,
            authUser || fallbackUsername || name || remoteOwner,
            remoteOwner
          );
        }
      } catch {
        // Ignore unreadable config files
      }
    };

    // 1. Check active VS Code workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    for (const folder of workspaceFolders) {
      inspectGitConfigFile(path.join(folder.uri.fsPath, '.git', 'config'));
    }

    // 2. Check global ~/.gitconfig and PortableGit/etc/gitconfig
    inspectGitConfigFile(path.join(os.homedir(), '.gitconfig'));
    inspectGitConfigFile(path.join(portableRoot, 'etc', 'gitconfig'));

    // 3. Scan existing folders/repos inside PortableGit root
    if (fs.existsSync(portableRoot)) {
      try {
        const entries = fs.readdirSync(portableRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || SYSTEM_DIRS.has(entry.name.toLowerCase())) {
            continue;
          }
          const fullPath = path.join(portableRoot, entry.name);
          const gitConfig = path.join(fullPath, '.git', 'config');
          const profileConfig = path.join(fullPath, '.gitconfig-profile');

          if (fs.existsSync(gitConfig)) {
            inspectGitConfigFile(gitConfig);
          } else {
            if (fs.existsSync(profileConfig)) {
              inspectGitConfigFile(profileConfig, entry.name);
            }
            // Also check sub-repos inside <profile>/, <profile>/Personal/, and <profile>/Organizations/<org>/
            const subDirs = [
              fullPath,
              path.join(fullPath, 'Personal'),
            ];
            const orgsRoot = path.join(fullPath, 'Organizations');
            if (fs.existsSync(orgsRoot)) {
              try {
                for (const orgEntry of fs.readdirSync(orgsRoot, { withFileTypes: true })) {
                  if (orgEntry.isDirectory()) {
                    subDirs.push(path.join(orgsRoot, orgEntry.name));
                  }
                }
              } catch {
                // Ignore unreadable org directory
              }
            }
            for (const subDir of subDirs) {
              if (!fs.existsSync(subDir)) {
                continue;
              }
              try {
                for (const repoEntry of fs.readdirSync(subDir, { withFileTypes: true })) {
                  if (repoEntry.isDirectory()) {
                    const subGitConfig = path.join(subDir, repoEntry.name, '.git', 'config');
                    if (fs.existsSync(subGitConfig)) {
                      inspectGitConfigFile(subGitConfig, entry.name);
                    }
                  }
                }
              } catch {
                // Ignore unreadable subdirectory
              }
            }
          }
        }
      } catch {
        // Ignore scan errors
      }
    }

    return Array.from(discoveredByUsername.values());
  }
}

