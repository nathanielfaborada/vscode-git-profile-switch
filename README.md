# Git Profile & PortableGit Workspace Switcher (`vscode-git-profile-switch`)

A Visual Studio Code extension that **dynamically synchronizes your Git Commit Author (`user.name` & `user.email`), GitHub Push Credentials (PAT / Credential Manager), and per-user `PortableGit/<username>` repository folders** with zero identity mismatch.

---

## Key Features

1. **100% Dynamic Atomic Identity Sync**
   - Switching profiles updates all layers simultaneously:
     - Local repository `.git/config` (`user.name`, `user.email`, `remote.origin.url`)
     - Global `~/.gitconfig` and `PortableGit/etc/gitconfig`
     - Windows / PortableGit Credential Manager (`git credential approve`)
     - Folder-level `includeIf` Git config rules (`PortableGit/<username>/.gitconfig-profile`)
   - **Real-time `.git/config` File Watcher:** Automatically heals any external mismatch immediately.

2. **`PortableGit/<username>` Per-Profile Repository Sync**
   - Organizes repositories cleanly by user account:
     ```text
     PortableGit/
      ├── nathanielfaborada/
      │    ├── chatbot-llm/
      │    ├── nathanielfaborada.github.io/
      │    └── vscode-git-profile-switch/
      ├── PowerTractire/
      │    ├── ptti-chatbot/
      │    └── ts-chatbot/
      └── jane/
           ├── repo1/
           └── repo2/
     ```
   - **Auto-Clone Missing Repos:** Queries the GitHub API (`/user/repos`, `/users/<user>/repos`, `/orgs/<org>/repos`) and clones any missing repositories into `PortableGit/<username>/`.
   - **Organize Existing Repos:** Moves existing standalone repos in `PortableGit/` into their matching `PortableGit/<username>/` folder without losing `.env`, `.venv`, or `node_modules`.

3. **Full Profile CRUD + Encrypted Token Storage**
   - **Create (`Git Profile: Add New Profile`)**: Guided setup for label, icon, `user.name`, `user.email`, `githubUsername`, Personal Access Token (PAT), and auto-match organizations.
   - **Read (`Status Bar + QuickPick`)**: Live status bar indicator with rich hover tooltip showing commit author, push user, token status, and local repo count.
   - **Update (`Git Profile: Edit Profile`)**: Edit any field or rotate PAT tokens with instant re-sync.
   - **Delete (`Git Profile: Delete Profile`)**: Removes profile metadata and purges encrypted tokens from VS Code `SecretStorage`.

---

## Commands

| Command | Description |
| :--- | :--- |
| `Git Profile: Switch Profile & Sync Workspace` | Open the QuickPick switcher (or click the Status Bar item) |
| `Git Profile: Add New Profile (Create)` | Create a new Git profile + encrypted PAT |
| `Git Profile: Edit Profile (Update)` | Edit an existing profile or rotate its token |
| `Git Profile: Delete Profile (Delete)` | Delete a profile and remove its token |
| `Git Profile: Sync & Auto-Clone All GitHub Repos to PortableGit` | Fetch and clone all repos for the active profile into `PortableGit/<username>` |
| `Git Profile: Organize Existing PortableGit Repos into Profile Folders` | Move standalone repos in `PortableGit` into their matching profile subfolders |
| `Git Profile: Verify Active Identity & GitHub Token` | Verify active commit author, push account, and GitHub API token |
| `Git Profile: Open Active Profile Folder in VS Code` | Open `PortableGit/<username>` in VS Code Explorer |

---

## Development & Packaging

```powershell
npm install
npm run compile
```

- Press **`F5`** in VS Code to launch the Extension Development Host.
- Run `npm run package` to build an installable `.vsix` package.
