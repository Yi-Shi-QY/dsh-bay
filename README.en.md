# DSH Bay / 湾

[中文](README.md) · English

> Turn DSH plugins, Skills and Agents from one-off configuration into workbenches that can be used, validated, improved and shared.

DSH Bay is an open-source workbench for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It brings plugin development, Skill creation, Agent collaboration, project context, acceptance evidence and workbench sharing into one workflow: start from a template, use it on real work, improve the assets as you learn, let Bay Agent help verify the result, and migrate or share the workbench with yourself or your team.

Think of Bay as a durable layer on top of DSH. Experienced developers keep fine-grained control over plugins, Skills, Agents and layouts; people who are new to DSH get a runnable starting point and a gradual path to improve it. A workbench is meant to grow through real use until it becomes a reusable and handover-ready way of working.

## What's new in v0.1.2

- **Chinese and English in one package.** Bay follows **Settings → General → Language** in DSH. Bay translates its own interface and built-in page names, not project or conversation names, user input, file paths, or third-party content.
- **A clearer path to your first conversation.** An empty area without a project recommends pages that don't need a conversation. A project without conversations highlights **New Conversation**, which preselects the current project so you can choose an Agent mode and start.
- **Workbench sharing improvements.** Export template or full `.dshbay.zip` packages with a destination picker and progress feedback. Import restores project information and supported conversation state. Replies to questions and approval prompts work again in browser-opened workbenches.

See the [v0.1.2 release notes (Chinese)](docs/RELEASE-NOTES-v0.1.2.zh-CN.md) and [changelog](CHANGELOG.md).

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
- Workbench template and full packages for reusing layouts or moving project files and supported conversation history.
- Browser workbench and controlled LAN sharing primitives.

## Scope

For Bay `v0.1.2`, the Core preview package is `dsh-bay@0.1.2-0.1.1.1`. It declares compatibility with DSH `>=0.2.2-rc.3 <0.2.3` and was tested on `0.2.2-rc.3`. Bay runs on DSH-provided Host, Agent, tool and plugin-management services.

Bay does not promise compatibility with every DSH version, third-party plugin, cross-generation migration, public internet collaboration or every model provider. LAN sharing is a controlled beta capability. Review a full package before sharing it: it can include project files, attachments and restorable conversation history. Share only data you are allowed to distribute, and never include credentials or grant Host control through a package.

## Try it locally

Requirements: Node.js `>=24.9.0`, pnpm `11.28.5` and a compatible DSH Host. From the repository root:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm verify
    pnpm pack:core

The Core artifact is written to `releases/0.1.2-0.1.1.1/dsh-bay-0.1.2-0.1.1.1.tgz`. Install the `.tgz` in an isolated DSH Profile through DSH's native Plugin Manager, then follow the [Chinese user guide](docs/USER-GUIDE.zh-CN.md) for the first workbench, template and sharing exercise. This builds a local preview package; it does not publish it.

If you are evaluating the product first, start with the [project handbook](docs/PROJECT-HANDBOOK.zh-CN.md). If you want to build extensions, read the [Creator Skill](packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md).

## Documentation

- [Project handbook](docs/PROJECT-HANDBOOK.zh-CN.md)
- [User guide](docs/USER-GUIDE.zh-CN.md)
- [Product direction](docs/PRODUCT-DIRECTION.zh-CN.md)
- [Architecture](docs/ARCHITECTURE.zh-CN.md)
- [Creator Skill](packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md)
- [Package formats](docs/WORKBENCH-PACKAGES.md)
- [Earlier beta validation](docs/VALIDATION-v0.1.zh-CN.md)

Read [SUPPORT.md](SUPPORT.md) before opening an issue and [SECURITY.md](SECURITY.md) before reporting a security problem. DSH Bay is released under the MIT License.
