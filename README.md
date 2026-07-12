# Pocket-sized Pastry Panic

A Minecraft datapack + resource pack map built with [MC-Build](https://github.com/mc-build/mc-build).

# Requirements

-   [Bun](https://bun.sh)
-   [PackSquash](https://github.com/ComunidadAylas/PackSquash) available on your `PATH`
-   `zip` available on your `PATH`

# Setting up

-   Run `bun install` to install dependencies.

# Developing

-   `bun run dev` starts MC-Build in watch mode for the `map` data pack.

Data packs live under `datapacks/`; each one is its own MC-Build project (`src/`, `mcb.config.cjs`, etc.) built independently. The resource pack lives under `resources/`.

# Removing local world changes

Because we're using the server as the source of truth for the world, any changes made to the world locally (e.g., by playing in singleplayer) must be discarded before commiting.

-   Run `bun run clear_world_changes` to discard local world changes.

# Packaging

Running `bun run package` (`.scripts/squash_and_pack.ts`) will:

1. Build every data pack under `datapacks/` with MC-Build.
2. Optimize each built data pack and the resource pack with PackSquash.
3. Assemble the `world/` save (data, region, etc., excluding player-specific and generated files) together with the squashed data packs and resource pack into a distributable world zip.

Output is written to `dist/`:

-   `dist/datapacks/<name>.zip` — each squashed data pack
-   `dist/<project name> Resource Pack.zip` — the squashed resource pack
-   `dist/<project name>.zip` — the packaged world, ready to distribute

# Releasing

The `Package and Release` GitHub Actions workflow (`.github/workflows/release.yml`) can be triggered manually (Actions tab → Run workflow) with a tag name to build the map and resource pack zips and publish them as a GitHub release.
