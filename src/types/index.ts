export interface GitProfile {
  id: string;
  label: string;
  icon: string;
  gitName: string;
  gitEmail: string;
  githubUsername: string;
  autoMatchOwners: string[];
  includeForks: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  fork: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  owner: {
    login: string;
    type: string;
  };
}

export interface SyncSummary {
  profile: GitProfile;
  profileDir: string;
  totalRemoteRepos: number;
  clonedRepos: string[];
  updatedRepos: string[];
  failedRepos: Array<{ name: string; error: string }>;
}

export interface OrganizeSummary {
  movedRepos: Array<{ repoName: string; targetProfile: string; targetPath: string }>;
  skippedRepos: Array<{ repoName: string; reason: string }>;
}

export interface ActiveGitIdentity {
  scope: 'local' | 'global';
  repoPath?: string;
  userName: string;
  userEmail: string;
  remoteUrl?: string;
  remoteOwner?: string;
  remoteAuthUser?: string;
}

export interface SyncOptions {
  syncRemoteRepos?: boolean;
  promptOpenFolder?: boolean;
  syncAllSubRepos?: boolean;
}
