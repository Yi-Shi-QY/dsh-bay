# DSH Bay / 湾

> Turn DSH plugins, Skills and Agents from one-off configuration into workbenches that can be used, validated, improved and shared.

DSH Bay is an open-source workbench for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It brings plugin development, Skill creation, Agent collaboration, project context, acceptance evidence and workbench sharing into one workflow: start from a template, use it on real work, improve the assets as you learn, let Bay Agent help verify the result, and migrate or share the workbench with yourself or your team.

Think of Bay as a durable layer on top of DSH. Experienced developers keep fine-grained control over plugins, Skills, Agents and layouts; people who are new to DSH get a runnable starting point and a gradual path to improve it. A workbench is meant to grow through real use until it becomes a reusable and handover-ready way of working.

## What problem it solves

DSH provides powerful plugins, tools and Agent capabilities, but development tools, runtime configuration, reusable assets, working context and validation evidence often end up in different places. A first successful setup is then hard to improve, a mature solution is hard to hand over, and a new user has no clear place to start.

Bay closes that gap. It gives experiments a durable home, turns improvements into reusable plugins, Skills, Agents and layouts, and makes validated workbenches easier to migrate, reuse and share.

## Who it is for

- **DSH developers and plugin authors** who need fine-grained control, compatibility and provenance checks, and reusable templates.
- **People with a real task but little DSH experience** who want a working starting point and a gradual path to improve it through use.
- **Teams that reuse and share workbenches** through portable packages or a controlled local network.

These users follow the same loop: make the work useful, capture what worked, validate it, and make it reusable. Experienced DSH users can go deep into implementation details; beginners can reach a first useful result before learning the entire DSH surface.

## The improvement loop

1. Create a workbench from scratch or from a template.
2. Do real work in its projects, conversations and tasks, and record what needs to improve.
3. Turn improvements into plugins, Skills, Agents and layouts.
4. Ask Bay Agent to inspect structure, dependencies, declarations and acceptance evidence.
5. Export the workbench for personal migration, team reuse or controlled LAN use.

For example, start with a template for a recurring task, add the missing tools and fixed steps as you use it, capture the acceptance criteria, then hand the workbench to a teammate or turn it into a more specialized plugin and Skill.

## What v0.1 Beta includes

- Multi-area workbenches with persistent projects, sessions, tasks and layouts.
- Creator Skills and plugin templates for starting from a runnable foundation.
- Bay Agent work items, assignments, Agent assembly and acceptance support.
- DSH version, dependency, upstream provenance and artifact integrity checks.
- Portable layout and complete workbench packages.
- Browser workbench and controlled LAN sharing primitives.

## Scope

The public beta is `v0.1.0-beta.1` and ships the `dsh-bay@0.1.0-beta.1` Core package. It targets DSH `>=0.2.2-rc.2 <0.2.3` and runs on DSH-provided Host, Agent, tool and plugin-management services.

Bay does not promise compatibility with every DSH version, third-party plugin, cross-generation migration, public internet collaboration or every model provider. LAN sharing is a controlled beta capability. Portable packages must not contain credentials, complete Session transcripts, local absolute paths or Host control authority.

## Try it locally

Requirements: Node.js `>=24.9.0`, pnpm `11.28.5` and a compatible DSH Host. From the repository root:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm verify
    pnpm pack:core

The Core artifact is written to `releases/0.1.0-beta.1/`. Install the `.tgz` in an isolated DSH Profile through DSH's native Plugin Manager, then follow the [Chinese user guide](docs/USER-GUIDE.zh-CN.md) for the first workbench, template and sharing exercise.

If you are evaluating the product first, start with the [project handbook](docs/PROJECT-HANDBOOK.zh-CN.md). If you want to build extensions, read the [Creator Skill](packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md).

## Documentation

- [Project handbook](docs/PROJECT-HANDBOOK.zh-CN.md)
- [User guide](docs/USER-GUIDE.zh-CN.md)
- [Product direction](docs/PRODUCT-DIRECTION.zh-CN.md)
- [Architecture](docs/ARCHITECTURE.zh-CN.md)
- [Creator Skill](packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md)
- [v0.1 validation](docs/VALIDATION-v0.1.zh-CN.md)

Read [SUPPORT.md](SUPPORT.md) before opening an issue and [SECURITY.md](SECURITY.md) before reporting a security problem. DSH Bay is released under the MIT License.

Chinese version: [README.zh-CN.md](README.zh-CN.md).
