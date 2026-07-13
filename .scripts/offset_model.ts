// Shifts every element in a block/item model.json along one axis.
//
// Adds the given offset to each element's "from"/"to" corners, and to
// "rotation.origin" (if present) so any rotation stays anchored correctly
// relative to the moved element.
//
// Edits the file as text (rather than parsing + re-serializing the whole
// JSON) so the pack's existing formatting is left untouched — only the
// touched numbers change.
//
// Usage: bun .scripts/offset_model.ts <path/to/model.json> <offset> [--axis x|y|z]
//   offset defaults to the Y axis (vertical) when --axis is omitted.

import path from 'node:path'

interface ModelElement {
	from: [number, number, number]
	to: [number, number, number]
	rotation?: { origin: [number, number, number]; [key: string]: unknown }
	[key: string]: unknown
}

interface Model {
	elements?: ModelElement[]
	[key: string]: unknown
}

function parseArgs(argv: string[]) {
	const positional: string[] = []
	let axis: 'x' | 'y' | 'z' = 'y'

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!
		if (arg === '--axis') {
			const value = argv[++i]
			if (value !== 'x' && value !== 'y' && value !== 'z') {
				throw new Error(`--axis must be one of x, y, z (got ${value ?? '<missing>'})`)
			}
			axis = value
		} else {
			positional.push(arg)
		}
	}

	const [modelPath, offsetStr] = positional
	if (!modelPath || offsetStr === undefined) {
		throw new Error('Usage: bun .scripts/offset_model.ts <path/to/model.json> <offset> [--axis x|y|z]')
	}

	const offset = Number(offsetStr)
	if (!Number.isFinite(offset)) {
		throw new Error(`Offset must be a number (got "${offsetStr}")`)
	}

	return { modelPath, offset, axis }
}

// Matches a `"from": [...]`, `"to": [...]`, or `"origin": [...]` literal,
// wherever it appears (origin is only ever nested inside an element's
// "rotation" in vanilla/Blockbench model.json output).
const COORD_ARRAY_RE = /("(?:from|to|origin)"\s*:\s*)\[([^\]]*)\]/g

function addOffsetToCoordArrays(text: string, axisIndex: number, offset: number): { text: string; count: number } {
	let count = 0
	const result = text.replace(COORD_ARRAY_RE, (match, prefix: string, inner: string) => {
		const parts = inner.split(',')
		if (parts.length <= axisIndex) return match

		const part = parts[axisIndex]!
		const numberMatch = part.match(/-?\d+(?:\.\d+)?/)
		if (!numberMatch) return match

		const oldValue = Number(numberMatch[0])
		const newValue = oldValue + offset
		const newValueStr = Number.isInteger(newValue) ? String(newValue) : String(Number(newValue.toFixed(6)))

		parts[axisIndex] = part.replace(numberMatch[0], newValueStr)
		count++
		return `${prefix}[${parts.join(',')}]`
	})
	return { text: result, count }
}

async function main() {
	const { modelPath, offset, axis } = parseArgs(process.argv.slice(2))
	const axisIndex = { x: 0, y: 1, z: 2 }[axis]
	const resolvedPath = path.resolve(modelPath)

	const file = Bun.file(resolvedPath)
	if (!(await file.exists())) {
		throw new Error(`File not found: ${resolvedPath}`)
	}

	const originalText = await file.text()

	const model: Model = JSON.parse(originalText)
	if (!Array.isArray(model.elements) || model.elements.length === 0) {
		throw new Error(`No "elements" array found in ${resolvedPath}`)
	}

	const { text: newText, count } = addOffsetToCoordArrays(originalText, axisIndex, offset)
	if (count === 0) {
		throw new Error(`No "from"/"to"/"origin" coordinate arrays found to offset in ${resolvedPath}`)
	}

	await Bun.write(resolvedPath, newText)
	console.log(
		`✨ Offset ${count} coordinate array(s) across ${model.elements.length} element(s) by ${offset} on the ${axis.toUpperCase()} axis in ${path.relative(process.cwd(), resolvedPath)}`
	)
}

try {
	await main()
} catch (err) {
	console.error(`❌ ${err instanceof Error ? err.message : err}`)
	process.exit(1)
}
