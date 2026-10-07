# Repository summaries

## Target

Write one durable summary per repository in the fleet, plus an index of those summaries, into a directory the operator configures, using only each repository's remote default branch and no model.

## Hard constraints

- No model is called while producing a summary.
- A summary is read from the remote default branch. An uncommitted local edit does not appear in it.
- The output directory is chosen by the operator and stays inside the git that versions the manifest, so the summaries can be committed with it. When the operator does not choose one, it is `ai/repos` next to the manifest.
- Each summary carries the catalogue identity (path, url, tags, description), the detected stack, the scripts, the tracked top-level structure, a README excerpt, links to agent instruction files present on the remote default branch, dependencies on other repositories of the fleet, and a manual section kept across regeneration.
- Generating again when no repository changed leaves every summary file byte-for-byte identical.
- A comparison run writes nothing and reports the summaries as outdated when a file is missing or would change.
- Cloning the fleet and running a command in a tagged subset still succeed when no summary has been generated.

## Non-goals

- Choosing the operator's always-loaded memory folder as the output. They point the output there only if they want to.
- Replacing memory an agent writes inside a single repository.
- Contacting a forge to discover repositories.
- Making summaries a prerequisite of clone, list, or exec.

## Done-when

- The configured directory contains one summary per fleet repository and one index that leads to each of them.
- A dirty working tree in a clone leaves that repository's summary unchanged.
- A second generation, with repositories unchanged, changes no summary file.
- A comparison against the current files fails when a summary is missing or different, and creates no file.
- The fleet can be cloned, and a command can be run on the repositories that share a tag, without generating summaries.

## Stakeholders (optional)

- Decider: Maxime
- Owner: Maxime
- Consumer: an agent or a person opening the fleet, who reads the index before opening a repository

## Context (optional)

The fleet catalogue is already on main: the manifest may live in a nested git, and the clones sit beside it. Summaries were removed from that catalogue because they are stack discovery. They come back as their own feature, for about 195 repositories, so a reader does not open every repository to learn what it is. The working tree is never a source: the shared copy is the remote default branch. The operator who wants the summaries in an always-loaded memory folder points the output there.
