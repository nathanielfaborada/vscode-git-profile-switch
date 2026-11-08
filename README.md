# Git Profile & Workspace Sync

If you use more than one GitHub account on the same computer, such as a personal account and a work or school account, switching between them in VS Code can get messy. It is easy to commit with your personal email on a work repo, run into permission errors when pushing, or mix up project folders on your drive.

Git Profile & Workspace Sync lets you switch your Git account from the VS Code status bar in one click.

## What It Does

When you pick a profile, the extension updates your Git commit name, email, and GitHub push login at the same time. You do not need to run `git config` commands by hand or clear out Windows Credential Manager every time you change accounts.

It also keeps your projects organized on disk by giving each account its own folder:

```text
PortableGit/
 ├── john-dev/
 │    ├── Personal/
 │    │    ├── portfolio-site/
 │    │    └── side-project/
 │    └── Organizations/
 │         └── open-source-club/
 │              └── club-website/
 └── acme-corp/
      ├── Personal/
      │    └── dotfiles/
      └── Organizations/
           └── acme-inc/
                ├── core-api/
                └── customer-dashboard/
```

If you connect a GitHub Personal Access Token, the extension can fetch your repositories from GitHub and clone any missing ones into that account's `Personal/` or `Organizations/<org>/` folder. If you already have repositories sitting in your main `PortableGit` folder, it can sort them into the right account folders without touching your `.env` files, virtual environments, or `node_modules`.

When you install the extension or open a project in VS Code, it automatically detects your machine's existing Git configuration (`~/.gitconfig`, `PortableGit/etc/gitconfig`, and local repositories) and switches to the matching profile dynamically—with zero hardcoded paths or accounts. Your GitHub tokens are stored in VS Code's built-in secret storage rather than in plain text settings files.

## Getting Started

### 1. Automatic Detection or Add a Profile

On first launch, the extension automatically scans your current Git configuration and `PortableGit` directory to import existing accounts. To add another account:

1. Open the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS).
2. Run **Git Profile: Add New Profile (Create)**.
3. Fill in the prompts:
   - A short label for the account, such as `Personal` or `Work`.
   - Your GitHub username (for example, `john-dev`).
   - Your commit author name and email (the extension automatically looks up and pre-fills your GitHub-bound `id+username@users.noreply.github.com` address so commits are always attributed to the right GitHub account).
   - Your GitHub Personal Access Token (optional, needed if you want private repo cloning and automatic push login).

### 2. Switch Accounts

Click the profile name in the bottom-left VS Code status bar, or run **Git Profile: Switch Profile & Sync Workspace** from the Command Palette, and select the account you want to use.

## Available Commands

Open the Command Palette (`Ctrl+Shift+P`) and type `Git Profile` to see all actions:

| Command | What it does |
| :--- | :--- |
| `Git Profile: Switch Profile & Sync Workspace` | Switch to another saved Git account |
| `Git Profile: Add New Profile (Create)` | Save a new Git account and token |
| `Git Profile: Edit Profile (Update)` | Change an account's name, email, or token |
| `Git Profile: Delete Profile (Delete)` | Remove a saved account and delete its token |
| `Git Profile: Sync & Auto-Clone All GitHub Repos to PortableGit` | Download missing GitHub repos into the active account folder |
| `Git Profile: Organize Existing PortableGit Repos into Profile Folders` | Move existing local repos into their matching account folders |
| `Git Profile: Verify Active Identity & GitHub Token` | Check which name, email, and GitHub account are currently active |
| `Git Profile: Open Active Profile Folder in VS Code` | Open the folder for the current account in the Explorer sidebar |

## Settings

You can adjust these options in VS Code Settings (`Ctrl+,` and search for `Git Profile Switch`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `gitProfileSwitch.portableGitRoot` | `""` *(Auto-detected)* | Root path to `PortableGit` where per-account folders are stored. When blank, dynamically detects `~/Downloads/PortableGit`, `~/PortableGit`, or the current workspace's `PortableGit` folder. |
| `gitProfileSwitch.autoCloneOnSwitch` | `true` | Clone missing GitHub repos automatically when you switch accounts |
| `gitProfileSwitch.autoOpenProfileWorkspace` | `"prompt"` | Ask before switching the Explorer sidebar to the account's folder (`"prompt"`, `"always"`, or `"never"`) |
| `gitProfileSwitch.autoDetectFromRepo` | `true` | Switch to the matching profile automatically when you open a repo |

## Installing from a VSIX File

If you are installing the extension manually from a `.vsix` file instead of the Marketplace:

1. Open VS Code.
2. Press `Ctrl+Shift+P` and run **Extensions: Install from VSIX...**
3. Pick `git-profile-sync-1.0.2.vsix`.

Or install it from a terminal:

```powershell
code --install-extension git-profile-sync-1.0.2.vsix
```

## Support

If this extension saves you time, you can [buy me a coffee on Ko-fi](https://ko-fi.com/nathanielfaborada).

## License

[MIT License](LICENSE)
