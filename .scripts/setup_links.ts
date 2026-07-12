// Creates the symlinks/junctions this project relies on:
//   - world/datapacks -> ../datapacks (repo-internal, always recreated)
//   - <instance>/saves/<project> -> world/ (external, folder picked via GUI)
//   - <instance>/resourcepacks/<project> -> resources/ (external, same folder)
//
// "instance" can be the vanilla .minecraft folder, a Prism Launcher instance,
// a Modrinth App profile, or any other launcher's equivalent folder.
//
// Usage: bun .scripts/setup_links.ts

import path from 'node:path'
import os from 'node:os'
import { createInterface } from 'node:readline/promises'
import { lstat, mkdir, rmdir, unlink, symlink } from 'node:fs/promises'

const ROOT = path.resolve(import.meta.dir, '..')
const WORLD_DIR = path.join(ROOT, 'world')
const RESOURCES_DIR = path.join(ROOT, 'resources')
const DATAPACKS_DIR = path.join(ROOT, 'datapacks')
const CONFIG_PATH = path.join(ROOT, '.scripts', '.setup-links.json')

const packageJson = await Bun.file(path.join(ROOT, 'package.json')).json()
const PROJECT_NAME: string = packageJson.projectName ?? packageJson.name

type LauncherKind = 'vanilla' | 'prism' | 'modrinth' | 'custom'

type Config = { launchers?: Partial<Record<LauncherKind, string>> }

async function loadConfig(): Promise<Config> {
	const file = Bun.file(CONFIG_PATH)
	if (!(await file.exists())) return {}
	try {
		return await file.json()
	} catch {
		return {}
	}
}

async function saveConfig(config: Config) {
	await Bun.write(CONFIG_PATH, JSON.stringify(config, null, '\t') + '\n')
}

async function exists(p: string): Promise<boolean> {
	try {
		await lstat(p)
		return true
	} catch {
		return false
	}
}

function dataDir(...appDirNames: [win: string, mac: string, linux: string]): string {
	const home = os.homedir()
	switch (process.platform) {
		case 'win32':
			return process.env.APPDATA ? path.join(process.env.APPDATA, appDirNames[0]) : ''
		case 'darwin':
			return path.join(home, 'Library', 'Application Support', appDirNames[1])
		default:
			return path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), appDirNames[2])
	}
}

interface LauncherDef {
	kind: LauncherKind
	label: string
	// Where to point the folder picker by default.
	guessRoot(): string | undefined
	// Prompt shown above the folder picker.
	pickPrompt: string
	// Turns whatever the user picked into the actual instance root (the
	// folder that should directly contain saves/ and resourcepacks/).
	resolveTarget(picked: string): string
}

const LAUNCHERS: LauncherDef[] = [
	{
		kind: 'vanilla',
		label: 'Vanilla Minecraft Launcher',
		guessRoot: () => {
			switch (process.platform) {
				case 'win32':
					return process.env.APPDATA ? path.join(process.env.APPDATA, '.minecraft') : undefined
				case 'darwin':
					return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft')
				default:
					return path.join(os.homedir(), '.minecraft')
			}
		},
		pickPrompt: 'Select your .minecraft folder',
		resolveTarget: picked => picked,
	},
	{
		kind: 'prism',
		label: 'Prism Launcher',
		guessRoot: () => path.join(dataDir('PrismLauncher', 'PrismLauncher', 'PrismLauncher'), 'instances'),
		pickPrompt: 'Select your Prism Launcher instance folder (inside instances/)',
		// Prism instances contain a nested .minecraft/ dir; allow picking either.
		resolveTarget: picked =>
			path.basename(picked) === '.minecraft' ? picked : path.join(picked, '.minecraft'),
	},
	{
		kind: 'modrinth',
		label: 'Modrinth App',
		guessRoot: () => path.join(dataDir('ModrinthApp', 'ModrinthApp', 'ModrinthApp'), 'profiles'),
		pickPrompt: 'Select your Modrinth App profile folder (inside profiles/)',
		// Modrinth profile folders act as the instance root directly.
		resolveTarget: picked => picked,
	},
	{
		kind: 'custom',
		label: 'Custom / other launcher (pick the instance folder directly)',
		guessRoot: () => os.homedir(),
		pickPrompt: 'Select the folder to link into (should contain saves/ and resourcepacks/)',
		resolveTarget: picked => picked,
	},
]

async function pickFolder(prompt: string, defaultPath?: string): Promise<string | null> {
	switch (process.platform) {
		case 'darwin':
			return pickFolderMac(prompt, defaultPath)
		case 'win32':
			return pickFolderWindows(prompt, defaultPath)
		default:
			return pickFolderLinux(prompt, defaultPath)
	}
}

async function pickFolderMac(prompt: string, defaultPath?: string): Promise<string | null> {
	const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	let script = `POSIX path of (choose folder with prompt "${escape(prompt)}"`
	if (defaultPath && (await exists(defaultPath))) {
		script += ` default location (POSIX file "${escape(defaultPath)}")`
	}
	script += ')'
	const proc = Bun.spawn(['osascript', '-e', script], { stdout: 'pipe', stderr: 'pipe' })
	const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
	if (exitCode !== 0) return null
	return out.trim()
}

async function pickFolderWindows(prompt: string, defaultPath?: string): Promise<string | null> {
	const tmpScript = path.join(os.tmpdir(), `pick-folder-${Date.now()}.ps1`)
	const escape = (s: string) => s.replace(/`/g, '``').replace(/"/g, '`"')
	const ps = `
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "${escape(prompt)}"
$dialog.ShowNewFolderButton = $true
$default = "${defaultPath ? escape(defaultPath) : ''}"
if ($default -ne "" -and (Test-Path $default)) {
	$dialog.SelectedPath = $default
}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
	Write-Output $dialog.SelectedPath
}
`
	await Bun.write(tmpScript, ps)
	try {
		const proc = Bun.spawn(
			['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpScript],
			{ stdout: 'pipe', stderr: 'pipe' }
		)
		const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
		if (exitCode !== 0) return null
		const trimmed = out.trim()
		return trimmed.length > 0 ? trimmed : null
	} finally {
		await unlink(tmpScript).catch(() => {})
	}
}

async function pickFolderLinux(prompt: string, defaultPath?: string): Promise<string | null> {
	const zenity = Bun.which('zenity')
	if (zenity) {
		const args = ['--file-selection', '--directory', `--title=${prompt}`]
		if (defaultPath && (await exists(defaultPath)))
			args.push(`--filename=${defaultPath.endsWith('/') ? defaultPath : `${defaultPath}/`}`)
		const proc = Bun.spawn([zenity, ...args], { stdout: 'pipe', stderr: 'pipe' })
		const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
		if (exitCode !== 0) return null
		return out.trim()
	}

	const kdialog = Bun.which('kdialog')
	if (kdialog) {
		const startDir = defaultPath && (await exists(defaultPath)) ? defaultPath : os.homedir()
		const proc = Bun.spawn([kdialog, '--getexistingdirectory', startDir, '--title', prompt], {
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
		if (exitCode !== 0) return null
		return out.trim()
	}

	throw new Error('No GUI folder picker found. Install "zenity" (or "kdialog") and try again.')
}

async function ask(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout })
	try {
		return (await rl.question(question)).trim()
	} finally {
		rl.close()
	}
}

async function chooseLaunchers(config: Config): Promise<LauncherDef[]> {
	console.log('\nWhich launcher(s) do you want to link the world/resource pack into?')
	for (const [i, launcher] of LAUNCHERS.entries()) {
		const root = launcher.guessRoot()
		const detected = root && (await exists(root)) ? ' (detected)' : ''
		const configured = config.launchers?.[launcher.kind] ? ' (previously configured)' : ''
		console.log(`  ${i + 1}. ${launcher.label}${detected}${configured}`)
	}
	const answer = await ask('Enter numbers separated by commas (e.g. 1,3), "a" for all, or Enter to skip: ')
	if (!answer) return []
	if (answer.toLowerCase() === 'a') return LAUNCHERS
	const indices = answer.split(',').map(s => Number.parseInt(s.trim(), 10) - 1)
	return indices.filter(i => i >= 0 && i < LAUNCHERS.length).map(i => LAUNCHERS[i]!)
}

// Creates a directory symlink (junction on Windows, so no admin rights are
// needed). Refuses to touch anything at linkPath that isn't already a link,
// so it never clobbers real user data.
async function ensureLink(target: string, linkPath: string) {
	const absTarget = path.resolve(target)

	if (await exists(linkPath)) {
		const st = await lstat(linkPath)
		if (st.isSymbolicLink()) {
			if (process.platform === 'win32') await rmdir(linkPath)
			else await unlink(linkPath)
		} else {
			console.warn(
				`  ⚠️  Skipping ${linkPath} — already exists and isn't a link. Remove it manually to relink.`
			)
			return
		}
	}

	await mkdir(path.dirname(linkPath), { recursive: true })
	await symlink(absTarget, linkPath, process.platform === 'win32' ? 'junction' : undefined)
	console.log(`  🔗 ${linkPath} -> ${absTarget}`)
}

async function setupRepoInternalLinks() {
	console.log('Linking repo-internal paths...')
	await ensureLink(DATAPACKS_DIR, path.join(WORLD_DIR, 'datapacks'))
}

async function setupLauncherLinks() {
	const config = await loadConfig()
	const launchers = await chooseLaunchers(config)
	if (launchers.length === 0) {
		console.log('  ⚠️  No launchers selected — skipping saves/resourcepacks links.')
		return
	}

	config.launchers ??= {}
	for (const launcher of launchers) {
		const cached = config.launchers[launcher.kind]
		const defaultDir = (cached && (await exists(cached)) ? cached : undefined) ?? launcher.guessRoot()

		console.log(`\n${launcher.label}:`)
		const picked = await pickFolder(launcher.pickPrompt, defaultDir)
		if (!picked) {
			console.log('  ⚠️  No folder selected — skipping.')
			continue
		}
		config.launchers[launcher.kind] = picked
		await saveConfig(config)

		const instanceDir = launcher.resolveTarget(picked)
		console.log(`  Linking into ${instanceDir} ...`)
		await ensureLink(WORLD_DIR, path.join(instanceDir, 'saves', PROJECT_NAME))
		await ensureLink(RESOURCES_DIR, path.join(instanceDir, 'resourcepacks', PROJECT_NAME))
	}
}

async function main() {
	console.log(`Setting up links for ${PROJECT_NAME}...\n`)
	await setupRepoInternalLinks()
	await setupLauncherLinks()
	console.log('\n✨ Done!')
}

try {
	await main()
} catch (err) {
	console.error(`\n❌ ${err instanceof Error ? err.message : err}`)
	process.exit(1)
}
