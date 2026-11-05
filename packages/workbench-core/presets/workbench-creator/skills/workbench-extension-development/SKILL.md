---
name: workbench-extension-development
description: Design, implement, validate, and package a durable DSH Workbench inner-page extension. Use when the requested result should be a reusable or installable extension rather than a temporary Cordis Plugin.
---

# Develop Workbench Inner-Page Extensions

Workbench Core 0.2.2-alpha.17.5 on DSH 0.2.2-rc.1 (upstream commit 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db) registers this Skill through DSH's global Skill provider registry. The official DSH Creator can discover it when Core is installed; this does not create or override a Workbench-specific Agent preset.

In Creator, users can start this workflow from the `/create-workbench-extension` slash shortcut. It is a user-only alias for this Skill: it injects these same instructions into the Creator turn, while the canonical `workbench-extension-development` name remains available to the model's Skill catalog.

Use this workflow for a durable extension that registers one or more Workbench editor pages. The target deliverable is a standard DSH Bundle/Client Plugin containing its Workbench module and editor declarations. DSH's native Plugin Manager owns installation, update, native enable/disable, and uninstall in a Profile; Workbench Core separately discovers and validates the extension, then requires the user's opt-in before exposing its inner pages. Workbench Core `0.2.2-alpha.17.5` carries declaration metadata through the DSH Slot inject face and declares the Plugin Inventory and Plugin Manager Remotes needed to verify installed and running extensions. Core Host also registers this Skill through DSH's global Skill provider registry, so the official DSH Creator can discover it without a Workbench-specific preset override. Automated coverage is in place, while real desktop Creator discovery and the broader update/uninstall migration loop remain pending. The Creator may write and validate the package, but must not represent a successful build or DSH installation as Workbench activation. A Dynamic Cordis runner may be used by a separately mounted programmatic consumer or UI control as a temporary, process-local experiment, but it is not a packaged Workbench extension. Choose the deliverable from the user's requested lifetime and outcome.

Read the [complete Workbench container inner-page extension specification](./WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md) before creating or packaging an extension. It is the detailed source for identity mapping, Slot metadata, binding, state, lifecycle, testing, and diagnostics.

## Working rules

- Workbench is a DSH plugin. Do not edit DSH source, replace official owners, or copy DSH Session, Conversation, Composer, or tool runtime implementations.
- Inspect the current repository's public Workbench contracts, package examples, DSH version lock, and release checks before writing code. Treat those sources as authoritative; do not invent Slot props, manifest fields, permissions, or package commands.
- A Workbench editor is additive. Register only the public `workbench.editor.root` or `workbench.editor.session` slot that matches its resource needs. Never take over `main`, `main.conversation`, `layout.frame`, `sidebar`, or another official owner.
- Keep module activation scope separate from editor render scope: a module may activate at `root`, `session`, or `area`, but an editor declaration currently supports only `root` or `session`. An Area-aware editor uses the `session` Slot and the exact Area/Workspace/Session owner props; `scope: 'area'` is not a valid editor declaration.
- DSH SlotCore drops unknown Slot option fields. Put the editor declaration and extension identity in `inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration, extension } })`; do not attach custom `declaration` or `extension` options to the Slot.
- Every new or updated editor must declare a meaningful SVG identity through `presentation.iconSvg: { version: 1, paths: [...] }` inside that same `workbenchEditor` metadata. Use the validated path-only contract in the specification; never pass raw SVG markup, colors, scripts, styles or image URLs. Each editor in a multi-editor extension needs a distinguishable glyph. Legacy semantic tokens and generated fallback glyphs remain compatible but do not substitute for new editor design acceptance.
- The object returned by the Client entry must set Cordis's plugin `name` to the exact package name used as the DSH `moduleName`, and each Workbench Slot registration must explicitly set the same `registrant`. SlotCore uses the active Fiber name as the default `registrant`; explicit metadata avoids inheriting `root` or another parent name when a plugin is nested, while Core still verifies the value against `pluginInventory` and `listBundles`.
- Keep `dsh.workbench.editorIds`, any manifest `provides.editorIds`, embedded editor declarations, and runtime `extension.editorIds` synchronized and unique. When a manifest includes editor declarations, their ID set must exactly match `provides.editorIds`; repeat the same complete runtime extension identity on each Slot contribution. The public Core validator rejects duplicates, malformed IDs, incomplete editor lists, and unreadable metadata.
- A session editor must use the exact `workspaceId` and `sessionId` supplied by Workbench. Never infer identity from Area position, focus, or DSH's global current Session.
- A module declaration describes requested resources and lifecycle behavior; it does not grant permissions. Keep permissions minimal and explain why each is needed.
- The Workbench setting “allow this extension in Workbench” controls only Workbench contributions. It is not DSH plugin enablement or a security sandbox; only DSH's Plugin Manager controls whether the DSH plugin is loaded.
- Persist only small, versioned, JSON-serializable state that the extension can safely restore. Keep local recovery state separate from shareable state. Never persist credentials, live handles, transcripts, absolute paths, or author-specific Workspace IDs in a shared template.
- Treat `state.restore` as the share-import restore policy. `state.share: 'portable'` may cross a package only after schema and `maxBytes` checks; `reference-only` and `forbidden` keep layout references but transfer no state. Core also checks the declared byte limit before mounting a saved local snapshot and may ask the user to clear it.
- A separate DSH test Profile protects the user's normal data from test changes. It is not a security sandbox for untrusted extension code.

## Choose the delivery shape before writing code

DSH exposes two different development paths. Keep their claims and artifacts separate:

| Shape | Use | What it proves |
| --- | --- | --- |
| Dynamic Cordis runtime probe | A short-lived experiment through the separately mounted runner API or UI control | The current process can load the experiment; it is not the DSH Creator Agent install path and is not an installable artifact. |
| DSH installable Bundle / Client Plugin | A workspace package with `dsh.bundle.patch.yml`, an optional `dsh.client` entry, and a DSH Plugin Manager install | The package can be installed into a Profile and its declared DSH rows can become active. |
| Workbench Module V1 | The Workbench declaration embedded in a standard DSH plugin package | The declaration describes binding, state, visibility, and lifecycle; it is not a separate installable package or a substitute for the DSH Plugin Manager. |
| Signed Catalog or offline package | A release and sharing channel | Only use it after the host has verified the artifact, provenance, compatibility, and restart transaction. |

For a durable inner page, create a normal DSH UI Plugin/Bundle and include its Workbench module manifest and editor declarations in that package. Register only the public `workbench.editor.root` or `workbench.editor.session` slot. A successful slot registration, build, or runtime probe is never evidence that the package is installed, compatible, allowed by Core, shareable, or active.

DSH's native Plugin Manager manages the Profile from which it is called. Profile changes persist across sessions, affect other sessions in that Profile, and may execute installed Host code with host-user privileges. Follow DSH's Full Access or per-call approval flow. Do not provide `approvedBuilds` unless the user explicitly approved the named pending package build scripts. For Workbench extension development, use a separate DSH test Profile for installation and runtime checks; never install a candidate into the user's active Profile by default. A test Profile separates test data but is not a security sandbox for untrusted code.

The reusable scaffold is in `templates/workbench-editor/`. It is a root-scoped starter. Copy it into a workspace package, replace the example identity and declaration, then validate it against the pinned DSH generation. If the editor requires an Area Session, also change the registered Slot from `workbench.editor.root` to `workbench.editor.session`, use `scope: 'session'`, declare `requiredBinding: 'session'`, and specify the unbound and sharing policies. The template deliberately uses the native DSH `dsh` manifest and `cordis.patch.yml`; it is not a second Workbench loader.

## Install and verify a durable extension

Use the DSH Plugin Manager for Profile changes. Do not edit a Profile's `package.json`, `cordis.patch.yml`, `dsh.profile.bundles`, or `node_modules` by hand, and do not run pnpm in a Profile directory. The minimum sequence is:

1. Build the workspace package and record its package digest, `moduleId`, `editorId`, DSH generation, and Core compatibility.
2. In the separate test Profile, ask the DSH Plugin Manager to install the local bundle (`plugin_manager`, `action: install_bundle`, with the workspace package directory as `target`). Record the actual saved/application status, warnings, diagnostics, and any pending build scripts. An accepted request is not the same as a completed restart.
3. Confirm the exact installed package and its patch with DSH inspection. If the Profile needs a restart, verify the replacement DSH Run before continuing.
4. Confirm Core discovers the package in the same Profile and validates its Workbench declaration and compatibility. If generic discovery is unavailable in the pinned Core, report the extension as installed but not Workbench-integrated.
5. Explicitly allow the extension in Workbench settings, then verify that its declared editor IDs become available. This Core action does not replace DSH plugin enablement.
6. Test install, discovery, Core allow/deny, layout references, update/migration, DSH disable/uninstall, and recovery in the isolated Profile. Report the DSH runtime state, Core integration state, and layout-reference state separately.
7. Report the achieved lifecycle state and evidence. A package build, DSH installation, Core opt-in, and real desktop acceptance are separate claims.

Never install a generated candidate into the user's active Profile automatically. A layout template is a separate artifact: it may contain editor choices and portable settings, but never the author's Session, transcript, credential, absolute path, or live process handle.

## Minimal editor registration

The Client entry should inject `@deepseek-ai/dsh-client-ui-slots`, register a lazy factory, and keep all resource work inside `apply`/effects. Use the exact owner props delivered by Core. A root editor must not read a global current Session; a session editor must use the supplied `workspaceId` and `sessionId`. Do not create a Session merely because an editor was opened. The declaration must state the required binding, unbound behavior, local restore/share policy, and background/collapsed behavior.

The public types and extension identity validator are exported from `@dsh-workbench/core/client`. Do not import private `src/` paths. Use the validator in Creator or development tooling; an independently installable extension must not require Core at runtime just to load its DSH plugin entry. The current Core has automated same-Profile DSH inventory mapping, extension contract validation and separate Workbench opt-in coverage. Generic DSH install/update/uninstall recovery and real desktop Profile acceptance remain unverified. Treat the Workbench declaration as part of the DSH plugin package, but do not claim package signatures, byte-level provenance or a security sandbox. Follow [the extension lifecycle standard](../../../../../../docs/WORKBENCH-EXTENSION-LIFECYCLE.zh.md) and report lifecycle scenarios as unverified until an acceptance record proves them.

## Editor icon acceptance

- Design the glyph for the editor's actual function; replace the template's notebook example when it does not fit.
- Validate with `normalizeWorkbenchEditorSvgIcon()` from the Core client development API. The Core owns the 24×24 viewBox, outline stroke, rounded ends and theme color.
- Check 16, 20 and 24 pixel sizes in light and dark themes. Avoid tiny details and distinguish sibling editors without their labels.
- Verify the same glyph in empty Areas, tabs, picker, previews and the editor directory. In compact Areas, verify hover and keyboard focus expose the editor name.
- Record visual acceptance separately from structure validation. A generated legacy identity is compatibility support, not an authored semantic icon.

## Workflow

### 1. Clarify the outcome

Use the request and available project context first. Ask only for material missing choices, such as:

- what user task the extension supports and who will use it;
- whether it is root-scoped, session-scoped, or usable without a binding;
- what it shows before and after a required resource is bound;
- what state must restore locally and what may be shared;
- what should happen while hidden, closed, or restored;
- what concrete scenarios define acceptance.

Do not ask the user to choose implementation details that can be resolved by inspecting the public contract. If the outcome is clear, proceed without an extra confirmation round.

Before substantial implementation, write a short requirement brief containing the purpose, resource and binding behavior, persistence/share boundary, lifecycle expectations, and observable acceptance checks. Resolve product-level ambiguity before committing to one behavior.

### 2. Inspect before designing

Read the current Workbench editor API, module/composition descriptors, available examples, build scripts, tests, and DSH compatibility lock. If working from a running Workbench, use its read-only Creator inspection for current layout facts; do not claim that inspect or a semantic plan changed the layout.

Check whether DSH already provides the requested capability. Prefer an additive adapter around the native capability when the public API supports it. Record any upstream behavior that cannot be verified, and do not present an unverified approximation as native parity.

### 3. Define the module contract

For every editor, state explicitly:

- required resource: none, Workspace, or exact Session binding;
- unbound behavior: usable, waiting for selection, or unavailable with a recovery action;
- binding behavior: use the Area binding, or request a separately authorized resource;
- state schema/version, size expectations, local restore policy, and share projection;
- hidden-view policy: retain, pause, or release only reconstructible view resources;
- close behavior, error recovery, help text, and acceptance scenarios.

Keep user-facing guidance understandable without internal terms such as receipt, claim, generation, Profile, or artifact. Do not let an editor silently create a Session just because it was opened.

### 4. Implement in an isolated development target

Use the repository's documented extension scaffold and public Slot contracts. Keep generated code, package metadata, and tests in the requested extension's own package or isolated development directory. Preserve existing user changes and do not reset or clean a shared worktree.

Build against the pinned DSH version. Add focused tests for binding and unbound states, state validation, cleanup on close/disable, and the extension's primary user workflow. Do not duplicate a DSH feature merely to make a test pass.

### 5. Validate in a separate DSH test Profile

Run the package's documented static checks, type checks, build, and relevant tests. Then validate installation and behavior using a separate test Profile or clean test installation, never the user's active Profile by default.

Verify at least:

- the extension registers only its declared public Workbench editor slots;
- resource identity is explicit and does not leak between Areas;
- missing bindings produce the declared recovery UI rather than an implicit Session;
- state restores only when its schema and resource identity are valid;
- stopping, disabling, closing, or replacing the editor releases its subscriptions and view resources;
- the DSH official page, main Session, and official owners remain unchanged;
- build or test success is reported with the exact checks that ran.

If the host cannot provide a capability, mark that scenario unverified or unsupported. Never turn a mocked check into a claim of real Profile verification.

### 6. Deliver a candidate without installing it

Keep these lifecycle states distinct:

| State | Meaning |
| --- | --- |
| `draft` | Requirements or source are still being prepared. |
| `build-passed` | Static checks/build passed; runtime behavior is not yet verified. |
| `test-profile-verified` | The declared scenarios passed in the separate test Profile. |
| `candidate-ready` | A versioned candidate package and its evidence are ready for review. |
| `installed` | DSH Plugin Manager reports the package installed in a target Profile. |
| `active` | The target DSH runtime confirms the extension is enabled and running. |

Report the achieved state, package identity/digest when available, validation evidence, known gaps, and the target DSH compatibility. Do not call a build or test result installed or active.

Never install into the user's active Profile, add the extension to the current Workbench, publish it, or change public release pointers automatically. Those are separate actions. When the user later requests installation, use the DSH Plugin Manager flow and report its actual installed/active result. A candidate package is not automatically safe because it passed tests.


## 17.2 distribution contract

For a shareable extension, include distribution.version=1, exportPolicy, runtimeKind, an exact runtimeFiles list including package.json, every declared entry, Bundle patch and LICENSE, and requires for plugin dependencies. Use globally unique Bundle row IDs. Include no npm runtime dependencies, install scripts, source maps or unlisted resources. Exact host peers must be available in DSH 0.2.2-rc.1. A client-only package may have only the template's inert Host shim; declare client-host for executable Host logic.

Register explicit portability.exportState and portability.importState functions in the injected Workbench metadata, as shown in the template. Project only bounded, versioned JSON; do not copy raw owner state. A stateless editor must explicitly project and restore empty state. Test both handlers and reject secrets, machine paths and invalid shapes. The Host derives provenance from native package identity and verified runtime files.

The owner prepares distribution artifacts from the exact published file list. Core never builds arbitrary projects automatically. Complete exports fail if any retained tab or dependency lacks reliable migration or artifacts; the user may explicitly choose layout sharing. Receiver consent applies to one package and Profile. New installation and enabling require restart before actual registration and state restoration. Signature verification proves publisher/content consistency, not code safety. Static dependency inspection is conservative and does not prove arbitrary JavaScript safe.

17.3 扩展同时遵循 templates/workbench-editor/README.md 的“展示位置与实例生命周期”要求：运行缓存采用 runtimeIdentity、资源经 owner 路由、未保存数据注册关闭保护，隐藏不终止底层任务。交付时测试浮窗→Area 固定及跨工作台实例隔离，不能仅验证首次挂载。
