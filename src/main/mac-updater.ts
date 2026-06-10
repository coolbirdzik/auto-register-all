import { app } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { chmod, mkdir, readdir, rm, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'

const REPO = 'coolbirdzik/auto-register-all'
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`

export interface MacReleaseInfo {
  version: string
  zipUrl?: string
  releaseName?: string
  releaseUrl?: string
}

export interface MacDownloadProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

/**
 * Fetch the latest release info from GitHub and pick the .zip asset that
 * matches the current arch. We prefer the .zip over .dmg because we can swap
 * the .app bundle in place without mounting a disk image.
 */
export async function fetchLatestMacRelease(): Promise<MacReleaseInfo> {
  const res = await fetch(RELEASES_API, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `auto-register/${app.getVersion()}`
    }
  } as RequestInit)
  if (!res.ok) {
    throw new Error(`GitHub releases request failed (${res.status})`)
  }
  const json = (await res.json()) as Record<string, unknown>
  const version = String(json.tag_name || '').replace(/^v/i, '')
  const releaseUrl = typeof json.html_url === 'string' ? json.html_url : undefined
  const releaseName = typeof json.name === 'string' ? json.name : undefined
  const assets = Array.isArray(json.assets) ? (json.assets as Array<Record<string, unknown>>) : []

  const arch = process.arch // 'arm64' | 'x64'
  const candidatePatterns = [
    new RegExp(`-${arch}-mac\\.zip$`, 'i'),
    new RegExp(`-${arch}\\.zip$`, 'i'),
    new RegExp(`-mac-${arch}\\.zip$`, 'i'),
    /-mac\.zip$/i,
    /\.zip$/i
  ]

  let zipUrl: string | undefined
  for (const pattern of candidatePatterns) {
    const asset = assets.find((a) => {
      const name = String(a.name || '')
      const isBlockmap = name.endsWith('.blockmap')
      return !isBlockmap && pattern.test(name)
    })
    if (asset && typeof asset.browser_download_url === 'string') {
      zipUrl = asset.browser_download_url
      break
    }
  }

  return { version, zipUrl, releaseName, releaseUrl }
}

/**
 * Download a release zip into the userData/updates cache directory and
 * report incremental progress to the caller.
 */
export async function downloadMacZip(
  url: string,
  onProgress: (progress: MacDownloadProgress) => void
): Promise<string> {
  const cacheDir = join(app.getPath('userData'), 'updates')
  await mkdir(cacheDir, { recursive: true })

  const fileName = basename(new URL(url).pathname) || 'update.zip'
  const target = join(cacheDir, fileName)

  // Wipe any partially written prior download to avoid corrupted resumes.
  await rm(target, { force: true })

  const res = await fetch(url, { redirect: 'follow' } as RequestInit)
  if (!res.ok || !res.body) {
    throw new Error(`Update download failed (${res.status})`)
  }
  const total = Number(res.headers.get('content-length') || 0)
  let transferred = 0
  const startedAt = Date.now()

  const ws = createWriteStream(target)
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (!ws.write(value)) {
        await new Promise<void>((resolve) => ws.once('drain', resolve))
      }
      transferred += value.length
      const elapsed = (Date.now() - startedAt) / 1000
      onProgress({
        percent: total > 0 ? Math.round((transferred / total) * 100) : 0,
        transferred,
        total,
        bytesPerSecond: elapsed > 0 ? transferred / elapsed : 0
      })
    }
  } finally {
    ws.end()
    await new Promise<void>((resolve) => ws.once('close', resolve))
  }

  return target
}

/**
 * Extract the downloaded zip, locate the new .app bundle, and spawn a
 * detached bash script that swaps the running .app bundle and relaunches.
 *
 * We bypass Squirrel.Mac entirely so unsigned builds can self-update.
 */
export async function installMacUpdate(zipPath: string): Promise<void> {
  const cacheDir = dirname(zipPath)
  const extractDir = join(cacheDir, 'extracted')

  await rm(extractDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })

  // ditto preserves resource forks, symlinks, and extended attributes.
  await execCommand('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir])

  const entries = await readdir(extractDir)
  const appEntry = entries.find((entry) => entry.endsWith('.app'))
  if (!appEntry) {
    throw new Error('No .app bundle found inside update archive')
  }
  const newAppPath = join(extractDir, appEntry)

  // Strip the quarantine flag macOS adds to downloaded files so Gatekeeper
  // does not block the relaunched bundle. Failure here is non-fatal.
  await execCommand('/usr/bin/xattr', ['-cr', newAppPath]).catch(() => {})

  // app.getPath('exe') => /Applications/Auto Register.app/Contents/MacOS/Auto Register
  const exePath = app.getPath('exe')
  const currentAppPath = exePath.replace(/\/Contents\/MacOS\/[^/]+$/, '')
  if (!currentAppPath.endsWith('.app')) {
    throw new Error(`Could not resolve current .app path from ${exePath}`)
  }

  const scriptPath = join(cacheDir, 'install-update.sh')
  const logPath = join(cacheDir, 'install-update.log')

  const escape = (value: string): string => value.replace(/(["\\$`])/g, '\\$1')

  const script = `#!/bin/bash
set -u
exec >"${escape(logPath)}" 2>&1

PID="${process.pid}"
CURRENT_APP="${escape(currentAppPath)}"
NEW_APP="${escape(newAppPath)}"
BACKUP_APP="$CURRENT_APP.old"

echo "[updater] waiting for pid $PID to exit"
for _ in $(seq 1 100); do
  if ! ps -p "$PID" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if ps -p "$PID" >/dev/null 2>&1; then
  echo "[updater] forcing kill on pid $PID"
  kill -9 "$PID" 2>/dev/null || true
  sleep 1
fi

if [ ! -d "$NEW_APP" ]; then
  echo "[updater] new app bundle missing: $NEW_APP"
  exit 1
fi

rm -rf "$BACKUP_APP" 2>/dev/null || true

echo "[updater] swapping bundles"
if ! mv "$CURRENT_APP" "$BACKUP_APP"; then
  echo "[updater] failed to back up current app"
  exit 1
fi

if ! mv "$NEW_APP" "$CURRENT_APP"; then
  echo "[updater] failed to install new app, restoring backup"
  mv "$BACKUP_APP" "$CURRENT_APP" 2>/dev/null || true
  exit 1
fi

# Best-effort cleanup of the backup bundle.
rm -rf "$BACKUP_APP" >/dev/null 2>&1 &

echo "[updater] relaunching"
open "$CURRENT_APP"
`

  await writeFile(scriptPath, script, 'utf8')
  await chmod(scriptPath, 0o755)

  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()

  // Give the script a moment to start before we exit, otherwise the script
  // races against the OS reaping our PID and never sees us run.
  setTimeout(() => {
    app.quit()
  }, 600)
}

function execCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${cmd} exited with code ${code}`))
      }
    })
  })
}

export function compareSemver(a: string, b: string): number {
  const left = a.split(/[.-]/).map((x) => Number(x) || 0)
  const right = b.split(/[.-]/).map((x) => Number(x) || 0)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
