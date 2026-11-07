import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitProfile } from '../types';

const CONFIG_SECTION = 'gitProfileSwitch';
const SECRET_PREFIX = 'gitProfileSwitch.token.';

export class ProfileStorage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public getPortableGitRoot(): string {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const configured = (config.get<string>('portableGitRoot') || '').trim();
    if (configured && fs.existsSync(configured)) {
      return configured;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const currentPath = workspaceFolders[0].uri.fsPath;
      const match = currentPath.match(/^(.*?[\\/]PortableGit)(?:[\\/]|$)/i);
      if (match && match[1] && fs.existsSync(match[1])) {
        return match[1];
      }
    }

    return 'C:\\Users\\user\\Downloads\\PortableGit';
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
      let migrated = false;
      const updated = profiles.map((p) => {
        if (
          p.githubUsername.toLowerCase() === 'nathanielfaborada' &&
          p.gitEmail.toLowerCase() === 'faboradanathaniel@gmail.com'
        ) {
          migrated = true;
          return {
            ...p,
            gitEmail: '143235940+nathanielfaborada@users.noreply.github.com',
          };
        }
        if (
          p.githubUsername.toLowerCase() === 'powertractire' &&
          p.gitEmail.toLowerCase() === 'powertractire@users.noreply.github.com'
        ) {
          migrated = true;
          return {
            ...p,
            gitEmail: '344656093+PowerTractire@users.noreply.github.com',
          };
        }
        return p;
      });
      if (migrated) {
        await this.saveAllProfiles(updated);
      }
      return updated;
    }

    const seeded = this.getDefaultProfiles();
    await this.saveAllProfiles(seeded);
    return seeded;
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

  private getDefaultProfiles(): GitProfile[] {
    const now = new Date().toISOString();
    return [
      {
        id: 'nathanielfaborada',
        label: 'Nath Personal',
        icon: '$(account)',
        gitName: 'nathanielfaborada',
        gitEmail: '143235940+nathanielfaborada@users.noreply.github.com',
        githubUsername: 'nathanielfaborada',
        autoMatchOwners: ['nathanielfaborada', 'Truck-Tires-Incorporated'],
        includeForks: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'sudofaboradanathaniel',
        label: 'Sudo Nath',
        icon: '$(account)',
        gitName: 'sudofaboradanathaniel',
        gitEmail: '345642770+sudofaboradanathaniel@users.noreply.github.com',
        githubUsername: 'sudofaboradanathaniel',
        autoMatchOwners: ['sudofaboradanathaniel', 'sudo-spill-rate'],
        includeForks: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'powertractire',
        label: 'PowerTractire Company',
        icon: '$(organization)',
        gitName: 'PowerTractire',
        gitEmail: '344656093+PowerTractire@users.noreply.github.com',
        githubUsername: 'PowerTractire',
        autoMatchOwners: ['PowerTractire', 'Power-Tractire-Inc', 'Track-Speed'],
        includeForks: false,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
}
