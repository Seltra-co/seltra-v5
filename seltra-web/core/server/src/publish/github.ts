import { SignJWT, importPKCS8 } from "jose";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
type GithubOptions = { org: string; appId: string; installationId: string; privateKeyPem: string; mode: "hobby" | "team"; repoPrefix: string };
export type GithubRepository = { id: string; fullName: string; visibility: "public" | "private"; cloneUrl: string; defaultBranch: string };
type GitRunner = (args: string[], env?: NodeJS.ProcessEnv) => Promise<{ stdout: string }>;

export class GithubPublisher {
  private tokenCache?: { value: string; expiresAt: number };
  constructor(private readonly options: GithubOptions, private readonly fetcher: typeof fetch = fetch, private readonly gitRunner: GitRunner = (args, env) => run("git", args, { env, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })) {}

  async installationToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) return this.tokenCache.value;
    const key = await importPKCS8(this.options.privateKeyPem, "RS256");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 30)
      .setIssuer(this.options.appId)
      .setExpirationTime("8m")
      .sign(key);
    const response = await this.fetcher(`https://api.github.com/app/installations/${encodeURIComponent(this.options.installationId)}/access_tokens`, {
      method: "POST", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${jwt}`, "x-github-api-version": "2022-11-28" },
    });
    if (!response.ok) throw safeGithubError("GITHUB_TOKEN_FAILED", response.status);
    const payload = await response.json() as { token?: string; expires_at?: string };
    if (!payload.token) throw new Error("GitHub did not return an installation token.");
    const expiresAt = payload.expires_at ? Date.parse(payload.expires_at) : Date.now() + 50 * 60_000;
    this.tokenCache = { value: payload.token, expiresAt };
    return payload.token;
  }

  async ensureRepo(tenantAppId: string): Promise<GithubRepository> {
    const token = await this.installationToken();
    const name = `${this.options.repoPrefix}${tenantAppId.toLowerCase()}`;
    let response = await this.fetcher(`https://api.github.com/repos/${encodeURIComponent(this.options.org)}/${encodeURIComponent(name)}`, { headers: githubHeaders(token) });
    if (response.status === 404) {
      response = await this.fetcher(`https://api.github.com/orgs/${encodeURIComponent(this.options.org)}/repos`, {
        method: "POST", headers: githubHeaders(token), body: JSON.stringify({ name, private: true, auto_init: false }),
      });
      if (response.status === 422) {
        response = await this.fetcher(`https://api.github.com/repos/${encodeURIComponent(this.options.org)}/${encodeURIComponent(name)}`, { headers: githubHeaders(token) });
      }
    } else if (response.ok) {
      const existing = await response.clone().json() as { private?: boolean };
      if (existing.private === false) {
        response = await this.fetcher(`https://api.github.com/repos/${encodeURIComponent(this.options.org)}/${encodeURIComponent(name)}`, {
          method: "PATCH", headers: githubHeaders(token), body: JSON.stringify({ private: true }),
        });
      }
    }
    if (!response.ok) throw safeGithubError("GITHUB_REPOSITORY_FAILED", response.status);
    const repo = await response.json() as { id: number; full_name: string; private: boolean; clone_url: string; default_branch?: string };
    return { id: String(repo.id), fullName: repo.full_name, visibility: repo.private ? "private" : "public", cloneUrl: repo.clone_url, defaultBranch: repo.default_branch || "main" };
  }

  async pushApp(appPath: string, repository: GithubRepository, branch = "main"): Promise<string> {
    const root = path.resolve(appPath);
    const remote = `https://github.com/${repository.fullName}.git`;
    await safeGit(root, ["rev-parse", "--is-inside-work-tree"]);
    await safeGit(root, ["remote", "remove", "origin"], true);
    await safeGit(root, ["remote", "add", "origin", remote]);
    const token = await this.installationToken();
    const env = gitAuthEnv(token);
    let remoteRef: { stdout: string };
    try {
      remoteRef = await this.gitRunner(["-C", root, "ls-remote", "origin", `refs/heads/${branch}`], env);
    } catch {
      throw Object.assign(new Error("Could not read the saved GitHub branch."), { code: "GITHUB_PUSH_FAILED" });
    }
    if (remoteRef.stdout.trim()) {
      try {
        await this.gitRunner(["-C", root, "fetch", "origin", branch], env);
        await this.gitRunner(["-C", root, "rebase", `refs/remotes/origin/${branch}`], env);
      } catch {
        await safeGit(root, ["rebase", "--abort"], true);
        throw Object.assign(new Error("The GitHub branch has commits this workspace cannot rebase cleanly."), { code: "SOURCE_DIVERGED" });
      }
    }
    try {
      await this.gitRunner(["-C", root, "push", "origin", `HEAD:refs/heads/${branch}`], env);
    } catch {
      try { await this.gitRunner(["-C", root, "fetch", "origin", branch], env); }
      catch { throw Object.assign(new Error("GitHub push failed; the workspace was retained."), { code: "GITHUB_PUSH_FAILED" }); }
      try { await this.gitRunner(["-C", root, "rebase", `refs/remotes/origin/${branch}`], env); }
      catch {
        await safeGit(root, ["rebase", "--abort"], true);
        throw Object.assign(new Error("The GitHub branch advanced and could not be rebased cleanly."), { code: "SOURCE_DIVERGED" });
      }
      try { await this.gitRunner(["-C", root, "push", "origin", `HEAD:refs/heads/${branch}`], env); }
      catch { throw Object.assign(new Error("GitHub push failed; the workspace was retained."), { code: "GITHUB_PUSH_FAILED" }); }
    }
    return await safeGitOutput(root, ["rev-parse", "HEAD"]);
  }

  async verifyRemoteSha(repository: GithubRepository, sha: string, branch = "main"): Promise<boolean> {
    const token = await this.installationToken();
    try {
      const output = await this.gitRunner(["ls-remote", repository.cloneUrl, `refs/heads/${branch}`], gitAuthEnv(token));
      return output.stdout.trim().split(/\s+/)[0] === sha;
    } catch {
      throw Object.assign(new Error("Could not verify the saved commit on GitHub."), { code: "GITHUB_PUSH_FAILED" });
    }
  }

  async cloneApp(repositoryFullName: string, sha: string, destination: string): Promise<void> {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryFullName) || !/^[0-9a-f]{40,64}$/i.test(sha)) throw new Error("Snapshot repository reference is invalid.");
    const target = path.resolve(destination);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const token = await this.installationToken();
    try {
      await this.gitRunner(["clone", "--no-checkout", `https://github.com/${repositoryFullName}.git`, target], gitAuthEnv(token));
      await safeGit(target, ["checkout", "--detach", sha]);
    } catch {
      throw Object.assign(new Error("Could not restore the saved application source."), { code: "WORKSPACE_RESTORE_FAILED" });
    }
  }
}

function githubHeaders(token: string): HeadersInit {
  return { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28", "content-type": "application/json" };
}

function gitAuthEnv(token: string): NodeJS.ProcessEnv {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "SYSTEMROOT", "WINDIR", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "TEMP", "TMP", "LANG"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: header, GIT_TERMINAL_PROMPT: "0" };
}

async function safeGit(cwd: string, args: string[], allowFailure = false): Promise<void> { await safeGitOutput(cwd, args, allowFailure); }
async function safeGitOutput(cwd: string, args: string[], allowFailure = false): Promise<string> {
  try { return (await run("git", ["-C", cwd, ...args], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 })).stdout.trim(); }
  catch (error) {
    if (allowFailure) return "";
    const code = (error as { code?: number }).code;
    if (code === 128) throw Object.assign(new Error("Source repository is not ready for GitHub persistence."), { code: "GIT_OPERATION_FAILED" });
    throw Object.assign(new Error("Git operation failed; sensitive command output was suppressed."), { code: "GIT_OPERATION_FAILED" });
  }
}

function safeGithubError(code: string, status: number): Error & { code: string } {
  return Object.assign(new Error(`GitHub request failed with status ${status}.`), { code });
}
