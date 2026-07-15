// Installs this repo's git hooks (currently: a pre-commit hook that blocks
// commits touching world/) by pointing git at the checked-in .githooks/ dir.
//
// Usage: bun .scripts/setup_hooks.ts

import path from 'node:path'
import { chmod } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'

const ROOT = path.resolve(import.meta.dir, '..')
const HOOKS_DIR = path.join(ROOT, '.githooks')

async function run(cmd: string[]) {
	const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
	const exitCode = await proc.exited
	if (exitCode !== 0) throw new Error(`${cmd.join(' ')} exited with code ${exitCode}`)
}

async function main() {
	await run(['git', 'config', 'core.hooksPath', '.githooks'])

	for (const name of await readdir(HOOKS_DIR)) {
		await chmod(path.join(HOOKS_DIR, name), 0o755)
	}

	console.log('✨ Git hooks installed (core.hooksPath -> .githooks).')
}

try {
	await main()
} catch (err) {
	console.error(`\n❌ ${err instanceof Error ? err.message : err}`)
	process.exit(1)
}
