# dsh-bay

`dsh-bay` is the Core plugin package for DSH Bay / 湾. Bay turns DSH plugins, Skills, Agents and workbench layouts into assets that can be used, validated, improved and shared. This package provides the Workbench runtime, Creator workflow, portable package handling and DSH integration points.

- Version: `0.1.0-beta.1`
- DSH compatibility: `>=0.2.2-rc.2 <0.2.3`
- Package type: DSH plugin, not a standalone desktop application

This is a DSH plugin package, not a standalone desktop application. Build it from the workspace with `pnpm build`, or generate an installable local artifact with `pnpm pack:core`. For the product workflow, setup, testing and package generation, see the repository [README](../../README.md), [Chinese project handbook](../../docs/PROJECT-HANDBOOK.zh-CN.md) and [Chinese user guide](../../docs/USER-GUIDE.zh-CN.md).

Review the DSH permissions and extension provenance before installing the generated package. Beta artifacts should only be used in a DSH environment matching the declared compatibility range.
