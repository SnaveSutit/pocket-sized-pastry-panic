import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const WORLD_DIR = 'world'

async function run(cmd: string[]) {
	const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
	const exitCode = await proc.exited
	if (exitCode !== 0) throw new Error(`${cmd.join(' ')} exited with code ${exitCode}`)
}

async function main() {
	console.log(`Discarding all local changes in ${WORLD_DIR}/...`)
	// Reverts tracked files to HEAD.
	await run(['git', 'checkout', '--', WORLD_DIR])
	// Removes untracked files/dirs, but leaves gitignored ones (e.g. world/datapacks) alone.
	await run(['git', 'clean', '-fd', '--', WORLD_DIR])
	console.log('World folder reset to last commit.')
}

void main()
