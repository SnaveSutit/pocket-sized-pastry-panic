// Builds every data pack, optimizes them and the resource pack with
// PackSquash, and assembles a distributable world zip.
//
// Usage: bun .scripts/package_map.ts

import path from 'node:path'
import chalk from 'chalk'

const ROOT = path.resolve(import.meta.dir, '..')
const DIST_DIR = path.join(ROOT, 'dist')
const TEMP_DIR = path.join(ROOT, '.temp')
const DATAPACKS_DIR = path.join(ROOT, 'datapacks')
const WORLD_DIR = path.join(ROOT, 'world')
const RESOURCES_DIR = path.join(ROOT, 'resources')

const packageJson = await Bun.file(path.join(ROOT, 'package.json')).json()
const PROJECT_NAME: string = packageJson.projectName

async function exists(p: string): Promise<boolean> {
	return (await Bun.$`test -e ${p}`.quiet().nothrow()).exitCode === 0
}

async function listChildren(dir: string, type?: 'd' | 'f'): Promise<string[]> {
	const typeArgs = type ? ['-type', type] : []
	const result =
		await Bun.$`find ${dir} -mindepth 1 -maxdepth 1 ${typeArgs} -printf '%f\n'`.quiet()
	return result
		.text()
		.split('\n')
		.map(s => s.trim())
		.filter(Boolean)
}

async function mkdirp(dir: string) {
	await Bun.$`mkdir -p ${dir}`.quiet()
}

// src/dest match node's fs.cp semantics: dest is the target path itself
// (created/overwritten), not the parent directory to copy into.
async function copyPath(src: string, dest: string) {
	await Bun.$`rm -rf ${dest}`.quiet()
	await mkdirp(path.dirname(dest))
	await Bun.$`cp -r ${src} ${dest}`.quiet()
}

async function removePath(target: string) {
	await Bun.$`rm -rf ${target}`.quiet()
}

async function buildDatapack(dir: string) {
	if (!(await exists(path.join(dir, 'src')))) return
	console.log(chalk.dim(`  🔨 Building ${path.relative(ROOT, dir)}...`))
	const proc = Bun.spawn(['bunx', 'mcb', 'build'], {
		cwd: dir,
		stdout: 'inherit',
		stderr: 'inherit',
	})
	const exitCode = await proc.exited
	if (exitCode !== 0)
		throw new Error(`mcb build exited with code ${exitCode} in ${dir}`)
}

// Only copy the built output of a data pack (data/, pack.mcmeta, icon.png),
// not its source, libs, or build cache.
async function stageDatapack(dir: string, destDir: string) {
	await mkdirp(destDir)
	await copyPath(path.join(dir, 'data'), path.join(destDir, 'data'))
	await copyPath(path.join(dir, 'pack.mcmeta'), path.join(destDir, 'pack.mcmeta'))
	const iconPath = path.join(dir, 'icon.png')
	if (await exists(iconPath)) await copyPath(iconPath, path.join(destDir, 'icon.png'))
}

function packsquashOptionsToml(packDirectory: string, outputFilePath: string): string {
	return [
		`pack_directory = ${JSON.stringify(packDirectory)}`,
		`output_file_path = ${JSON.stringify(outputFilePath)}`,
		'',
	].join('\n')
}

// PackSquash options files use paths relative to the current working
// directory, so run it from the repo root and pass paths relative to that.
async function runPacksquash(stagedDir: string, outZip: string) {
	await mkdirp(path.dirname(outZip))

	const optionsPath = `${stagedDir}.packsquash.toml`
	await Bun.write(
		optionsPath,
		packsquashOptionsToml(path.relative(ROOT, stagedDir), path.relative(ROOT, outZip))
	)

	const packsquashBin = Bun.which('packsquash')
	if (!packsquashBin) throw new Error('packsquash not found on PATH')

	const proc = Bun.spawn([packsquashBin, optionsPath], {
		cwd: ROOT,
		stdout: 'inherit',
		stderr: 'inherit',
	})
	const exitCode = await proc.exited
	if (exitCode !== 0)
		throw new Error(`packsquash exited with code ${exitCode} (${optionsPath})`)
}

async function packageDatapacks(): Promise<string[]> {
	console.log(chalk.cyan.bold('📦 Building data packs...'))
	const names = await listChildren(DATAPACKS_DIR, 'd')

	const outZips: string[] = []
	for (const name of names) {
		const dir = path.join(DATAPACKS_DIR, name)
		await buildDatapack(dir)

		const stagedDir = path.join(TEMP_DIR, 'datapacks', name)
		await stageDatapack(dir, stagedDir)

		const outZip = path.join(DIST_DIR, 'datapacks', `${name}.zip`)
		console.log(chalk.dim(`  🗜️  Squashing ${name}...`))
		await runPacksquash(stagedDir, outZip)
		outZips.push(outZip)
	}
	return outZips
}

async function packageResourcepack(): Promise<string> {
	console.log(chalk.cyan.bold('🎨 Squashing resource pack...'))
	const stagedDir = path.join(TEMP_DIR, 'resourcepack')
	await copyPath(RESOURCES_DIR, stagedDir)

	const outZip = path.join(DIST_DIR, `${PROJECT_NAME} Resource Pack.zip`)
	await runPacksquash(stagedDir, outZip)
	return outZip
}

// Files/folders in the world save that shouldn't ship with the packaged map.
const WORLD_EXCLUDE = new Set([
	'datapacks', // symlink to ../datapacks, replaced with the built zips below
	'advancements',
	'playerdata',
	'poi',
	'stats',
	'level.dat_old',
	'session.lock',
])

async function packageWorld(datapackZips: string[], resourcepackZip: string) {
	console.log(chalk.cyan.bold('🌍 Assembling world...'))
	const stagedDir = path.join(TEMP_DIR, `${PROJECT_NAME} World`)
	await mkdirp(stagedDir)

	for (const entry of await listChildren(WORLD_DIR)) {
		if (WORLD_EXCLUDE.has(entry)) continue
		await copyPath(path.join(WORLD_DIR, entry), path.join(stagedDir, entry))
	}

	const datapacksDestDir = path.join(stagedDir, 'datapacks')
	await mkdirp(datapacksDestDir)
	for (const zip of datapackZips) {
		await copyPath(zip, path.join(datapacksDestDir, path.basename(zip)))
	}

	await copyPath(resourcepackZip, path.join(stagedDir, 'resources.zip'))

	const outZip = path.join(DIST_DIR, `${PROJECT_NAME}.zip`)
	await removePath(outZip)
	const proc = Bun.spawn(['zip', '-r', '-X', '-9', outZip, '.'], {
		cwd: stagedDir,
		stdout: 'inherit',
		stderr: 'inherit',
	})
	const exitCode = await proc.exited
	if (exitCode !== 0)
		throw new Error(`zip exited with code ${exitCode} while zipping ${stagedDir}`)
	return outZip
}

async function main() {
	await removePath(DIST_DIR)
	await removePath(TEMP_DIR)
	await mkdirp(DIST_DIR)

	const datapackZips = await packageDatapacks()
	const resourcepackZip = await packageResourcepack()
	const worldZip = await packageWorld(datapackZips, resourcepackZip)

	await removePath(TEMP_DIR)

	console.log(chalk.green.bold('\n✨ Done!'))
	for (const zip of [...datapackZips, resourcepackZip, worldZip]) {
		console.log(chalk.green(`  ✅ ${path.relative(ROOT, zip)}`))
	}
}

try {
	await main()
} catch (err) {
	console.error(chalk.red.bold(`\n❌ ${err instanceof Error ? err.message : err}`))
	process.exit(1)
}
